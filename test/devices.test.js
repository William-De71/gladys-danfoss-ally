// The traps of the Gladys core that the fake Gladys does not catch
// (community feedback, thread 11005): a device is only polled with
// should_poll AND poll_frequency, every feature needs min / max / read_only /
// has_feedback, a wrong category / type pair shows no icon nor label, and a
// single invalid field rejects the whole discovery batch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';

import { parseDevice } from '../src/ally.js';
import {
  buildDevice,
  buildStates,
  isPublishable,
  FEATURE_KEYS,
  MODE_OF,
  PRESET_OF,
  MODE_TO_DANFOSS,
  PRESET_TO_DANFOSS,
} from '../src/device.js';
import {
  THERMOSTAT_MODE,
  THERMOSTAT_PRESET,
  THERMOSTAT_OPERATING_STATE,
  OPENING_SENSOR_STATE,
} from '../src/constants.js';
import { LANGUAGES } from '../src/i18n.js';
import {
  ALL,
  RADIATOR,
  ICON2,
  ROOM_SENSOR,
  ICON_RT,
  GATEWAY,
  variant,
  fakeGladys,
} from './helpers/fixtures.js';

const models = ALL.map(parseDevice);
const devices = (language) =>
  models.filter(isPublishable).map((model) => buildDevice(fakeGladys, model, language));
const keysOf = (raw) =>
  buildDevice(fakeGladys, parseDevice(raw)).features.map((f) => f.external_id.split(':').pop());
const statesOf = (raw) =>
  Object.fromEntries(
    buildStates(fakeGladys, parseDevice(raw)).map((s) => [
      s.device_feature_external_id.split(':').pop(),
      s.state,
    ]),
  );

// DEVICE_FEATURE_UNITS_BY_CATEGORY of the Gladys core 5.3.0
// (server/utils/constants.js), and the pairs the front labels
// (front/src/config/i18n: deviceFeatureCategory.<category>.<type>).
const UNITS_OF = {
  [CATEGORIES.THERMOSTAT]: [UNITS.CELSIUS, UNITS.FAHRENHEIT],
  [CATEGORIES.TEMPERATURE_SENSOR]: [UNITS.CELSIUS, UNITS.FAHRENHEIT, UNITS.KELVIN],
  [CATEGORIES.HUMIDITY_SENSOR]: [UNITS.PERCENT],
  [CATEGORIES.BATTERY]: [UNITS.PERCENT],
};
// thermostat preset / mode / operating-state carry no unit in the core.
const NO_UNIT = [
  TYPES.THERMOSTAT.MODE,
  TYPES.THERMOSTAT.PRESET,
  TYPES.THERMOSTAT.OPERATING_STATE,
  TYPES.SENSOR.BINARY,
  TYPES.CHILD_LOCK.BINARY,
];
const PAIRS = [
  [CATEGORIES.THERMOSTAT, TYPES.THERMOSTAT.TARGET_TEMPERATURE],
  [CATEGORIES.THERMOSTAT, TYPES.THERMOSTAT.MODE],
  [CATEGORIES.THERMOSTAT, TYPES.THERMOSTAT.PRESET],
  [CATEGORIES.THERMOSTAT, TYPES.THERMOSTAT.OPERATING_STATE],
  [CATEGORIES.TEMPERATURE_SENSOR, TYPES.SENSOR.DECIMAL],
  [CATEGORIES.HUMIDITY_SENSOR, TYPES.SENSOR.DECIMAL],
  [CATEGORIES.BATTERY, TYPES.BATTERY.INTEGER],
  [CATEGORIES.OPENING_SENSOR, TYPES.SENSOR.BINARY],
  [CATEGORIES.CHILD_LOCK, TYPES.CHILD_LOCK.BINARY],
];
const WRITABLE = ['target_temperature', 'mode', 'preset', 'child_lock'];

test('devices are never polled by Gladys: the integration has its own clock', () => {
  for (const device of devices('en')) {
    assert.equal(device.should_poll, false, device.external_id);
    assert.equal(device.poll_frequency, undefined);
  }
});

test('every feature carries min, max, read_only and has_feedback, in every language', () => {
  for (const language of LANGUAGES) {
    for (const device of devices(language)) {
      for (const feature of device.features) {
        for (const key of ['min', 'max']) {
          assert.equal(typeof feature[key], 'number', `${feature.external_id}.${key}`);
        }
        assert.ok(feature.min <= feature.max, feature.external_id);
        assert.equal(typeof feature.read_only, 'boolean', feature.external_id);
        assert.equal(typeof feature.has_feedback, 'boolean', feature.external_id);
        const key = feature.external_id.split(':').pop();
        assert.equal(feature.read_only, !WRITABLE.includes(key), feature.external_id);
        assert.equal(feature.has_feedback, WRITABLE.includes(key), feature.external_id);
        assert.ok(feature.name, feature.external_id);
        for (const field of ['present', 'value', 'key']) assert.equal(feature[field], undefined);
      }
    }
  }
});

test('every category / type pair is a known one, every unit belongs to its category', () => {
  for (const device of devices('en')) {
    for (const feature of device.features) {
      assert.ok(
        PAIRS.some(([category, type]) => feature.category === category && feature.type === type),
        `${feature.external_id}: ${feature.category} / ${feature.type}`,
      );
      if (NO_UNIT.includes(feature.type)) {
        assert.equal(feature.unit, undefined, feature.external_id);
      } else {
        assert.ok(UNITS_OF[feature.category].includes(feature.unit), feature.external_id);
      }
    }
  }
});

test('the features follow the status codes of each model', () => {
  assert.deepEqual(keysOf(RADIATOR), [
    'target_temperature',
    'mode',
    'preset',
    'operating_state',
    'temperature',
    'battery',
    'window',
    'child_lock',
  ]);
  assert.deepEqual(keysOf(ICON2), [
    'target_temperature',
    'mode',
    'preset',
    'operating_state',
    'temperature',
    'floor_temperature',
    'humidity',
    'battery',
    'child_lock',
  ]);
  assert.deepEqual(keysOf(ROOM_SENSOR), ['temperature', 'humidity', 'battery']);
  assert.deepEqual(keysOf(ICON_RT), ['target_temperature'], 'a single setpoint, no Danfoss modes');
  assert.equal(isPublishable(parseDevice(GATEWAY)), false);
  for (const key of FEATURE_KEYS) assert.match(key, /^[a-z_]+$/);
});

test('the setpoint: 5 to 35 °C by 0.5 °C, the one of the current mode', () => {
  const [setpoint] = buildDevice(fakeGladys, parseDevice(RADIATOR)).features;
  assert.deepEqual([setpoint.min, setpoint.max, setpoint.step], [5, 35, 0.5]);
  assert.equal(statesOf(RADIATOR).target_temperature, 21, 'at home');
  assert.equal(statesOf(variant(RADIATOR, { mode: 'leaving_home' })).target_temperature, 17);
  assert.equal(statesOf(ICON2).target_temperature, 22, 'manual');
  assert.equal(statesOf(ICON_RT).target_temperature, 20, 'temp_set');
});

test('the Danfoss mode becomes the Gladys mode + preset pair, and back', () => {
  const pair = (mode) => {
    const states = statesOf(variant(RADIATOR, { mode }));
    return [states.mode, states.preset];
  };
  assert.deepEqual(pair('at_home'), [THERMOSTAT_MODE.AUTO, THERMOSTAT_PRESET.COMFORT]);
  assert.deepEqual(pair('leaving_home'), [THERMOSTAT_MODE.AUTO, THERMOSTAT_PRESET.AWAY]);
  assert.deepEqual(pair('holiday'), [THERMOSTAT_MODE.AUTO, THERMOSTAT_PRESET.AWAY]);
  assert.deepEqual(pair('holiday_sat'), [THERMOSTAT_MODE.AUTO, THERMOSTAT_PRESET.COMFORT]);
  assert.deepEqual(pair('pause'), [THERMOSTAT_MODE.OFF, THERMOSTAT_PRESET.FROST]);
  assert.deepEqual(pair('manual'), [THERMOSTAT_MODE.HEATING, undefined], 'no preset in manual');
  assert.deepEqual(pair('something_new'), [undefined, undefined]);
  assert.deepEqual(MODE_TO_DANFOSS, { 0: 'pause', 1: 'manual', 3: 'at_home' });
  assert.deepEqual(PRESET_TO_DANFOSS, { 1: 'pause', 2: 'leaving_home', 5: 'at_home' });
  // Every value written back reads back to itself.
  for (const [value, mode] of Object.entries(MODE_TO_DANFOSS)) {
    assert.equal(MODE_OF[mode], Number(value));
  }
  for (const [value, mode] of Object.entries(PRESET_TO_DANFOSS)) {
    assert.equal(PRESET_OF[mode], Number(value));
  }
});

test('supported options: integers within the bounds, the ones that can be written', () => {
  const device = buildDevice(fakeGladys, parseDevice(RADIATOR));
  const byKey = Object.fromEntries(device.features.map((f) => [f.external_id.split(':').pop(), f]));
  assert.deepEqual(
    byKey.mode.supported_options.map((o) => o.value),
    Object.keys(MODE_TO_DANFOSS).map(Number),
  );
  assert.deepEqual(
    byKey.preset.supported_options.map((o) => o.value),
    Object.keys(PRESET_TO_DANFOSS).map(Number),
  );
  for (const feature of [byKey.mode, byKey.preset]) {
    for (const option of feature.supported_options) {
      assert.ok(Number.isInteger(option.value));
      assert.ok(option.value >= feature.min && option.value <= feature.max);
      assert.equal(typeof option.label, 'string');
    }
  }
});

test('window: opening-sensor 0 is OPEN, 1 is CLOSED; operating state; child lock', () => {
  assert.equal(statesOf(RADIATOR).window, OPENING_SENSOR_STATE.CLOSE);
  assert.equal(
    statesOf(variant(RADIATOR, { window_state: 'open' })).window,
    OPENING_SENSOR_STATE.OPEN,
  );
  assert.equal(statesOf(RADIATOR).operating_state, THERMOSTAT_OPERATING_STATE.HEATING);
  assert.equal(
    statesOf(variant(RADIATOR, { pi_heating_demand: 0 })).operating_state,
    THERMOSTAT_OPERATING_STATE.IDLE,
  );
  assert.equal(statesOf(RADIATOR).child_lock, 0);
  assert.equal(statesOf(ICON2).child_lock, 1);
  assert.deepEqual(
    [statesOf(ICON2).floor_temperature, statesOf(ICON2).humidity, statesOf(ICON2).battery],
    [24.8, 56.2, 12],
  );
});

test('external ids come from the Danfoss id, never from the name', () => {
  const device = buildDevice(fakeGladys, parseDevice(RADIATOR), 'fr');
  assert.equal(device.external_id, `ext:test-integration:ally:${RADIATOR.id}`);
  const renamed = buildDevice(fakeGladys, parseDevice({ ...RADIATOR, name: 'Salon' }), 'fr');
  assert.deepEqual(
    renamed.features.map((f) => f.external_id),
    device.features.map((f) => f.external_id),
  );
  assert.equal(renamed.name, 'Salon');
  assert.equal(device.features[0].name, 'Consigne');
  const odd = buildDevice(fakeGladys, parseDevice({ ...ICON_RT, id: 'a:b' }));
  assert.equal(odd.external_id, 'ext:test-integration:ally:a%3Ab');
  const unnamed = buildDevice(fakeGladys, parseDevice({ ...ICON_RT, name: '  ' }));
  assert.equal(unnamed.name, 'Icon RT tiwy');
  assert.deepEqual(device.params, [
    { name: 'DANFOSS_MODEL', value: 'Danfoss Ally™ Radiator Thermostat' },
  ]);
});

test('the whole Discovery batch and the states are accepted by the fake Gladys', async () => {
  for (const language of LANGUAGES) {
    const gladys = createFakeGladys();
    await gladys.connect();
    await gladys.publishDiscoveredDevices(
      models.filter(isPublishable).map((model) => buildDevice(gladys, model, language)),
    );
    assert.equal(gladys.fake.discoveredDevices.length, 4);
    await gladys.publishStates(models.flatMap((model) => buildStates(gladys, model)));
    assert.equal(gladys.fake.requests.filter((r) => r.status >= 400).length, 0);
    await gladys.disconnect();
  }
});
