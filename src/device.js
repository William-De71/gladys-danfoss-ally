// -----------------------------------------------------------------------------
// One Gladys device per Danfoss Ally device, with the features its status
// codes allow:
//
//   key                 category / type                   unit     writable
//   target_temperature  thermostat / target-temperature   celsius  yes (5-35, 0.5)
//   mode                thermostat / mode                 -        yes (off, heating, auto)
//   preset              thermostat / preset               -        yes (frost, away, comfort)
//   operating_state     thermostat / operating-state      -        no  (idle, heating)
//   temperature         temperature-sensor / decimal      celsius  no
//   floor_temperature   temperature-sensor / decimal      celsius  no
//   humidity            humidity-sensor / decimal         percent  no
//   battery             battery / integer                 percent  no
//   window              opening-sensor / binary           -        no  (0 open, 1 closed)
//   child_lock          child-lock / binary               -        yes
//
// The Danfoss mode maps onto the Gladys mode + preset pair (what the
// thermostat does / which temperature it aims for):
//
//   Danfoss        mode      preset
//   at_home        AUTO      COMFORT
//   leaving_home   AUTO      AWAY
//   holiday        AUTO      AWAY
//   holiday_sat    AUTO      COMFORT
//   pause          OFF       FROST
//   manual         HEATING   (unchanged: a manual setpoint is no preset)
//
// Written back: mode OFF -> pause, HEATING -> manual, AUTO -> at_home;
// preset FROST -> pause, AWAY -> leaving_home, COMFORT -> at_home.
//
// The feature keys, categories, types, units and bounds are forever (the
// Discovery "Update" button compares them): see test/structure.test.js.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import {
  THERMOSTAT_MODE,
  THERMOSTAT_OPERATING_STATE,
  THERMOSTAT_PRESET,
  OPENING_SENSOR_STATE,
} from './constants.js';
import { hasModeSetpoints, setpointCode, targetTemperature, SETPOINT_RANGE } from './ally.js';
import { t } from './i18n.js';

const DEVICE_TYPE = 'ally';

const MODE_OF = {
  at_home: THERMOSTAT_MODE.AUTO,
  leaving_home: THERMOSTAT_MODE.AUTO,
  holiday: THERMOSTAT_MODE.AUTO,
  holiday_sat: THERMOSTAT_MODE.AUTO,
  pause: THERMOSTAT_MODE.OFF,
  manual: THERMOSTAT_MODE.HEATING,
};
const PRESET_OF = {
  at_home: THERMOSTAT_PRESET.COMFORT,
  holiday_sat: THERMOSTAT_PRESET.COMFORT,
  leaving_home: THERMOSTAT_PRESET.AWAY,
  holiday: THERMOSTAT_PRESET.AWAY,
  pause: THERMOSTAT_PRESET.FROST,
};
// Gladys value -> Danfoss mode, for the writable features.
const MODE_TO_DANFOSS = {
  [THERMOSTAT_MODE.OFF]: 'pause',
  [THERMOSTAT_MODE.HEATING]: 'manual',
  [THERMOSTAT_MODE.AUTO]: 'at_home',
};
const PRESET_TO_DANFOSS = {
  [THERMOSTAT_PRESET.FROST]: 'pause',
  [THERMOSTAT_PRESET.AWAY]: 'leaving_home',
  [THERMOSTAT_PRESET.COMFORT]: 'at_home',
};

const writable = { read_only: false, has_feedback: true };
const readOnly = { read_only: true, has_feedback: false };

// Order = order of the features in Gladys. `present` decides from the parsed
// model; `value` gives the state (null: nothing to publish).
const FEATURES = [
  {
    key: 'target_temperature',
    category: CATEGORIES.THERMOSTAT,
    type: TYPES.THERMOSTAT.TARGET_TEMPERATURE,
    unit: UNITS.CELSIUS,
    min: SETPOINT_RANGE.min,
    max: SETPOINT_RANGE.max,
    step: SETPOINT_RANGE.step,
    ...writable,
    present: (m) => setpointCode(m) !== null,
    value: (m) => targetTemperature(m),
  },
  {
    key: 'mode',
    category: CATEGORIES.THERMOSTAT,
    type: TYPES.THERMOSTAT.MODE,
    min: THERMOSTAT_MODE.OFF,
    max: THERMOSTAT_MODE.AUTO,
    ...writable,
    supported_options: [
      { value: THERMOSTAT_MODE.OFF, label: 'Off (pause)' },
      { value: THERMOSTAT_MODE.HEATING, label: 'Heating (manual)' },
      { value: THERMOSTAT_MODE.AUTO, label: 'Auto (schedule)' },
    ],
    present: (m) => m.mode !== null && hasModeSetpoints(m),
    value: (m) => MODE_OF[m.mode] ?? null,
  },
  {
    key: 'preset',
    category: CATEGORIES.THERMOSTAT,
    type: TYPES.THERMOSTAT.PRESET,
    min: THERMOSTAT_PRESET.SCHEDULE,
    max: THERMOSTAT_PRESET.COMFORT,
    ...writable,
    supported_options: [
      { value: THERMOSTAT_PRESET.FROST, label: 'Frost protection (pause)' },
      { value: THERMOSTAT_PRESET.AWAY, label: 'Away (leaving home)' },
      { value: THERMOSTAT_PRESET.COMFORT, label: 'Comfort (at home)' },
    ],
    present: (m) => m.mode !== null && hasModeSetpoints(m),
    value: (m) => PRESET_OF[m.mode] ?? null,
  },
  {
    key: 'operating_state',
    category: CATEGORIES.THERMOSTAT,
    type: TYPES.THERMOSTAT.OPERATING_STATE,
    min: THERMOSTAT_OPERATING_STATE.IDLE,
    max: THERMOSTAT_OPERATING_STATE.COOLING,
    ...readOnly,
    present: (m) => m.heating !== null,
    value: (m) =>
      m.heating === null
        ? null
        : m.heating
          ? THERMOSTAT_OPERATING_STATE.HEATING
          : THERMOSTAT_OPERATING_STATE.IDLE,
  },
  {
    key: 'temperature',
    category: CATEGORIES.TEMPERATURE_SENSOR,
    type: TYPES.SENSOR.DECIMAL,
    unit: UNITS.CELSIUS,
    min: -20,
    max: 60,
    ...readOnly,
    present: (m) => m.temperature !== null,
    value: (m) => m.temperature,
  },
  {
    key: 'floor_temperature',
    category: CATEGORIES.TEMPERATURE_SENSOR,
    type: TYPES.SENSOR.DECIMAL,
    unit: UNITS.CELSIUS,
    min: -20,
    max: 80,
    ...readOnly,
    present: (m) => m.floorTemperature !== null,
    value: (m) => m.floorTemperature,
  },
  {
    key: 'humidity',
    category: CATEGORIES.HUMIDITY_SENSOR,
    type: TYPES.SENSOR.DECIMAL,
    unit: UNITS.PERCENT,
    min: 0,
    max: 100,
    ...readOnly,
    present: (m) => m.humidity !== null,
    value: (m) => m.humidity,
  },
  {
    key: 'battery',
    category: CATEGORIES.BATTERY,
    type: TYPES.BATTERY.INTEGER,
    unit: UNITS.PERCENT,
    min: 0,
    max: 100,
    ...readOnly,
    present: (m) => m.battery !== null,
    value: (m) => m.battery,
  },
  {
    key: 'window',
    category: CATEGORIES.OPENING_SENSOR,
    type: TYPES.SENSOR.BINARY,
    min: 0,
    max: 1,
    ...readOnly,
    present: (m) => m.windowOpen !== null,
    value: (m) =>
      m.windowOpen === null
        ? null
        : m.windowOpen
          ? OPENING_SENSOR_STATE.OPEN
          : OPENING_SENSOR_STATE.CLOSE,
  },
  {
    key: 'child_lock',
    category: CATEGORIES.CHILD_LOCK,
    type: TYPES.CHILD_LOCK.BINARY,
    min: 0,
    max: 1,
    ...writable,
    present: (m) => m.childLock !== null,
    value: (m) => (m.childLock === null ? null : m.childLock ? 1 : 0),
  },
];
const FEATURE_KEYS = FEATURES.map((feature) => feature.key);

/**
 * @description The ids of a Danfoss device. The Danfoss id is alphanumeric;
 * it is URI-encoded anyway so a colon could never cut a feature id.
 * @param {object} gladys - The Gladys client (externalIds).
 * @param {string} id - The Danfoss device id.
 * @returns {{ device: string, feature: Function }} The ids.
 */
function idsOf(gladys, id) {
  return gladys.externalIds(DEVICE_TYPE, encodeURIComponent(id));
}

/**
 * @description The features a device has.
 * @param {object} model - A parsed device.
 * @returns {object[]} The feature specs.
 */
function featuresOf(model) {
  return FEATURES.filter((feature) => feature.present(model));
}

/**
 * @description The name of a device: its Danfoss name (the room, most of the
 * time), else its type and the end of its id.
 * @param {object} model - A parsed device.
 * @returns {string} The name.
 */
function deviceName(model) {
  return model.name || `${model.model || 'Danfoss Ally'} ${model.id.slice(-4)}`;
}

/**
 * @description The Discovery payload of a device.
 * @param {object} gladys - The Gladys client.
 * @param {object} model - A parsed device.
 * @param {string} language - Language of the feature names.
 * @returns {object} The device.
 */
function buildDevice(gladys, model, language = 'en') {
  const ids = idsOf(gladys, model.id);
  const name = deviceName(model);
  return {
    name,
    external_id: ids.device,
    model: model.model || undefined,
    should_poll: false,
    params: [{ name: 'DANFOSS_MODEL', value: model.model || 'unknown' }],
    features: featuresOf(model).map((feature) => {
      // eslint-disable-next-line no-unused-vars
      const { key, present, value, ...fields } = feature;
      return {
        ...fields,
        name: t(`feature_${key}`, language),
        external_id: ids.feature(key),
      };
    }),
  };
}

/**
 * @description Whether a device is offered in Discovery: anything with at
 * least one feature (a gateway or a boiler relay usually has none).
 * @param {object} model - A parsed device.
 * @returns {boolean} Publishable.
 */
function isPublishable(model) {
  return featuresOf(model).length > 0;
}

/**
 * @description The states of a device.
 * @param {object} gladys - The Gladys client.
 * @param {object} model - A parsed device.
 * @returns {Array<{device_feature_external_id: string, state: number}>} The states.
 */
function buildStates(gladys, model) {
  const ids = idsOf(gladys, model.id);
  return featuresOf(model).flatMap((feature) => {
    const state = feature.value(model);
    return state === null || state === undefined
      ? []
      : [{ device_feature_external_id: ids.feature(feature.key), state }];
  });
}

/**
 * @description What Discovery would compare: a change republishes the list.
 * @param {object} gladys - The Gladys client.
 * @param {object[]} models - Parsed devices.
 * @param {string} language - Language of the feature names.
 * @returns {string} A signature.
 */
function discoverySignature(gladys, models, language) {
  return JSON.stringify(
    models.map((model) => {
      const device = buildDevice(gladys, model, language);
      return [device.external_id, device.name, device.features.map((f) => f.name)];
    }),
  );
}

export {
  DEVICE_TYPE,
  FEATURES,
  FEATURE_KEYS,
  MODE_OF,
  PRESET_OF,
  MODE_TO_DANFOSS,
  PRESET_TO_DANFOSS,
  idsOf,
  featuresOf,
  deviceName,
  buildDevice,
  isPublishable,
  buildStates,
  discoverySignature,
};
