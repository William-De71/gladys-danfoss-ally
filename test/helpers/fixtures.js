// -----------------------------------------------------------------------------
// Made-up Danfoss Ally answers, shaped like the official OpenAPI document
// (Danfoss Ally API 2.4.0: `{ result, t }`, devices with `id`, `name`,
// `online`, `device_type`, `update_time`, `status: [{ code, value }]`) and
// filled with the status codes observed on real devices (pydanfossally, its
// parser and its "writable properties research"). Never a real account.
// -----------------------------------------------------------------------------

import { createDanfossApi } from '../../src/danfoss-api.js';

const status = (entries) => Object.entries(entries).map(([code, value]) => ({ code, value }));

// A Danfoss Ally radiator thermostat, at home, heating.
const RADIATOR = {
  id: 'bf7d6d2c1e0a9b8f7j18s',
  name: 'Living room',
  online: true,
  sub: true,
  update_time: 1792130400,
  device_type: 'Danfoss Ally™ Radiator Thermostat',
  status: status({
    switch: true,
    mode: 'at_home',
    work_state: 'automatic',
    temp_set: 210,
    upper_temp: 350,
    temp_current: 198,
    window_state: 'close',
    lower_temp: 50,
    child_lock: false,
    battery_percentage: 76,
    fault: 0,
    SetpointChangeSource: 'schedule',
    manual_mode_fast: 200,
    window_toggle: true,
    at_home_setting: 210,
    leaving_home_setting: 170,
    pause_setting: 50,
    holiday_setting: 150,
    switch_state: true,
    mounting_mode_active: false,
    ext_measured_rs: -8000,
    radiator_covered: false,
    heat_available: true,
    load_balance_enable: false,
    pi_heating_demand: 42,
  }),
};

// A Danfoss Icon2 room thermostat with a floor sensor.
const ICON2 = {
  id: 'bfe15e0d9c8b7a6f5fffr',
  name: 'Bathroom',
  online: true,
  sub: true,
  update_time: 1792130100,
  device_type: 'Danfoss Icon2 RT',
  status: status({
    switch: true,
    mode: 'manual',
    work_state: 'manual',
    temp_set: 220,
    upper_temp: 300,
    temp_current: 214,
    lower_temp: 150,
    child_lock: true,
    battery_percentage: 12,
    fault: 0,
    MeasuredValue: 248,
    humidity_value: 562,
    manual_mode_fast: 220,
    at_home_setting: 220,
    leaving_home_setting: 180,
    pause_setting: 150,
    holiday_setting: 150,
    switch_state: true,
    floor_sensor: true,
    temp_mode: 'room',
    output_status: 'active',
  }),
};

// A Danfoss Ally room sensor.
const ROOM_SENSOR = {
  id: 'bf33c1a2b3c4d5e6f7rs1',
  name: 'Bedroom sensor',
  online: true,
  sub: true,
  update_time: 1792130000,
  device_type: 'Danfoss Ally™ Room Sensor',
  status: status({ temp_current: 191, humidity_value: 488, battery_percentage: 93 }),
};

// A first-generation Icon room thermostat: one setpoint, mode "hot".
const ICON_RT = {
  id: 'bf80b9a848085c5902tiwy',
  name: 'Icon RT 8',
  online: true,
  sub: true,
  update_time: 1605482266,
  device_type: 'Icon RT',
  status: status({ temp_set: 200, mode: 'hot' }),
};

// The gateway: nothing to show.
const GATEWAY = {
  id: 'bff29edfd82316bc2bbrlu',
  name: 'Danfoss Ally™ Gateway',
  online: true,
  sub: false,
  update_time: 1605296207,
  device_type: 'Danfoss Ally™ Gateway',
  status: [],
};

const ALL = [RADIATOR, ICON2, ROOM_SENSOR, ICON_RT, GATEWAY];

/**
 * @description A deep copy of a raw device with some status values changed.
 * @param {object} raw - The raw device.
 * @param {object} [changes] - Status codes to set.
 * @param {object} [fields] - Top-level fields to set (online…).
 * @returns {object} The copy.
 */
function variant(raw, changes = {}, fields = {}) {
  const copy = JSON.parse(JSON.stringify(raw));
  for (const [code, value] of Object.entries(changes)) {
    const entry = copy.status.find((item) => item.code === code);
    if (entry) entry.value = value;
    else copy.status.push({ code, value });
  }
  return { ...copy, ...fields };
}

/**
 * @description A fake Danfoss Ally API (no network): the devices it serves,
 * the commands it receives, an error to throw once.
 * @param {object[]} [devices] - Raw devices.
 * @returns {object} The fake API, with `calls`, `commands`, `devices`, `failNext`.
 */
function fakeApi(devices = ALL) {
  const fake = {
    devices: devices.map((device) => JSON.parse(JSON.stringify(device))),
    calls: [],
    commands: [],
    credentials: null,
    failNext: null,
    accept: true,
    statusError: null,
    setCredentials(key, secret) {
      fake.credentials = key && secret ? { key, secret } : null;
    },
    hasCredentials: () => fake.credentials !== null,
    async getDevices() {
      fake.calls.push('getDevices');
      fake.throwIfAsked();
      return { result: JSON.parse(JSON.stringify(fake.devices)), t: 1792130460 };
    },
    async getDevice(id) {
      fake.calls.push(`getDevice:${id}`);
      fake.throwIfAsked();
      const device = fake.devices.find((item) => item.id === id);
      return { result: JSON.parse(JSON.stringify(device)), t: 1792130460 };
    },
    async getDeviceStatus(id) {
      fake.calls.push(`getDeviceStatus:${id}`);
      if (fake.statusError) throw fake.statusError;
      fake.throwIfAsked();
      const device = fake.devices.find((item) => item.id === id);
      return { result: JSON.parse(JSON.stringify(device.status)), t: 1792130460 };
    },
    async sendCommands(id, commands) {
      fake.calls.push(`sendCommands:${id}`);
      fake.throwIfAsked();
      fake.commands.push({ id, commands });
      return fake.accept;
    },
    requestsLastHour: () => fake.calls.length,
    throwIfAsked() {
      if (fake.failNext) {
        const error = fake.failNext;
        fake.failNext = null;
        throw error;
      }
    },
  };
  return fake;
}

/**
 * @description A fake `fetch` answering from a list of handlers.
 * @param {Function} handler - `(url, init) => { status, body, headers? }`.
 * @returns {Function & { requests: object[] }} The fetch.
 */
function fakeFetch(handler) {
  const requests = [];
  const impl = async (url, init = {}) => {
    requests.push({ url, ...init });
    const answer = await handler(url, init, requests.length);
    const headers = new Headers(answer.headers ?? {});
    const text = answer.body === undefined ? '' : JSON.stringify(answer.body);
    return { status: answer.status ?? 200, headers, text: async () => text };
  };
  impl.requests = requests;
  return impl;
}

/**
 * @description A real API client on a fake fetch and a fake clock.
 * @param {Function} handler - The fetch handler.
 * @returns {{ api: object, fetch: Function, clock: object }} The client.
 */
function apiWithFetch(handler) {
  const clock = { now: 1_800_000_000_000, slept: [] };
  const fetchImpl = fakeFetch(handler);
  const api = createDanfossApi({
    fetchImpl,
    now: () => clock.now,
    sleep: async (ms) => {
      clock.slept.push(ms);
      clock.now += ms;
    },
  });
  return { api, fetch: fetchImpl, clock };
}

// Ids of the fake Gladys (selector "test-integration").
const fakeGladys = {
  externalIds: (type, id) => {
    const device = `ext:test-integration:${type}:${id}`;
    return { device, feature: (key) => `${device}:${key}` };
  },
};

export {
  RADIATOR,
  ICON2,
  ROOM_SENSOR,
  ICON_RT,
  GATEWAY,
  ALL,
  variant,
  fakeApi,
  fakeFetch,
  apiWithFetch,
  fakeGladys,
};
