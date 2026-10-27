import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseDevice,
  setpointCode,
  targetTemperature,
  hasModeSetpoints,
  encodeSetpoint,
  modeCommands,
  externalTemperatureCommands,
  faultCode,
  isInfrastructure,
  withStatus,
  toBool,
} from '../src/ally.js';
import { RADIATOR, ICON2, ROOM_SENSOR, ICON_RT, GATEWAY, variant } from './helpers/fixtures.js';

test('a radiator thermostat: tenths of a degree, hundredths for the external sensor', () => {
  const model = parseDevice(RADIATOR);
  assert.equal(model.id, RADIATOR.id);
  assert.equal(model.name, 'Living room');
  assert.equal(model.model, 'Danfoss Ally™ Radiator Thermostat');
  assert.equal(model.online, true);
  assert.equal(model.temperature, 19.8);
  assert.deepEqual(model.setpoints, {
    manual_mode_fast: 20,
    at_home_setting: 21,
    leaving_home_setting: 17,
    pause_setting: 5,
    holiday_setting: 15,
    temp_set: 21,
  });
  assert.equal(model.mode, 'at_home');
  assert.equal(model.battery, 76);
  assert.equal(model.windowOpen, false);
  assert.equal(model.valveOpening, 42);
  assert.equal(model.heating, true);
  assert.equal(model.childLock, false);
  assert.equal(model.fault, null, '0 is no fault');
  assert.equal(model.lowerTemp, 5);
  assert.equal(model.upperTemp, 35);
  assert.equal(model.externalTemperature, null, '-8000: no external sensor');
  assert.equal(model.acceptsExternal, true);
  assert.equal(model.radiatorCovered, false);
  assert.equal(model.floorTemperature, null);
  assert.equal(model.infrastructure, false);
});

test('an Icon2 room thermostat: floor sensor, humidity, output status', () => {
  const model = parseDevice(ICON2);
  assert.equal(model.floorTemperature, 24.8);
  assert.equal(model.humidity, 56.2);
  assert.equal(model.heating, true, 'output_status active');
  assert.equal(model.valveOpening, null);
  assert.equal(model.mode, 'manual');
  assert.equal(model.childLock, true);
  assert.equal(model.acceptsExternal, false);
  const idle = parseDevice(variant(ICON2, { output_status: 'inactive' }));
  assert.equal(idle.heating, false);
  const noFloor = parseDevice(variant(ICON2, { floor_sensor: false }));
  assert.equal(noFloor.floorTemperature, null, 'MeasuredValue is the floor only with floor_sensor');
});

test('values arrive as numbers, strings or booleans', () => {
  const model = parseDevice(
    variant(RADIATOR, {
      temp_current: '205',
      child_lock: 'true',
      window_state: 'open',
      battery_percentage: '120',
      pi_heating_demand: 0,
    }),
  );
  assert.equal(model.temperature, 20.5);
  assert.equal(model.childLock, true);
  assert.equal(model.windowOpen, true);
  assert.equal(model.battery, 100, 'bounded');
  assert.equal(model.heating, false);
  assert.equal(toBool('maybe'), null);
  assert.equal(toBool(0), false);
  const local = parseDevice({
    id: 'x',
    status: [{ code: 'local_temperature', value: 2134 }],
  });
  assert.equal(local.temperature, 21.34, 'hundredths');
  assert.equal(parseDevice({ id: 'y', status: null }).temperature, null);
  assert.equal(parseDevice({ id: 'z', online: 'false' }).online, false);
});

test('the setpoint follows the mode; a single temp_set is used as is', () => {
  const radiator = parseDevice(RADIATOR);
  assert.equal(hasModeSetpoints(radiator), true);
  assert.equal(setpointCode(radiator), 'at_home_setting');
  assert.equal(setpointCode(radiator, 'leaving_home'), 'leaving_home_setting');
  assert.equal(setpointCode(radiator, 'manual'), 'manual_mode_fast');
  assert.equal(setpointCode(radiator, 'holiday_sat'), 'at_home_setting');
  assert.equal(setpointCode(radiator, 'unknown'), 'temp_set');
  assert.equal(targetTemperature(parseDevice(variant(RADIATOR, { mode: 'pause' }))), 5);
  const icon = parseDevice(ICON_RT);
  assert.equal(hasModeSetpoints(icon), false);
  assert.equal(setpointCode(icon), 'temp_set');
  assert.equal(targetTemperature(icon), 20);
  assert.equal(setpointCode(parseDevice(ROOM_SENSOR)), null);
  assert.equal(targetTemperature(parseDevice(ROOM_SENSOR)), null);
});

test('setpoints are written in tenths, 5 to 35 °C by 0.5 °C', () => {
  assert.equal(encodeSetpoint(21), 210);
  assert.equal(encodeSetpoint(21.5), 215);
  assert.equal(encodeSetpoint(21.3), 215, 'rounded to the nearest 0.5');
  assert.equal(encodeSetpoint(21.2), 210);
  assert.equal(encodeSetpoint(5), 50);
  assert.equal(encodeSetpoint(35), 350);
  assert.throws(() => encodeSetpoint(4.5), RangeError);
  assert.throws(() => encodeSetpoint(35.5), RangeError);
  assert.throws(() => encodeSetpoint('warm'), RangeError);
});

test('a mode change carries last_click_time for at_home and leaving_home', () => {
  const date = new Date(2026, 9, 27, 7, 5);
  assert.deepEqual(modeCommands('at_home', date), [
    { code: 'mode', value: 'at_home' },
    { code: 'last_click_time', value: '202610270705010000' },
  ]);
  assert.deepEqual(modeCommands('leaving_home', date)[1], {
    code: 'last_click_time',
    value: '202610270705000101',
  });
  assert.deepEqual(modeCommands('pause', date), [{ code: 'mode', value: 'pause' }]);
});

test('an external temperature turns the radiator-covered mode on, -8000/-800 clear it', () => {
  assert.deepEqual(externalTemperatureCommands(21.37), [
    { code: 'radiator_covered', value: true },
    { code: 'ext_measured_rs', value: 2137 },
    { code: 'sensor_avg_temp', value: 214 },
  ]);
  assert.deepEqual(externalTemperatureCommands(null), [
    { code: 'radiator_covered', value: false },
    { code: 'ext_measured_rs', value: -8000 },
    { code: 'sensor_avg_temp', value: -800 },
  ]);
  const covered = parseDevice(variant(RADIATOR, { ext_measured_rs: 2050, radiator_covered: true }));
  assert.equal(covered.externalTemperature, 20.5);
  assert.equal(covered.radiatorCovered, true);
});

test('faults: 0, empty and "none" are no fault', () => {
  for (const value of [0, '0', '', null, undefined, false, 'none', 'NORMAL', []]) {
    assert.equal(faultCode(value), null, JSON.stringify(value));
  }
  assert.equal(faultCode(4), '4');
  assert.equal(faultCode('valve_blocked'), 'valve_blocked');
  assert.equal(faultCode([1, 2]), '1,2');
  const model = parseDevice(variant(RADIATOR, { fault: 8, sw_error_code: 'E12' }));
  assert.deepEqual([model.fault, model.errorCode], ['8', 'E12']);
});

test('gateways, boiler relays and repeaters are infrastructure', () => {
  assert.equal(isInfrastructure('Danfoss Ally™ Gateway'), true);
  assert.equal(isInfrastructure('Danfoss Ally(TM) Gateway'), true);
  assert.equal(isInfrastructure('Danfoss Ally Boiler Relay'), true);
  assert.equal(isInfrastructure('Danfoss Icon2 Controller'), true);
  assert.equal(isInfrastructure('Danfoss Zigbee Repeater'), true);
  assert.equal(isInfrastructure('Danfoss Ally™ Radiator Thermostat'), false);
  assert.equal(parseDevice(GATEWAY).infrastructure, true);
});

test('a status answer replaces the status list of the cached device', () => {
  const merged = withStatus(RADIATOR, [{ code: 'temp_current', value: 230 }]);
  assert.equal(merged.name, 'Living room');
  assert.deepEqual(merged.status, [{ code: 'temp_current', value: 230 }]);
  assert.equal(parseDevice(merged).temperature, 23);
  assert.deepEqual(withStatus(RADIATOR, undefined).status, []);
});
