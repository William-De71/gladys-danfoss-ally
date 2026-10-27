import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { TRIGGERS, SCENE_ACTIONS } from '../src/events.js';
import { ACTIONS } from '../src/app.js';
import { WIDGETS, WIDGET_ACTIONS } from '../src/widgets.js';
import { REFRESH_MINUTES, BATTERY_THRESHOLD, AUTO_LANGUAGE } from '../src/config.js';
import { SETTABLE_MODES, SETPOINT_RANGE } from '../src/ally.js';
import { LANGUAGES } from '../src/i18n.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const manifest = read('../gladys-assistant-integration.json');
const pkg = read('../package.json');
const byKey = (list) => new Map(list.map((entry) => [entry.key, entry]));
const values = (field) => field.options.map((option) => option.value);
const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const REPO = 'William-De71/gladys-danfoss-ally';

test('a device integration, in lockstep with package.json, at 0.x until 1.0.0 is decided', () => {
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.name, 'Danfoss Ally');
  assert.equal(manifest.version, pkg.version);
  assert.match(pkg.version, /^0\./);
  assert.equal(manifest.docker_image, `ghcr.io/william-de71/gladys-danfoss-ally:${pkg.version}`);
  assert.equal(manifest.cover_image, `https://raw.githubusercontent.com/${REPO}/main/cover.jpg`);
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.name, 'gladys-danfoss-ally');
});

test('declares the cloud transport: the Danfoss Ally API only, never a local device', () => {
  assert.deepEqual(manifest.transports, ['cloud']);
  const api = source('../src/danfoss-api.js');
  assert.match(api, /https:\/\/api\.danfoss\.com/);
  for (const file of ['ally', 'app', 'device', 'events', 'widgets', 'state', 'config', 'i18n']) {
    assert.doesNotMatch(
      source(`../src/${file}.js`),
      /fetch\(|node:https?|node:net|node:dgram/,
      file,
    );
  }
  // A single channel: no transport to publish per device.
  assert.doesNotMatch(source('../src/app.js'), /publishTransports|GLADYS_PREFER_LOCAL/);
});

test('Gladys 5.3.0 for the catalog keywords; no widget form; no permission', () => {
  assert.equal(manifest.gladys_version, '>=5.3.0');
  assert.doesNotMatch(source('../src/widgets.js'), /fields:/, 'no button form');
  assert.deepEqual(manifest.categories, ['climate']);
  for (const key of ['location', 'network_wake', 'containers', 'network_discovery', 'webhooks']) {
    assert.equal(manifest[key], undefined, key);
  }
  const config = byKey(manifest.config_schema);
  assert.deepEqual(
    [config.get('consumer_key').type, config.get('consumer_key').required],
    ['string', true],
  );
  assert.deepEqual(
    [config.get('consumer_secret').type, config.get('consumer_secret').required],
    ['secret', true],
  );
  assert.equal(config.get('consumer_secret').default, undefined);
});

test('declares exactly the scene triggers, actions and widgets the code handles', () => {
  const app = source('../src/app.js');
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key),
    Object.values(TRIGGERS),
  );
  assert.deepEqual(
    manifest.scene_actions.map((a) => a.key),
    Object.values(SCENE_ACTIONS),
  );
  assert.deepEqual(
    manifest.widgets.map((w) => w.key),
    Object.values(WIDGETS),
  );
  for (const key of Object.keys(WIDGETS)) {
    assert.match(app, new RegExp(`onWidgetGet\\(WIDGETS\\.${key}`), key);
    assert.match(app, new RegExp(`onWidgetAction\\(WIDGETS\\.${key}`), key);
  }
  assert.deepEqual(Object.values(WIDGET_ACTIONS), ['all_at_home', 'all_leaving_home', 'refresh']);
  for (const key of Object.keys(SCENE_ACTIONS)) {
    assert.match(app, new RegExp(`onSceneAction\\(SCENE_ACTIONS\\.${key}`), key);
  }
  assert.deepEqual(
    manifest.actions.map((a) => a.key),
    Object.values(ACTIONS),
  );
  for (const key of Object.keys(ACTIONS)) {
    assert.match(app, new RegExp(`onAction\\(ACTIONS\\.${key}`), key);
  }
  // Every trigger filters by device; the fields are keys of the event data.
  for (const trigger of manifest.scene_triggers) {
    const device = trigger.fields[0];
    assert.deepEqual([device.key, device.type, device.source], ['device', 'select', 'devices']);
    assert.ok(!device.required, `${trigger.key}: empty = every device`);
    const variables = trigger.variables.map((v) => v.key);
    assert.deepEqual(variables.slice(0, 2), ['device', 'device_name'], trigger.key);
  }
  const mode = byKey(manifest.scene_triggers).get('mode_changed').fields[1];
  assert.deepEqual([mode.key, mode.type], ['mode', 'multi_select']);
  assert.deepEqual(values(mode), SETTABLE_MODES);
});

test('the scene actions mirror the code: modes, bounds, outputs', () => {
  const actions = byKey(manifest.scene_actions);
  const setMode = byKey(actions.get('set_mode').fields);
  assert.deepEqual(values(setMode.get('mode')), SETTABLE_MODES);
  assert.ok(!setMode.get('device').required, 'empty = every thermostat');
  const setpoint = byKey(actions.get('set_mode_temperature').fields);
  assert.deepEqual(values(setpoint.get('mode')), ['current', ...SETTABLE_MODES]);
  assert.equal(setpoint.get('mode').default, 'current');
  assert.deepEqual(
    [setpoint.get('temperature').min, setpoint.get('temperature').max],
    [SETPOINT_RANGE.min, SETPOINT_RANGE.max],
  );
  // A string field: the core renders the scene variables of string fields.
  const external = byKey(actions.get('set_external_temperature').fields);
  assert.equal(external.get('temperature').type, 'string');
  assert.deepEqual(
    actions.get('set_external_temperature').outputs.map((o) => [o.key, o.type]),
    [
      ['sent', 'boolean'],
      ['temperature', 'number'],
      ['wait_seconds', 'number'],
    ],
  );
  assert.deepEqual(
    actions.get('refresh').outputs.map((o) => o.key),
    ['devices', 'online'],
  );
});

test('the configuration mirrors the code', () => {
  const config = byKey(manifest.config_schema);
  const minutes = config.get('refresh_minutes');
  assert.deepEqual(values(minutes), REFRESH_MINUTES.options.map(String));
  assert.equal(minutes.default, String(REFRESH_MINUTES.default));
  const battery = config.get('battery_threshold');
  for (const bound of ['min', 'max', 'default']) {
    assert.equal(battery[bound], BATTERY_THRESHOLD[bound]);
  }
  const language = config.get('language');
  assert.deepEqual(values(language), [AUTO_LANGUAGE, ...LANGUAGES]);
  assert.equal(language.default, AUTO_LANGUAGE);
  const intro = config.get('intro');
  assert.equal(intro.type, 'section');
  assert.ok(intro.links.every((link) => link.url.startsWith('https://')));
  assert.match(intro.description.en, /same e-mail address/);
});

test('limits of the store: counts, timeouts, sizes, no secret in widget settings', () => {
  assert.ok(manifest.actions.length <= 10);
  assert.ok(manifest.widgets.length >= 1 && manifest.widgets.length <= 5);
  assert.ok(manifest.scene_triggers.length <= 20 && manifest.scene_actions.length <= 20);
  for (const trigger of manifest.scene_triggers) {
    assert.ok((trigger.fields ?? []).length <= 10 && trigger.variables.length <= 20, trigger.key);
    assert.ok(trigger.key.length <= 40);
  }
  for (const action of [...manifest.scene_actions, ...manifest.actions]) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120, action.key);
  }
  for (const widget of manifest.widgets) {
    for (const setting of widget.settings ?? []) {
      assert.ok(!['secret', 'oauth2', 'account_link'].includes(setting.type));
    }
  }
  const size = statSync(new URL('../gladys-assistant-integration.json', import.meta.url)).size;
  assert.ok(size < 100 * 1024, `${size} bytes`);
  const cover = readFileSync(new URL('../cover.jpg', import.meta.url));
  assert.ok(cover.length < 150 * 1024, `cover.jpg: ${cover.length} bytes`);
  assert.equal(cover.readUInt16BE(0), 0xffd8, 'cover.jpg is a JPEG');
});

test('catalog keywords of Gladys 5.3.0, sold everywhere: no countries', () => {
  const keywords = manifest.keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.ok(keywords.length >= 1 && keywords.length <= 10, 'one to ten keywords');
  keywords.forEach((keyword) => assert.ok(keyword.length >= 2 && keyword.length <= 30, keyword));
  assert.equal(new Set(keywords).size, keywords.length, 'unique once trimmed and lowercased');
  assert.equal(manifest.countries, undefined);
});
