// The whole integration against the fake Gladys of the SDK and a fake Danfoss
// Ally API: readings, discovery, states, commands and their quick readings,
// scene triggers and actions, widgets, errors, persistence.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';

import {
  createApp,
  HOT_REFRESH_DELAYS_MS,
  PENDING_MS,
  REFUSED_RETRY_MS,
  MIN_MANUAL_GAP_MS,
} from '../src/app.js';
import { CredentialsError, RateLimitError, ApiError, NetworkError } from '../src/danfoss-api.js';
import { THERMOSTAT_MODE, THERMOSTAT_PRESET, OPENING_SENSOR_STATE } from '../src/constants.js';
import {
  RADIATOR,
  ICON2,
  ROOM_SENSOR,
  ICON_RT,
  fakeApi,
  variant,
  apiWithFetch,
} from './helpers/fixtures.js';

const CONFIG = { consumer_key: 'key', consumer_secret: 'secret' };
const ext = (raw) => `ext:test-integration:ally:${raw.id}`;
const feature = (raw, key) => `${ext(raw)}:${key}`;

/**
 * @description A connected integration on a fake clock.
 * @param {object} [options] - Options.
 * @returns {Promise<object>} The handles.
 */
async function start({
  config = CONFIG,
  api = fakeApi(),
  statePath = null,
  created = true,
  devices = [],
} = {}) {
  const clock = { now: Date.parse('2026-10-27T07:00:00Z') };
  // `devices`: already added by the user before this start (a restart).
  const gladys = createFakeGladys({ config: { ...config }, devices });
  const app = createApp(gladys, {
    api,
    now: () => clock.now,
    date: () => new Date(2026, 9, 27, 8, 0),
    statePath,
    tickMs: 0,
    timezone: 'Europe/Paris',
  });
  await gladys.connect();
  if (created && devices.length === 0) {
    for (const device of gladys.fake.discoveredDevices) await gladys.fake.deviceCreated(device);
  }
  const advance = async (ms) => {
    clock.now += ms;
    await app.tick();
  };
  const device = (raw) => gladys.fake.devices.find((d) => d.external_id === ext(raw));
  const featureOf = (raw, key) =>
    device(raw).features.find((f) => f.external_id === feature(raw, key));
  return { gladys, app, api, clock, advance, device, featureOf };
}

test('without credentials: nothing is requested, the configuration says what to do', async () => {
  const { gladys, api } = await start({ config: {} });
  assert.deepEqual(api.calls, []);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /Consumer Key/);
  assert.deepEqual(gladys.fake.discoveredDevices, []);
});

test('one request reads the whole home, the devices are offered, the states published', async () => {
  const { gladys, api } = await start({ created: false });
  assert.deepEqual(api.calls, ['getDevices']);
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.name),
    ['Living room', 'Bathroom', 'Bedroom sensor', 'Icon RT 8'],
  );
  assert.equal(gladys.fake.states.length, 0, 'no state before the user adds a device');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(
    gladys.fake.connectionStatus.message.en,
    '4 Danfoss Ally device(s), 4 online, read every 2 min.',
  );
  await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[0]);
  assert.equal(gladys.fake.lastState(feature(RADIATOR, 'target_temperature')), 21);
  assert.equal(gladys.fake.lastState(feature(RADIATOR, 'window')), OPENING_SENSOR_STATE.CLOSE);
  assert.equal(gladys.fake.lastState(feature(ICON2, 'temperature')), undefined);
  assert.ok(gladys.fake.widgetRefreshes.length > 0, 'widgets refreshed when a device is added');
});

test('the clock reads again at the interval, and publishes only what changed', async () => {
  const { gladys, api, advance } = await start();
  const before = gladys.fake.states.length;
  await advance(60 * 1000);
  assert.equal(api.calls.length, 1, 'not before 2 minutes');
  api.devices[0] = variant(RADIATOR, { temp_current: 203 });
  await advance(60 * 1000);
  assert.equal(api.calls.length, 2);
  const published = gladys.fake.states.slice(before);
  assert.deepEqual(
    published.map((s) => [s.device_feature_external_id, s.state]),
    [[feature(RADIATOR, 'temperature'), 20.3]],
  );
  await gladys.fake.configUpdated({ ...CONFIG, refresh_minutes: '10' });
  const calls = api.calls.length;
  await advance(5 * 60 * 1000);
  assert.equal(api.calls.length, calls, '10 minutes now');
});

test('a setpoint: the setpoint of the current mode, kept until the cloud confirms it', async () => {
  const { gladys, api, advance, device, featureOf } = await start();
  const ack = await gladys.fake.setValue(
    device(RADIATOR),
    featureOf(RADIATOR, 'target_temperature'),
    21.5,
  );
  assert.equal(ack.success, true);
  assert.deepEqual(api.commands, [
    { id: RADIATOR.id, commands: [{ code: 'at_home_setting', value: 215 }] },
  ]);
  assert.equal(gladys.fake.lastState(feature(RADIATOR, 'target_temperature')), 21.5);
  // The cloud still answers the old value: the commanded one is kept.
  await advance(HOT_REFRESH_DELAYS_MS[0]);
  assert.equal(api.calls.at(-1), `getDeviceStatus:${RADIATOR.id}`);
  assert.equal(gladys.fake.lastState(feature(RADIATOR, 'target_temperature')), 21.5);
  // The cloud confirms: the quick readings stop.
  api.devices[0] = variant(RADIATOR, { at_home_setting: 215 });
  await advance(HOT_REFRESH_DELAYS_MS[1] - HOT_REFRESH_DELAYS_MS[0]);
  const calls = api.calls.length;
  await advance(HOT_REFRESH_DELAYS_MS[2] - HOT_REFRESH_DELAYS_MS[1]);
  assert.ok(api.calls.slice(calls).every((call) => call === 'getDevices'));
  assert.equal(gladys.fake.lastState(feature(RADIATOR, 'target_temperature')), 21.5);
});

test('a refused or impossible setpoint fails the command', async () => {
  const { gladys, api, device, featureOf } = await start();
  const tooHot = await gladys.fake.setValue(
    device(RADIATOR),
    featureOf(RADIATOR, 'target_temperature'),
    36,
  );
  assert.equal(tooHot.success, false);
  assert.match(tooHot.error, /between 5 and 35/);
  const limited = await gladys.fake.setValue(
    device(ICON2),
    featureOf(ICON2, 'target_temperature'),
    14,
  );
  assert.equal(limited.success, false, 'lower_temp of the Icon2 is 15 °C');
  api.accept = false;
  const refused = await gladys.fake.setValue(
    device(RADIATOR),
    featureOf(RADIATOR, 'target_temperature'),
    20,
  );
  assert.match(refused.error, /refused the command/);
  const readOnly = await gladys.fake.setValue(
    device(RADIATOR),
    featureOf(RADIATOR, 'temperature'),
    20,
  );
  assert.match(readOnly.error, /read-only/);
  // Only the command Danfoss refused reached the API.
  assert.deepEqual(api.commands, [
    { id: RADIATOR.id, commands: [{ code: 'at_home_setting', value: 200 }] },
  ]);
});

test('mode, preset and child lock become Danfoss commands', async () => {
  const { gladys, api, device, featureOf } = await start();
  await gladys.fake.setValue(
    device(RADIATOR),
    featureOf(RADIATOR, 'preset'),
    THERMOSTAT_PRESET.AWAY,
  );
  await gladys.fake.setValue(device(RADIATOR), featureOf(RADIATOR, 'mode'), THERMOSTAT_MODE.OFF);
  await gladys.fake.setValue(device(ICON2), featureOf(ICON2, 'child_lock'), 0);
  assert.deepEqual(api.commands, [
    {
      id: RADIATOR.id,
      commands: [
        { code: 'mode', value: 'leaving_home' },
        { code: 'last_click_time', value: '202610270800000101' },
      ],
    },
    { id: RADIATOR.id, commands: [{ code: 'mode', value: 'pause' }] },
    { id: ICON2.id, commands: [{ code: 'child_lock', value: false }] },
  ]);
  assert.equal(gladys.fake.lastState(feature(RADIATOR, 'mode')), THERMOSTAT_MODE.OFF);
  assert.equal(gladys.fake.lastState(feature(RADIATOR, 'preset')), THERMOSTAT_PRESET.FROST);
  assert.equal(gladys.fake.lastState(feature(RADIATOR, 'target_temperature')), 5, 'pause setpoint');
  const eco = await gladys.fake.setValue(
    device(RADIATOR),
    featureOf(RADIATOR, 'preset'),
    THERMOSTAT_PRESET.ECO,
  );
  assert.match(eco.error, /not available/);
  const cooling = await gladys.fake.setValue(
    device(RADIATOR),
    featureOf(RADIATOR, 'mode'),
    THERMOSTAT_MODE.COOLING,
  );
  assert.equal(cooling.success, false);
  assert.equal(gladys.fake.sceneEvents.length, 0, 'never an event for our own commands');
});

test('the quick readings fall back on /devices/{id} when /status answers 500', async () => {
  const { api, gladys, advance, device, featureOf } = await start();
  api.statusError = new ApiError(500, 'Internal Server Error');
  await gladys.fake.setValue(device(RADIATOR), featureOf(RADIATOR, 'child_lock'), 1);
  await advance(HOT_REFRESH_DELAYS_MS[0]);
  assert.deepEqual(api.calls.slice(-2), [
    `getDeviceStatus:${RADIATOR.id}`,
    `getDevice:${RADIATOR.id}`,
  ]);
  await advance(HOT_REFRESH_DELAYS_MS[1] - HOT_REFRESH_DELAYS_MS[0]);
  assert.equal(api.calls.at(-1), `getDevice:${RADIATOR.id}`, '/status is not tried again');
  // After 5 minutes the cloud value wins again.
  await advance(PENDING_MS);
  assert.equal(gladys.fake.lastState(feature(RADIATOR, 'child_lock')), 0);
});

test('scene triggers fire on transitions of the devices the user added', async () => {
  const { gladys, api, advance } = await start();
  api.devices[0] = variant(RADIATOR, { window_state: 'open', mode: 'leaving_home' });
  api.devices[1] = variant(ICON2, { battery_percentage: 11 }, { online: false });
  api.devices[2] = variant(ROOM_SENSOR, { battery_percentage: 4 });
  await advance(2 * 60 * 1000);
  const fired = gladys.fake.sceneEvents.map((e) => [e.key, e.data.device_name]);
  assert.deepEqual(fired, [
    ['window_opened', 'Living room'],
    ['mode_changed', 'Living room'],
    ['device_offline', 'Bathroom'],
    ['battery_low', 'Bedroom sensor'],
  ]);
  const mode = gladys.fake.sceneEvents[1].data;
  assert.deepEqual(
    [mode.mode, mode.previous_mode, mode.target_temperature],
    ['leaving_home', 'at_home', 17],
  );
  assert.equal(mode.device, ext(RADIATOR));
});

test('scene action: change the mode of every thermostat, offline ones counted as failed', async () => {
  const { gladys, api, clock } = await start();
  api.devices[1] = variant(ICON2, {}, { online: false });
  clock.now += MIN_MANUAL_GAP_MS;
  await gladys.fake.sceneAction('refresh', {});
  const ack = await gladys.fake.sceneAction('set_mode', { mode: 'leaving_home' });
  assert.deepEqual(ack.data.outputs, { count: 1, failed: 1 });
  assert.deepEqual(
    api.commands.map((c) => c.id),
    [RADIATOR.id],
  );
  const one = await gladys.fake.sceneAction('set_mode', { mode: 'pause', device: ext(RADIATOR) });
  assert.equal(one.success, true);
  const icon = await gladys.fake.sceneAction('set_mode', { mode: 'pause', device: ext(ICON_RT) });
  assert.match(icon.error, /does not take the Danfoss modes/);
  const unknown = await gladys.fake.sceneAction('set_mode', { mode: 'turbo' });
  assert.equal(unknown.success, false);
});

test('scene action: the setpoint of a mode, without changing the mode', async () => {
  const { gladys, api } = await start();
  const away = await gladys.fake.sceneAction('set_mode_temperature', {
    device: ext(RADIATOR),
    mode: 'leaving_home',
    temperature: 16.5,
  });
  assert.deepEqual(away.data.outputs, { temperature: 16.5, mode: 'leaving_home' });
  const current = await gladys.fake.sceneAction('set_mode_temperature', {
    device: ext(ICON_RT),
    temperature: 19,
  });
  assert.deepEqual(current.data.outputs, { temperature: 19, mode: 'hot' });
  assert.deepEqual(
    api.commands.map((c) => c.commands),
    [[{ code: 'leaving_home_setting', value: 165 }], [{ code: 'temp_set', value: 190 }]],
  );
  const none = await gladys.fake.sceneAction('set_mode_temperature', {
    device: ext(ICON_RT),
    mode: 'leaving_home',
    temperature: 17,
  });
  assert.match(none.error, /no leaving_home setpoint/);
});

test('scene action: an external temperature, 5 minutes apart at most, "off" stops it', async () => {
  const { gladys, api, clock } = await start();
  const first = await gladys.fake.sceneAction('set_external_temperature', {
    device: ext(RADIATOR),
    temperature: '20,46',
  });
  assert.deepEqual(first.data.outputs, {
    sent: true,
    temperature: 20.5,
    wait_seconds: 0,
  });
  clock.now += 60 * 1000;
  const early = await gladys.fake.sceneAction('set_external_temperature', {
    device: ext(RADIATOR),
    temperature: '21',
  });
  assert.deepEqual(early.data.outputs, {
    sent: false,
    temperature: 21,
    wait_seconds: 240,
  });
  const stop = await gladys.fake.sceneAction('set_external_temperature', {
    device: ext(RADIATOR),
    temperature: 'off',
  });
  assert.equal(stop.data.outputs.sent, true);
  assert.deepEqual(
    api.commands.map((c) => c.commands.map((command) => command.value)),
    [
      [true, 2050, 205],
      [false, -8000, -800],
    ],
  );
  const sensor = await gladys.fake.sceneAction('set_external_temperature', {
    device: ext(ICON2),
    temperature: '20',
  });
  assert.match(sensor.error, /radiator thermostats only/);
  const bad = await gladys.fake.sceneAction('set_external_temperature', {
    device: ext(RADIATOR),
    temperature: 'warm',
  });
  assert.match(bad.error, /not a temperature/);
});

test('scene action and buttons: read now, at most every 15 seconds', async () => {
  const { gladys, api, clock } = await start();
  const ack = await gladys.fake.sceneAction('refresh', {});
  assert.deepEqual(ack.data.outputs, { devices: 4, online: 4 });
  assert.equal(api.calls.length, 1, 'read at the connection less than 15 s ago');
  clock.now += MIN_MANUAL_GAP_MS;
  await gladys.fake.sceneAction('refresh', {});
  assert.equal(api.calls.length, 2);
  const toast = await gladys.fake.widgetAction('status', 'refresh', {}, { settings: {} });
  assert.equal(toast.success, true);
  assert.equal(api.calls.length, 2);
  api.failNext = new NetworkError('ENOTFOUND');
  clock.now += MIN_MANUAL_GAP_MS;
  const failed = await gladys.fake.sceneAction('refresh', {});
  assert.equal(failed.success, false);
});

test('widgets: the rooms with the buttons for the whole home, the connection', async () => {
  const { gladys, api } = await start();
  const ack = await gladys.fake.widgetGet('rooms', {
    settings: {},
    language: 'fr',
    units: 'metric',
  });
  const items = ack.data.content.components.find((c) => c.type === 'card-list').items;
  assert.deepEqual(
    items.map((item) => item.title),
    ['Bathroom', 'Bedroom sensor', 'Icon RT 8', 'Living room'],
  );
  const chosen = await gladys.fake.widgetGet('rooms', {
    settings: { devices: [ext(ICON2)] },
    language: 'en',
    units: 'metric',
  });
  assert.equal(chosen.data.content.components.find((c) => c.type === 'card-list').items.length, 1);
  const toast = await gladys.fake.widgetAction('rooms', 'all_at_home', {}, { settings: {} });
  assert.equal(toast.data.message.fr, 'Maison envoyé à 2 thermostat(s).');
  assert.deepEqual(
    api.commands.map((c) => c.id),
    [RADIATOR.id, ICON2.id],
  );
  const status = await gladys.fake.widgetGet('status', { settings: {}, language: 'de' });
  const rows = status.data.content.components.find((c) => c.type === 'status').items;
  assert.equal(rows[0].value, 'Verbunden');
  const unknown = await gladys.fake.widgetAction('rooms', 'explode', {}, { settings: {} });
  assert.equal(unknown.success, false);
});

test('widgets: a device renamed in Gladys shows under its Gladys name', async () => {
  const { gladys, device, clock } = await start();
  const titles = async () =>
    (
      await gladys.fake.widgetGet('rooms', { settings: {}, language: 'fr', units: 'metric' })
    ).data.content.components
      .find((c) => c.type === 'card-list')
      .items.map((item) => item.title);
  clock.now += 60 * 1000;
  await gladys.fake.deviceUpdated({ ...device(RADIATOR), name: 'Salon' });
  assert.ok(gladys.fake.widgetRefreshes.includes('rooms'));
  assert.deepEqual(await titles(), ['Bathroom', 'Bedroom sensor', 'Icon RT 8', 'Salon']);
  // Discovery keeps the Danfoss name.
  assert.ok(gladys.fake.discoveredDevices.some((d) => d.name === 'Living room'));
});

test('refused credentials: shown, retried after 30 minutes or new credentials', async () => {
  const api = fakeApi();
  api.failNext = new CredentialsError('API_KEY_INVALID', 401);
  const { gladys, advance, app } = await start({ api, created: false });
  assert.equal(app.connection(), 'refused');
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /API_KEY_INVALID/);
  await advance(10 * 60 * 1000);
  assert.equal(api.calls.length, 1, 'no hammering');
  await advance(REFUSED_RETRY_MS);
  assert.equal(api.calls.length, 2);
  assert.equal(app.connection(), 'ok');
  api.failNext = new CredentialsError('FORBIDDEN', 403);
  await gladys.fake.configUpdated({ consumer_key: 'new', consumer_secret: 'pair' });
  assert.equal(app.connection(), 'refused');
  await gladys.fake.configUpdated({ consumer_key: 'newer', consumer_secret: 'pair' });
  assert.equal(api.calls.length, 4, 'new credentials are tried at once');
  assert.equal(app.connection(), 'ok');
});

test('a 429 slows the readings down, doubling, up to 30 minutes', async () => {
  const api = fakeApi();
  const { gladys, advance, app, clock } = await start({ api });
  api.failNext = new RateLimitError(1000);
  await advance(2 * 60 * 1000);
  assert.equal(app.connection(), 'rate_limited');
  assert.match(gladys.fake.connectionStatus.message.en, /next reading in 4 min/);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  const calls = api.calls.length;
  await advance(3 * 60 * 1000);
  assert.equal(api.calls.length, calls);
  await advance(60 * 1000);
  assert.equal(api.calls.length, calls + 1);
  assert.equal(app.connection(), 'ok');
  assert.ok(clock.now > 0);
});

test('an unreachable API is shown and read again at the next interval', async () => {
  const api = fakeApi();
  const { gladys, advance, app } = await start({ api });
  api.failNext = new ApiError(503, 'Service Unavailable');
  await advance(2 * 60 * 1000);
  assert.equal(app.connection(), 'error');
  assert.match(gladys.fake.connectionStatus.message.en, /HTTP 503/);
  await advance(2 * 60 * 1000);
  assert.equal(app.connection(), 'ok');
});

test('"Test the connection" lists the devices, or says why it fails', async () => {
  const { gladys, api, clock } = await start();
  clock.now += MIN_MANUAL_GAP_MS;
  const ok = await gladys.fake.action('test_connection', {});
  assert.match(
    ok.data.message.en,
    /^Connected\. 5 device\(s\): Living room \(Danfoss Ally™ Radiator/,
  );
  assert.match(
    ok.data.message.fr,
    /Danfoss Ally™ Gateway \(Danfoss Ally™ Gateway, en ligne, non proposé/,
  );
  api.devices = [];
  const none = await gladys.fake.action('test_connection', {});
  assert.match(none.data.message.en, /same e-mail address/);
  api.failNext = new CredentialsError('API_KEY_INVALID', 401);
  const refused = await gladys.fake.action('test_connection', {});
  assert.match(refused.data.message.es, /rechaza las credenciales/);
  await gladys.fake.configUpdated({});
  const empty = await gladys.fake.action('test_connection', {});
  assert.match(empty.data.message.de, /Consumer Key/);
});

test('the language of the widgets names the features when set to automatic', async () => {
  const { gladys } = await start({ created: false });
  assert.equal(gladys.fake.discoveredDevices[0].features[0].name, 'Consigne', 'guessed from TZ');
  await gladys.fake.widgetGet('status', { settings: {}, language: 'de' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gladys.fake.config.last_language, 'de');
  assert.equal(gladys.fake.discoveredDevices[0].features[0].name, 'Solltemperatur');
  await gladys.fake.configUpdated({ ...gladys.fake.config, language: 'es' });
  assert.equal(gladys.fake.discoveredDevices[0].features[0].name, 'Consigna');
});

test('the trigger state survives a restart, in a 0600 file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'danfoss-ally-'));
  const statePath = join(dir, 'state.json');
  const first = await start({ statePath });
  assert.equal(statSync(statePath).mode & 0o777, 0o600);
  await first.gladys.fake.shutdown('SIGTERM');
  const api = fakeApi();
  api.devices[0] = variant(RADIATOR, { window_state: 'open' });
  const second = await start({ statePath, api, devices: first.gladys.fake.devices });
  assert.deepEqual(
    second.gladys.fake.sceneEvents.map((e) => e.key),
    ['window_opened'],
    'the window opened while the integration restarted',
  );
  const saved = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.equal(saved.snapshots[RADIATOR.id].window, true);
  assert.equal(Object.keys(saved.snapshots).length, 5);
});

test('a scan reads again and republishes the devices', async () => {
  const { gladys, api, clock } = await start({ created: false });
  clock.now += MIN_MANUAL_GAP_MS;
  api.devices.push({ ...ROOM_SENSOR, id: 'bfnewsensor', name: 'Office sensor' });
  await gladys.fake.scanRequest();
  assert.equal(gladys.fake.discoveredDevices.length, 5);
  assert.equal(gladys.fake.discoveredDevices.at(-1).name, 'Office sensor');
});

test('end to end with the real API client on a fake Danfoss server', async () => {
  const commands = [];
  const { api } = apiWithFetch((url, init) => {
    const path = new URL(url).pathname;
    if (path === '/oauth2/token')
      return { status: 200, body: { access_token: 't', expires_in: 3600 } };
    if (path === '/ally/devices') return { status: 200, body: { result: [RADIATOR, ICON2], t: 1 } };
    if (path.endsWith('/commands')) {
      commands.push(JSON.parse(init.body));
      return { status: 201, body: { t: 2 } };
    }
    return { status: 404, body: {} };
  });
  const { gladys, device, featureOf } = await start({ api });
  assert.equal(gladys.fake.discoveredDevices.length, 2);
  const ack = await gladys.fake.setValue(device(ICON2), featureOf(ICON2, 'target_temperature'), 23);
  assert.equal(ack.success, true);
  assert.deepEqual(commands, [{ commands: [{ code: 'manual_mode_fast', value: 230 }] }]);
  const status = await gladys.fake.widgetGet('status', { settings: {}, language: 'en' });
  const [, requests] = status.data.content.components.filter((c) => c.type === 'value');
  assert.equal(requests.value, 3, 'token, devices, command');
});
