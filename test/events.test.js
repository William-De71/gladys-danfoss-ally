import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseDevice } from '../src/ally.js';
import {
  TRIGGERS,
  detectEvents,
  snapshotOf,
  faultKey,
  parseExternalTemperature,
} from '../src/events.js';
import { RADIATOR, variant } from './helpers/fixtures.js';

const context = (overrides = {}) => ({
  device: 'ext:test-integration:ally:x',
  name: 'Living room',
  threshold: 20,
  target: 21,
  isExpectedMode: () => false,
  ...overrides,
});
const run = (before, after, overrides) => {
  const previous = snapshotOf(parseDevice(before), null, 20);
  return detectEvents(previous, parseDevice(after), context(overrides)).events;
};
const keys = (events) => events.map((event) => event.key);

test('the first reading sets the baseline: nothing fires', () => {
  const { events, snapshot } = detectEvents(
    null,
    parseDevice(variant(RADIATOR, { window_state: 'open', battery_percentage: 5 })),
    context(),
  );
  assert.deepEqual(events, []);
  assert.deepEqual(snapshot, {
    online: true,
    window: true,
    mode: 'at_home',
    fault: null,
    batteryLow: true,
  });
});

test('window opened, then closed', () => {
  const open = variant(RADIATOR, { window_state: 'open' });
  const opened = run(RADIATOR, open);
  assert.deepEqual(keys(opened), [TRIGGERS.WINDOW_OPENED]);
  assert.deepEqual(opened[0].data, {
    device: 'ext:test-integration:ally:x',
    device_name: 'Living room',
    temperature: 19.8,
  });
  assert.deepEqual(keys(run(open, RADIATOR)), [TRIGGERS.WINDOW_CLOSED]);
  assert.deepEqual(run(RADIATOR, RADIATOR), []);
});

test('battery low once, until it goes 5 points above the threshold', () => {
  const at = (level) => variant(RADIATOR, { battery_percentage: level });
  const events = run(at(21), at(19));
  assert.deepEqual(keys(events), [TRIGGERS.BATTERY_LOW]);
  assert.deepEqual([events[0].data.battery, events[0].data.threshold], [19, 20]);
  // Hovering around the threshold: no new event.
  let snapshot = snapshotOf(parseDevice(at(19)), null, 20);
  for (const level of [21, 18, 22, 19]) {
    const result = detectEvents(snapshot, parseDevice(at(level)), context());
    assert.deepEqual(result.events, [], `level ${level}`);
    snapshot = result.snapshot;
  }
  // A new battery (above threshold + 5), then low again: fires again.
  snapshot = detectEvents(snapshot, parseDevice(at(100)), context()).snapshot;
  assert.equal(snapshot.batteryLow, false);
  assert.deepEqual(keys(detectEvents(snapshot, parseDevice(at(15)), context()).events), [
    TRIGGERS.BATTERY_LOW,
  ]);
});

test('offline, then back online', () => {
  const offline = variant(RADIATOR, {}, { online: false });
  const events = run(RADIATOR, offline);
  assert.deepEqual(keys(events), [TRIGGERS.DEVICE_OFFLINE]);
  assert.equal(events[0].data.model, 'Danfoss Ally™ Radiator Thermostat');
  assert.deepEqual(keys(run(offline, RADIATOR)), [TRIGGERS.DEVICE_ONLINE]);
});

test('a fault fires once per new code', () => {
  const fault = variant(RADIATOR, { fault: 4 });
  const events = run(RADIATOR, fault);
  assert.deepEqual(keys(events), [TRIGGERS.FAULT_REPORTED]);
  assert.deepEqual(
    [events[0].data.fault, events[0].data.error_code, events[0].data.summary],
    ['4', null, 'fault 4'],
  );
  assert.deepEqual(run(fault, fault), []);
  assert.deepEqual(keys(run(fault, variant(fault, { sw_error_code: 'E3' }))), [
    TRIGGERS.FAULT_REPORTED,
  ]);
  assert.deepEqual(run(fault, RADIATOR), [], 'a fault that clears fires nothing');
  assert.equal(faultKey(parseDevice(variant(RADIATOR, { sw_error_code: 7 }))), 'error 7');
});

test('a mode change fires, unless the integration asked for it', () => {
  const away = variant(RADIATOR, { mode: 'leaving_home' });
  const events = run(RADIATOR, away, { target: 17 });
  assert.deepEqual(keys(events), [TRIGGERS.MODE_CHANGED]);
  assert.deepEqual(events[0].data, {
    device: 'ext:test-integration:ally:x',
    device_name: 'Living room',
    mode: 'leaving_home',
    previous_mode: 'at_home',
    target_temperature: 17,
  });
  assert.deepEqual(run(RADIATOR, away, { isExpectedMode: (mode) => mode === 'leaving_home' }), []);
});

test('event data stay flat and scalar', () => {
  const after = variant(
    RADIATOR,
    { window_state: 'open', battery_percentage: 3, fault: 2, mode: 'pause' },
    { online: false },
  );
  const events = run(RADIATOR, after);
  assert.equal(events.length, 5);
  for (const { data } of events) {
    assert.ok(Object.keys(data).length <= 30);
    for (const value of Object.values(data)) {
      assert.ok(
        value === null || ['string', 'number', 'boolean'].includes(typeof value),
        JSON.stringify(value),
      );
    }
  }
});

test('the external temperature field: numbers, variables already resolved, "off"', () => {
  assert.equal(parseExternalTemperature('21.46'), 21.5);
  assert.equal(parseExternalTemperature('21,4'), 21.4);
  assert.equal(parseExternalTemperature(' 19 °C '), 19);
  assert.equal(parseExternalTemperature(20), 20);
  for (const word of ['off', 'OFF', '', 'none', 'clear']) {
    assert.equal(parseExternalTemperature(word), null, word);
  }
  assert.throws(() => parseExternalTemperature('{{a.b}}'), RangeError);
  assert.throws(() => parseExternalTemperature('60'), RangeError);
  assert.throws(() => parseExternalTemperature('-11'), RangeError);
});
