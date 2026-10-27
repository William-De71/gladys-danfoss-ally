// -----------------------------------------------------------------------------
// The Danfoss Ally data model: what a device of `GET /ally/devices` says, and
// the commands `POST /ally/devices/{id}/commands` takes.
//
// A device is `{ id, name, online, device_type | model, update_time, status }`
// where `status` is a list of `{ code, value }`. The OpenAPI document of
// Danfoss (Danfoss Ally API 2.4.0) only describes that generic shape: the
// codes, their scales and the command semantics below are the facts observed
// on real devices and published by the pydanfossally project (its parser and
// its "writable properties research" note). No code was copied from it: this
// is a fresh JavaScript implementation of the same protocol facts.
//
//   - setpoints (`manual_mode_fast`, `at_home_setting`, `leaving_home_setting`,
//     `pause_setting`, `holiday_setting`, `temp_set`), `upper_temp`,
//     `lower_temp`, `temp_current`, `humidity_value` and the floor
//     `MeasuredValue` are tenths of a degree (or of a percent);
//   - `local_temperature` and `ext_measured_rs` are hundredths of a degree,
//     -8000 meaning "no external sensor";
//   - `mode` is `at_home`, `leaving_home`, `pause`, `manual`, `holiday`,
//     `holiday_sat`, or `hot` on the first Icon room thermostats;
//   - writing a setpoint takes whole tenths, 5 to 35 °C by steps of 0.5 °C;
//   - switching to `at_home` / `leaving_home` also takes `last_click_time`,
//     the local time `YYYYMMDDHHmm` followed by a fixed suffix.
// -----------------------------------------------------------------------------

const SETPOINT_CODES = [
  'manual_mode_fast',
  'at_home_setting',
  'leaving_home_setting',
  'pause_setting',
  'holiday_setting',
  'temp_set',
];
// The per-mode setpoints: a device that lacks one of them has a single
// setpoint, `temp_set` (the first Icon room thermostats).
const MODE_SETPOINT_CODES = SETPOINT_CODES.slice(0, 5);

// Which setpoint a mode heats to.
const MODE_TO_SETPOINT_CODE = {
  at_home: 'at_home_setting',
  leaving_home: 'leaving_home_setting',
  pause: 'pause_setting',
  manual: 'manual_mode_fast',
  holiday: 'holiday_setting',
  holiday_sat: 'at_home_setting',
};

// The modes users can choose (scene action, widget buttons, features).
const SETTABLE_MODES = ['at_home', 'leaving_home', 'pause', 'manual', 'holiday'];
// Every mode the API reports.
const KNOWN_MODES = [...SETTABLE_MODES, 'holiday_sat', 'hot'];

// The suffix of `last_click_time` per mode (observed with the Ally app).
const LAST_CLICK_SUFFIX = { at_home: '010000', leaving_home: '000101' };

const SETPOINT_RANGE = { min: 5, max: 35, step: 0.5 };
// ext_measured_rs / sensor_avg_temp when no external temperature is given.
const NO_EXTERNAL = { hundredths: -8000, tenths: -800 };

/**
 * @description A finite number, or null.
 * @param {unknown} value - A raw API value (number or string).
 * @returns {number|null} The number.
 */
function toNumber(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * @description A boolean from a raw API value (true, "true", 1…), or null.
 * @param {unknown} value - The value.
 * @returns {boolean|null} The boolean.
 */
function toBool(value) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === 0) return value === 1;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (['true', '1', 'on', 'yes'].includes(text)) return true;
    if (['false', '0', 'off', 'no'].includes(text)) return false;
  }
  return null;
}

const round = (value, decimals) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};
const scaled = (value, divisor, decimals = 1) => {
  const number = toNumber(value);
  return number === null ? null : round(number / divisor, decimals);
};

/**
 * @description A fault code that says something is wrong, or null for "no
 * fault" (0, "0", "", false, "none", "normal", an empty list).
 * @param {unknown} value - The `fault` or `sw_error_code` value.
 * @returns {string|null} The code as text.
 */
function faultCode(value) {
  if (value === null || value === undefined || value === false) return null;
  if (Array.isArray(value)) return value.length ? value.join(',') : null;
  const text = String(value).trim();
  if (['', '0', 'false', 'none', 'normal', 'ok', 'no_fault'].includes(text.toLowerCase())) {
    return null;
  }
  return text.slice(0, 100);
}

/**
 * @description Whether a device type is infrastructure (gateway, boiler
 * relay, controller, repeater): published only when it reports something.
 * @param {string} model - The device type.
 * @returns {boolean} Infrastructure.
 */
function isInfrastructure(model) {
  const text = String(model ?? '')
    .toLowerCase()
    .replace(/™|\(tm\)/g, ' ');
  return /gateway|boiler relay|controller|repeater/.test(text);
}

/**
 * @description The best-effort model of a raw API device.
 * @param {object} raw - `{ id, name, online, device_type | model, status }`.
 * @returns {object} The model.
 * @example
 * parseDevice({ id: 'bf1', name: 'Salon', online: true, status: [{ code: 'temp_current', value: 205 }] });
 */
function parseDevice(raw) {
  const status = new Map();
  for (const entry of Array.isArray(raw?.status) ? raw.status : []) {
    if (entry && typeof entry.code === 'string') status.set(entry.code, entry.value);
  }
  const has = (code) => status.has(code) && status.get(code) !== null;

  const setpoints = {};
  for (const code of SETPOINT_CODES) {
    const value = scaled(status.get(code), 10);
    if (value !== null) setpoints[code] = value;
  }

  let temperature = scaled(status.get('temp_current'), 10);
  if (temperature === null) temperature = scaled(status.get('local_temperature'), 100, 2);

  const floorSensor = toBool(status.get('floor_sensor')) === true;
  const external = toNumber(status.get('ext_measured_rs'));

  let heating = null;
  const demand = toNumber(status.get('pi_heating_demand'));
  if (has('output_status')) heating = String(status.get('output_status')) === 'active';
  else if (demand !== null) heating = demand > 0;

  const battery = toNumber(status.get('battery_percentage'));
  const humidity = scaled(status.get('humidity_value'), 10);
  const modeValue = has('mode') ? String(status.get('mode')) : null;

  return {
    id: String(raw.id),
    name: String(raw.name ?? '').trim(),
    model: String(raw.device_type ?? raw.model ?? '').trim(),
    online: toBool(raw.online) === true,
    updateTime: toNumber(raw.update_time),
    codes: [...status.keys()],
    setpoints,
    mode: modeValue,
    temperature,
    floorTemperature: floorSensor ? scaled(status.get('MeasuredValue'), 10) : null,
    humidity: humidity === null ? null : Math.min(100, Math.max(0, humidity)),
    battery: battery === null ? null : Math.min(100, Math.max(0, Math.round(battery))),
    windowOpen: has('window_state') ? String(status.get('window_state')) === 'open' : null,
    valveOpening: demand === null ? null : Math.min(100, Math.max(0, Math.round(demand))),
    heating,
    childLock: has('child_lock') ? toBool(status.get('child_lock')) : null,
    fault: faultCode(status.get('fault')),
    errorCode: faultCode(status.get('sw_error_code')),
    lowerTemp: scaled(status.get('lower_temp'), 10),
    upperTemp: scaled(status.get('upper_temp'), 10),
    radiatorCovered: has('radiator_covered') ? toBool(status.get('radiator_covered')) : null,
    externalTemperature:
      external === null || external <= NO_EXTERNAL.hundredths ? null : round(external / 100, 2),
    acceptsExternal: has('ext_measured_rs'),
    infrastructure: isInfrastructure(raw.device_type ?? raw.model),
  };
}

/**
 * @description Whether the device has the per-mode setpoints (Ally radiator
 * thermostats, Icon2), as opposed to the single `temp_set`.
 * @param {object} model - A parsed device.
 * @returns {boolean} Schedule-capable.
 */
function hasModeSetpoints(model) {
  return MODE_SETPOINT_CODES.every((code) => code in model.setpoints);
}

/**
 * @description The setpoint code the device heats to now (or in a mode).
 * @param {object} model - A parsed device.
 * @param {string} [mode] - A mode (default: its current one).
 * @returns {string|null} The code, null without setpoint.
 */
function setpointCode(model, mode = model.mode) {
  const codes = Object.keys(model.setpoints);
  if (codes.length === 0) return null;
  if ('temp_set' in model.setpoints && !hasModeSetpoints(model)) return 'temp_set';
  const code = MODE_TO_SETPOINT_CODE[mode];
  if (code && code in model.setpoints) return code;
  if ('temp_set' in model.setpoints) return 'temp_set';
  if ('manual_mode_fast' in model.setpoints) return 'manual_mode_fast';
  return codes[0];
}

/**
 * @description The temperature the device heats to now.
 * @param {object} model - A parsed device.
 * @returns {number|null} °C.
 */
function targetTemperature(model) {
  const code = setpointCode(model);
  return code === null ? null : model.setpoints[code];
}

/**
 * @description A setpoint as the API takes it: whole tenths, rounded to the
 * nearest 0.5 °C, between 5 and 35 °C.
 * @param {number} celsius - The temperature.
 * @returns {number} Tenths of a degree.
 * @throws {RangeError} Outside 5-35 °C.
 */
function encodeSetpoint(celsius) {
  const value = Number(celsius);
  if (!Number.isFinite(value)) throw new RangeError('The temperature is not a number');
  const half = Math.round(value * 2) / 2;
  if (half < SETPOINT_RANGE.min || half > SETPOINT_RANGE.max) {
    throw new RangeError(
      `The temperature must be between ${SETPOINT_RANGE.min} and ${SETPOINT_RANGE.max} °C`,
    );
  }
  return Math.round(half * 10);
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * @description The commands of a mode change.
 * @param {string} mode - The mode.
 * @param {Date} date - Now (local time of the container, TZ of Gladys).
 * @returns {Array<{code: string, value: string}>} The commands.
 */
function modeCommands(mode, date) {
  const commands = [{ code: 'mode', value: mode }];
  if (LAST_CLICK_SUFFIX[mode]) {
    const stamp =
      `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
      `${pad(date.getHours())}${pad(date.getMinutes())}`;
    commands.push({ code: 'last_click_time', value: `${stamp}${LAST_CLICK_SUFFIX[mode]}` });
  }
  return commands;
}

/**
 * @description The commands that give a radiator thermostat the temperature
 * of an external sensor ("radiator covered" mode), or take it back.
 * @param {number|null} celsius - The temperature, null to stop.
 * @returns {Array<{code: string, value: number|boolean}>} The commands.
 */
function externalTemperatureCommands(celsius) {
  if (celsius === null) {
    return [
      { code: 'radiator_covered', value: false },
      { code: 'ext_measured_rs', value: NO_EXTERNAL.hundredths },
      { code: 'sensor_avg_temp', value: NO_EXTERNAL.tenths },
    ];
  }
  return [
    { code: 'radiator_covered', value: true },
    { code: 'ext_measured_rs', value: Math.round(celsius * 100) },
    { code: 'sensor_avg_temp', value: Math.round(celsius * 10) },
  ];
}

/**
 * @description A raw device with its `status` list replaced (the answer of
 * `GET /ally/devices/{id}/status` carries the status only).
 * @param {object} raw - The cached raw device.
 * @param {Array} status - The fresh status list.
 * @returns {object} The merged raw device.
 */
function withStatus(raw, status) {
  return { ...raw, status: Array.isArray(status) ? status.map((entry) => ({ ...entry })) : [] };
}

export {
  SETPOINT_CODES,
  MODE_SETPOINT_CODES,
  MODE_TO_SETPOINT_CODE,
  SETTABLE_MODES,
  KNOWN_MODES,
  LAST_CLICK_SUFFIX,
  SETPOINT_RANGE,
  NO_EXTERNAL,
  toNumber,
  toBool,
  faultCode,
  isInfrastructure,
  parseDevice,
  hasModeSetpoints,
  setpointCode,
  targetTemperature,
  encodeSetpoint,
  modeCommands,
  externalTemperatureCommands,
  withStatus,
};
