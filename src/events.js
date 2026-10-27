// -----------------------------------------------------------------------------
// Scene triggers and scene actions.
//
// Triggers fire on a TRANSITION between two readings of a device, never on a
// snapshot: the first reading of a device only sets its baseline. The last
// values are kept in /data across restarts (state.js), so a window opened
// while the integration restarted still fires once, and nothing fires twice.
// A mode change the integration itself asked for (a feature, a scene action,
// a widget button) never fires `mode_changed`: a scene bound to it would loop.
// -----------------------------------------------------------------------------

const TRIGGERS = {
  WINDOW_OPENED: 'window_opened',
  WINDOW_CLOSED: 'window_closed',
  BATTERY_LOW: 'battery_low',
  DEVICE_OFFLINE: 'device_offline',
  DEVICE_ONLINE: 'device_online',
  FAULT_REPORTED: 'fault_reported',
  MODE_CHANGED: 'mode_changed',
};

const SCENE_ACTIONS = {
  SET_MODE: 'set_mode',
  SET_MODE_TEMPERATURE: 'set_mode_temperature',
  SET_EXTERNAL_TEMPERATURE: 'set_external_temperature',
  REFRESH: 'refresh',
};

// The battery is "low" again only once it went this many points above the
// threshold (a level hovering around it fires once).
const BATTERY_HYSTERESIS = 5;
// A radiator thermostat takes an external temperature at most this often.
const EXTERNAL_MIN_INTERVAL_MS = 5 * 60 * 1000;
// Values of the external temperature field that stop the external sensor.
const EXTERNAL_CLEAR_WORDS = ['', 'off', 'none', 'clear', 'stop', 'aus', 'arrêt', 'arret', 'no'];

/**
 * @description The fault of a device as one comparable text.
 * @param {object} model - A parsed device.
 * @returns {string|null} "fault 4 / error 12", or null.
 */
function faultKey(model) {
  const parts = [];
  if (model.fault) parts.push(`fault ${model.fault}`);
  if (model.errorCode) parts.push(`error ${model.errorCode}`);
  return parts.length ? parts.join(' / ') : null;
}

/**
 * @description What is remembered of a device between two readings.
 * @param {object} model - A parsed device.
 * @param {object|null} previous - The previous snapshot.
 * @param {number} threshold - The battery threshold (%).
 * @returns {object} The snapshot.
 */
function snapshotOf(model, previous, threshold) {
  let batteryLow = previous?.batteryLow ?? false;
  if (model.battery !== null) {
    batteryLow = batteryLow
      ? model.battery < threshold + BATTERY_HYSTERESIS
      : model.battery < threshold;
  }
  return {
    online: model.online,
    window: model.windowOpen,
    mode: model.mode,
    fault: faultKey(model),
    batteryLow,
  };
}

/**
 * @description The scene events of a new reading of a device.
 * @param {object|null} previous - The snapshot of the previous reading (null:
 *   first reading, nothing fires).
 * @param {object} model - The parsed device.
 * @param {object} context - Context.
 * @param {string} context.device - The Gladys external id of the device.
 * @param {string} context.name - The device name.
 * @param {number} context.threshold - The battery threshold (%).
 * @param {number|null} context.target - Its target temperature (°C).
 * @param {Function} context.isExpectedMode - `(mode) => boolean`: the
 *   integration asked for this mode.
 * @returns {{ events: Array<{key: string, data: object}>, snapshot: object }} The events.
 */
function detectEvents(previous, model, context) {
  const snapshot = snapshotOf(model, previous, context.threshold);
  const events = [];
  if (!previous) return { events, snapshot };
  const base = { device: context.device, device_name: context.name };

  if (previous.window !== null && snapshot.window !== null && previous.window !== snapshot.window) {
    events.push({
      key: snapshot.window ? TRIGGERS.WINDOW_OPENED : TRIGGERS.WINDOW_CLOSED,
      data: { ...base, temperature: model.temperature },
    });
  }
  if (snapshot.batteryLow && !previous.batteryLow && model.battery !== null) {
    events.push({
      key: TRIGGERS.BATTERY_LOW,
      data: { ...base, battery: model.battery, threshold: context.threshold },
    });
  }
  if (previous.online !== snapshot.online) {
    events.push({
      key: snapshot.online ? TRIGGERS.DEVICE_ONLINE : TRIGGERS.DEVICE_OFFLINE,
      data: { ...base, model: model.model || null },
    });
  }
  if (snapshot.fault && snapshot.fault !== previous.fault) {
    events.push({
      key: TRIGGERS.FAULT_REPORTED,
      data: { ...base, fault: model.fault, error_code: model.errorCode, summary: snapshot.fault },
    });
  }
  if (
    previous.mode !== null &&
    snapshot.mode !== null &&
    previous.mode !== snapshot.mode &&
    !context.isExpectedMode(snapshot.mode)
  ) {
    events.push({
      key: TRIGGERS.MODE_CHANGED,
      data: {
        ...base,
        mode: snapshot.mode,
        previous_mode: previous.mode,
        target_temperature: context.target,
      },
    });
  }
  return { events, snapshot };
}

/**
 * @description Read the external temperature field of the scene action: a
 * number ("21.5", "21,5", a scene variable), or a word that stops the
 * external sensor.
 * @param {unknown} raw - The resolved field value.
 * @returns {number|null} °C rounded to 0.1, null to stop.
 * @throws {RangeError} Not a temperature.
 */
function parseExternalTemperature(raw) {
  const text = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (EXTERNAL_CLEAR_WORDS.includes(text)) return null;
  const value = Number(text.replace(',', '.').replace(/\s*°?\s*c$/, ''));
  if (!Number.isFinite(value)) {
    throw new RangeError(`"${String(raw).slice(0, 40)}" is not a temperature`);
  }
  if (value < -10 || value > 50) {
    throw new RangeError('The external temperature must be between -10 and 50 °C');
  }
  return Math.round(value * 10) / 10;
}

export {
  TRIGGERS,
  SCENE_ACTIONS,
  BATTERY_HYSTERESIS,
  EXTERNAL_MIN_INTERVAL_MS,
  EXTERNAL_CLEAR_WORDS,
  faultKey,
  snapshotOf,
  detectEvents,
  parseExternalTemperature,
};
