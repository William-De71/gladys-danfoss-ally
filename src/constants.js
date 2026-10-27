// -----------------------------------------------------------------------------
// Values of the Gladys core the SDK does not export (server/utils/constants.js
// of Gladys 5.3.0). They are stored in device states and in users' scenes, and
// the core never changes the meaning of an existing value.
// -----------------------------------------------------------------------------

// What a thermostat does (thermostat/mode).
const THERMOSTAT_MODE = { OFF: 0, HEATING: 1, COOLING: 2, AUTO: 3 };

// Whether it heats right now (thermostat/operating-state).
const THERMOSTAT_OPERATING_STATE = { IDLE: 0, HEATING: 1, COOLING: 2 };

// Which temperature it aims for (thermostat/preset).
const THERMOSTAT_PRESET = { SCHEDULE: 0, FROST: 1, AWAY: 2, ECO: 3, NIGHT: 4, COMFORT: 5 };

// opening-sensor/binary: 0 is OPEN, 1 is CLOSED (not the other way round).
const OPENING_SENSOR_STATE = { OPEN: 0, CLOSE: 1 };

export { THERMOSTAT_MODE, THERMOSTAT_OPERATING_STATE, THERMOSTAT_PRESET, OPENING_SENSOR_STATE };
