// -----------------------------------------------------------------------------
// The Danfoss Ally integration: every handler, registered on a Gladys client.
//
//   - one request, `GET /ally/devices`, reads the whole home at the chosen
//     interval (1, 2, 5 or 10 minutes) on the integration's own clock: the
//     devices are never polled by Gladys (`should_poll: false`);
//   - one Gladys device per Danfoss device that reports something (device.js),
//     only the changed states are published (publishChangedStates, with a
//     30-minute heartbeat);
//   - a command (setpoint, mode, preset, child lock, scene action, widget
//     button) is followed by quick readings of that device only, for 5
//     minutes, until the cloud confirms it; meanwhile the commanded values
//     are kept, so the dashboard does not jump back to the old value the
//     cloud still returns for a few minutes;
//   - scene triggers on transitions (events.js), scene actions, two widgets
//     (widgets.js), one configuration button ("Test the connection").
//
// Transport: cloud (Danfoss Ally API). index.js only creates the SDK client;
// the tests drive this module with the fake Gladys of the SDK and a fake API.
// -----------------------------------------------------------------------------

import { logger as sdkLogger } from '@gladysassistant/integration-sdk';
import {
  normalizeConfig,
  readLanguage,
  guessLanguage,
  resolveTimezone,
  INTERNAL_KEYS,
  AUTO_LANGUAGE,
} from './config.js';
import {
  parseDevice,
  setpointCode,
  targetTemperature,
  hasModeSetpoints,
  encodeSetpoint,
  modeCommands,
  externalTemperatureCommands,
  withStatus,
  MODE_TO_SETPOINT_CODE,
  SETTABLE_MODES,
} from './ally.js';
import { createDanfossApi, CredentialsError, RateLimitError, ApiError } from './danfoss-api.js';
import {
  buildDevice,
  buildStates,
  isPublishable,
  featuresOf,
  idsOf,
  deviceName,
  discoverySignature,
  MODE_TO_DANFOSS,
  PRESET_TO_DANFOSS,
} from './device.js';
import {
  TRIGGERS,
  SCENE_ACTIONS,
  EXTERNAL_MIN_INTERVAL_MS,
  detectEvents,
  parseExternalTemperature,
} from './events.js';
import {
  WIDGETS,
  WIDGET_ACTIONS,
  MAX_ITEMS,
  buildRoomsWidget,
  buildStatusWidget,
  modeLabel,
} from './widgets.js';
import { createState, DEFAULT_PATH } from './state.js';
import { t, all, isLanguage } from './i18n.js';

const ACTIONS = { TEST: 'test_connection' };
// The clock: the due readings are checked this often.
const TICK_MS = 10 * 1000;
// After a command, the device alone is read again at these delays (5 min).
const HOT_REFRESH_DELAYS_MS = [20, 60, 120, 180, 300].map((s) => s * 1000);
// The commanded values are kept over the cloud answers this long.
const PENDING_MS = 5 * 60 * 1000;
// A mode the integration asked for never fires `mode_changed` within this
// delay.
const EXPECTED_MODE_MS = 10 * 60 * 1000;
// A refresh button or action reads again only past this delay.
const MIN_MANUAL_GAP_MS = 15 * 1000;
// Refused credentials are tried again this often (the user may enable the
// Ally API on the portal without touching the configuration).
const REFUSED_RETRY_MS = 30 * 60 * 1000;
// Slow-down after a 429: the interval doubles each time, up to this.
const MAX_PAUSE_MS = 30 * 60 * 1000;
// requestWidgetRefresh: at most once every 10 s per widget.
const WIDGET_REFRESH_GAP_MS = 10 * 1000;
// publishChangedStates also re-sends an unchanged value this old.
const HEARTBEAT_MS = 30 * 60 * 1000;

/**
 * @description Register every handler of the integration on a Gladys client.
 * @param {object} gladys - A GladysIntegration (or the fake Gladys of the SDK).
 * @param {object} [options] - Options.
 * @param {object} [options.api] - A Danfoss API client (tests).
 * @param {Function} [options.now] - `() => ms` (tests).
 * @param {Function} [options.date] - `() => Date`, local time (tests).
 * @param {string|null} [options.statePath] - File of the state (null: memory).
 * @param {number} [options.tickMs] - Clock period, 0 for none (tests).
 * @param {string} [options.timezone] - IANA timezone (language guess).
 * @param {object} [options.logger] - Logger.
 * @returns {object} Handles for the tests.
 */
function createApp(
  gladys,
  {
    api = createDanfossApi(),
    now = () => Date.now(),
    date = () => new Date(),
    statePath = DEFAULT_PATH,
    tickMs = TICK_MS,
    timezone = resolveTimezone(),
    logger = sdkLogger,
  } = {},
) {
  const state = createState({ path: statePath, logger });
  let config = normalizeConfig({});
  let language = null;
  // id -> { raw, model }
  let devices = new Map();
  let lastDiscovery = null;
  let connection = 'unknown';
  let connectionDetail = null;
  let lastSuccessAt = 0;
  let lastAttemptAt = 0;
  let nextPollAt = 0;
  let pausedUntil = 0;
  let backoff = 0;
  let lastStatus = null;
  let polling = null;
  let timer = null;
  let running = Promise.resolve();
  // id -> { due: number[] } — quick readings after a command.
  const hot = new Map();
  // id -> { codes: { code: value }, until } — commanded values.
  const pending = new Map();
  // id -> { mode, until } — a mode the integration asked for.
  const expectedModes = new Map();
  // ids whose /status answers 500: read with /devices/{id}.
  const statusUnsupported = new Set();
  const widgetRefreshedAt = new Map();

  const textLanguage = () =>
    config.language !== AUTO_LANGUAGE ? config.language : (language ?? guessLanguage(timezone));
  const intervalMs = () => config.refreshMinutes * 60 * 1000;
  const models = () => [...devices.values()].map((entry) => entry.model);
  const publishable = () => models().filter(isPublishable);
  const createdIds = () => new Set((gladys.devices ?? []).map((device) => device.external_id));
  const externalIdOf = (id) => idsOf(gladys, id).device;
  const byExternalId = (externalId) =>
    models().find((model) => externalIdOf(model.id) === externalId) ?? null;

  // --- Publishing ---------------------------------------------------------------

  /** @description Offer every device that reports something on the Discovery screen. */
  async function publishDiscovery({ force = false } = {}) {
    if (!gladys.connected) return;
    const list = publishable();
    const signature = discoverySignature(gladys, list, textLanguage());
    if (!force && signature === lastDiscovery) return;
    try {
      await gladys.publishDiscoveredDevices(
        list.map((model) => buildDevice(gladys, model, textLanguage())),
      );
      lastDiscovery = signature;
    } catch (err) {
      logger.error('Unable to publish the discovered devices', err);
    }
  }

  /**
   * @description Publish the changed states of the devices the user created.
   * @param {object[]} list - Parsed devices.
   */
  async function publishStates(list) {
    if (!gladys.connected) return;
    const created = createdIds();
    const states = list
      .filter((model) => created.has(externalIdOf(model.id)))
      .flatMap((model) => buildStates(gladys, model));
    if (states.length === 0) return;
    try {
      await gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
    } catch (err) {
      logger.error('Unable to publish the states', err);
    }
  }

  /** @description Ask Gladys to fetch the widgets again (10 s apart at least). */
  function refreshWidgets() {
    if (!gladys.connected) return;
    Object.values(WIDGETS).forEach((key) => {
      const last = widgetRefreshedAt.get(key) ?? -Infinity;
      if (now() - last < WIDGET_REFRESH_GAP_MS) return;
      widgetRefreshedAt.set(key, now());
      try {
        gladys.requestWidgetRefresh(key);
      } catch (err) {
        logger.warn(`Unable to refresh the widget ${key}: ${err.message}`);
      }
    });
  }

  /** @description Show the state of the connection in the Configuration screen. */
  async function reportStatus() {
    let connected = true;
    let message;
    const list = publishable();
    if (connection === 'unconfigured') {
      connected = false;
      message = all('statusUnconfigured');
    } else if (connection === 'refused') {
      connected = false;
      message = all('statusRefused', { reason: connectionDetail ?? 'API_KEY_INVALID' });
    } else if (connection === 'rate_limited') {
      message = all('statusRateLimited', {
        n: Math.max(1, Math.ceil((pausedUntil - now()) / 60000)),
      });
    } else if (connection === 'error') {
      connected = false;
      message = all('statusError', { error: connectionDetail ?? 'network' });
    } else if (connection === 'ok' && devices.size === 0) {
      message = all('statusNoDevice');
    } else if (connection === 'ok') {
      message = all('statusOk', {
        count: list.length,
        online: list.filter((model) => model.online).length,
        minutes: config.refreshMinutes,
      });
    } else {
      return;
    }
    const signature = JSON.stringify([connected, message]);
    if (!gladys.connected || signature === lastStatus) return;
    lastStatus = signature;
    try {
      await gladys.setConnectionStatus(connected, message);
    } catch (err) {
      lastStatus = null;
      logger.error('Unable to report the status', err);
    }
  }

  /**
   * @description Fire a scene event; a refusal is logged, never thrown.
   * @param {string} key - The trigger.
   * @param {object} data - Its data.
   */
  async function fire(key, data) {
    try {
      await gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Readings -----------------------------------------------------------------

  /**
   * @description The raw device with the commanded values still waiting for
   * the cloud: a value the cloud confirmed (or a late one) is dropped.
   * @param {object} raw - The raw device from the API.
   * @returns {object} The raw device to parse.
   */
  function applyPending(raw) {
    const entry = pending.get(String(raw.id));
    if (!entry) return raw;
    if (now() >= entry.until) {
      pending.delete(String(raw.id));
      return raw;
    }
    const status = Array.isArray(raw.status) ? raw.status.map((item) => ({ ...item })) : [];
    for (const [code, expected] of Object.entries(entry.codes)) {
      const found = status.find((item) => item.code === code);
      if (found && String(found.value) === String(expected)) {
        delete entry.codes[code];
      } else if (found) {
        found.value = expected;
      } else {
        status.push({ code, value: expected });
      }
    }
    if (Object.keys(entry.codes).length === 0) pending.delete(String(raw.id));
    return { ...raw, status };
  }

  /**
   * @description Take new raw devices in: parse, detect the scene events,
   * remember the snapshot.
   * @param {object[]} list - Raw devices.
   * @param {object} [options] - Options.
   * @param {boolean} [options.complete] - The full list (devices absent are gone).
   * @returns {Promise<object[]>} The parsed devices.
   */
  async function ingest(list, { complete = false } = {}) {
    const parsed = [];
    const events = [];
    const created = createdIds();
    const next = complete ? new Map() : new Map(devices);
    for (const raw of list) {
      if (!raw || raw.id === undefined || raw.id === null) continue;
      const id = String(raw.id);
      const model = parseDevice(applyPending(raw));
      next.set(id, { raw, model });
      parsed.push(model);
      const expected = expectedModes.get(id);
      if (expected && now() >= expected.until) expectedModes.delete(id);
      const result = detectEvents(state.snapshot(id), model, {
        device: externalIdOf(id),
        name: deviceName(model),
        threshold: config.batteryThreshold,
        target: targetTemperature(model),
        isExpectedMode: (mode) => expectedModes.get(id)?.mode === mode,
      });
      state.setSnapshot(id, result.snapshot);
      if (created.has(externalIdOf(id))) events.push(...result.events);
    }
    devices = next;
    if (complete) state.keep([...devices.keys()]);
    state.save();
    for (const event of events) await fire(event.key, event.data);
    return parsed;
  }

  /**
   * @description Read every device (one request).
   * @param {string} reason - timer, manual, scan, connected, config.
   * @returns {Promise<boolean>} The reading worked.
   */
  function poll(reason = 'timer') {
    if (polling) return polling;
    polling = (async () => {
      lastAttemptAt = now();
      nextPollAt = now() + intervalMs();
      if (!api.hasCredentials()) {
        connection = 'unconfigured';
        await reportStatus();
        refreshWidgets();
        return false;
      }
      try {
        const answer = await api.getDevices();
        const list = Array.isArray(answer?.result) ? answer.result : [];
        connection = 'ok';
        connectionDetail = null;
        backoff = 0;
        pausedUntil = 0;
        lastSuccessAt = now();
        const parsed = await ingest(list, { complete: true });
        logger.debug?.(`Read ${parsed.length} device(s) (${reason})`);
        await publishDiscovery();
        await publishStates(parsed);
        return true;
      } catch (err) {
        handleError(err);
        return false;
      } finally {
        await reportStatus();
        refreshWidgets();
      }
    })().finally(() => {
      polling = null;
    });
    return polling;
  }

  /**
   * @description Record an API failure: refused credentials, slow-down or
   * unreachable API.
   * @param {Error} err - The error.
   */
  function handleError(err) {
    if (err instanceof CredentialsError) {
      connection = err.reason === 'MISSING' ? 'unconfigured' : 'refused';
      connectionDetail = err.reason;
      pausedUntil = now() + REFUSED_RETRY_MS;
      nextPollAt = pausedUntil;
      logger.warn(`Danfoss refused the credentials (${err.reason})`);
    } else if (err instanceof RateLimitError) {
      backoff += 1;
      const pause = Math.min(MAX_PAUSE_MS, Math.max(err.retryAfterMs, intervalMs() * 2 ** backoff));
      connection = 'rate_limited';
      pausedUntil = now() + pause;
      nextPollAt = pausedUntil;
      logger.warn(`Danfoss limits the requests: next reading in ${Math.round(pause / 60000)} min`);
    } else {
      connection = 'error';
      connectionDetail = err instanceof ApiError ? `HTTP ${err.status}` : err.message?.slice(0, 80);
      logger.warn(`Danfoss Ally reading failed: ${err.message}`);
    }
  }

  /**
   * @description Read one device again (after a command): its status, or the
   * whole device when its model answers 500 on /status.
   * @param {string} id - The Danfoss id.
   */
  async function readDevice(id) {
    const cached = devices.get(id);
    if (!cached) return;
    let raw;
    try {
      if (!statusUnsupported.has(id)) {
        try {
          const answer = await api.getDeviceStatus(id);
          raw = withStatus(cached.raw, answer?.result);
        } catch (err) {
          if (!(err instanceof ApiError && err.status >= 500)) throw err;
          statusUnsupported.add(id);
        }
      }
      if (!raw) {
        const answer = await api.getDevice(id);
        if (!answer?.result) return;
        raw = answer.result;
      }
    } catch (err) {
      logger.warn(`Quick reading of a device failed: ${err.message}`);
      if (err instanceof RateLimitError) hot.delete(id);
      return;
    }
    const [model] = await ingest([raw]);
    await publishStates([model]);
    if (!pending.has(id)) hot.delete(id);
    refreshWidgets();
  }

  /** @description The clock: the due full reading, then the due quick readings. */
  async function tick() {
    if (!gladys.connected) return;
    if (now() >= nextPollAt && now() >= pausedUntil) await poll('timer');
    for (const [id, entry] of [...hot.entries()]) {
      if (entry.due.length === 0) {
        hot.delete(id);
        continue;
      }
      if (now() < entry.due[0]) continue;
      entry.due.shift();
      await readDevice(id);
    }
  }

  // --- Commands -----------------------------------------------------------------

  /**
   * @description Send commands to a device, keep the commanded values, and
   * plan the quick readings.
   * @param {object} model - The parsed device.
   * @param {Array<{code: string, value: unknown}>} commands - The commands.
   * @returns {Promise<object>} The device with the commanded values.
   */
  async function command(model, commands) {
    if (!api.hasCredentials()) throw new Error('Danfoss Ally is not configured');
    const accepted = await api.sendCommands(model.id, commands);
    if (!accepted) throw new Error('Danfoss Ally refused the command');
    const codes = { ...(pending.get(model.id)?.codes ?? {}) };
    for (const { code, value } of commands) {
      if (code === 'last_click_time' || code === 'sensor_avg_temp') continue;
      codes[code] = value;
      if (code === 'mode') {
        expectedModes.set(model.id, { mode: value, until: now() + EXPECTED_MODE_MS });
      }
    }
    pending.set(model.id, { codes, until: now() + PENDING_MS });
    hot.set(model.id, { due: HOT_REFRESH_DELAYS_MS.map((delay) => now() + delay) });
    const cached = devices.get(model.id);
    const [updated] = await ingest([cached?.raw ?? { id: model.id, status: [] }]);
    await publishStates([updated]);
    refreshWidgets();
    return updated;
  }

  /**
   * @description Switch a device to a Danfoss mode.
   * @param {object} model - The parsed device.
   * @param {string} mode - The mode.
   * @returns {Promise<object>} The device.
   */
  function setMode(model, mode) {
    if (!SETTABLE_MODES.includes(mode)) throw new Error(`Unknown mode ${mode}`);
    if (!hasModeSetpoints(model)) {
      throw new Error(`${deviceName(model)} does not take the Danfoss modes`);
    }
    return command(model, modeCommands(mode, date()));
  }

  /**
   * @description Switch every thermostat that takes the modes.
   * @param {string} mode - The mode.
   * @returns {Promise<{count: number, failed: number}>} The outcome.
   */
  async function setModeAll(mode) {
    let count = 0;
    let failed = 0;
    for (const model of models().filter(hasModeSetpoints)) {
      if (!model.online) {
        failed += 1;
        continue;
      }
      try {
        await setMode(model, mode);
        count += 1;
      } catch (err) {
        failed += 1;
        logger.warn(`Mode ${mode} refused for a device: ${err.message}`);
      }
    }
    return { count, failed };
  }

  /**
   * @description Write a setpoint.
   * @param {object} model - The parsed device.
   * @param {number} celsius - The temperature.
   * @param {string} [mode] - The mode whose setpoint to write (default: the current one).
   * @returns {Promise<number>} The temperature written (rounded to 0.5 °C).
   */
  async function setSetpoint(model, celsius, mode) {
    const code = mode ? MODE_TO_SETPOINT_CODE[mode] : setpointCode(model);
    if (!code || !(code in model.setpoints)) {
      throw new Error(
        mode
          ? `${deviceName(model)} has no ${mode} setpoint`
          : `${deviceName(model)} has no setpoint`,
      );
    }
    const tenths = encodeSetpoint(celsius);
    const celsiusWritten = tenths / 10;
    if (model.lowerTemp !== null && celsiusWritten < model.lowerTemp) {
      throw new RangeError(`The lowest setpoint of ${deviceName(model)} is ${model.lowerTemp} °C`);
    }
    if (model.upperTemp !== null && celsiusWritten > model.upperTemp) {
      throw new RangeError(`The highest setpoint of ${deviceName(model)} is ${model.upperTemp} °C`);
    }
    await command(model, [{ code, value: tenths }]);
    return celsiusWritten;
  }

  /**
   * @description A device chosen in a scene action or a widget.
   * @param {string} externalId - The Gladys external id.
   * @returns {object} The parsed device.
   */
  function requireDevice(externalId) {
    const model = byExternalId(externalId);
    if (!model) throw new Error('Unknown Danfoss Ally device: read the devices again');
    return model;
  }

  gladys.onSetValue(async (device, deviceFeature, value) => {
    const model = requireDevice(device.external_id);
    const key = String(deviceFeature.external_id).slice(device.external_id.length + 1);
    switch (key) {
      case 'target_temperature':
        await setSetpoint(model, Number(value));
        return;
      case 'mode': {
        const mode = MODE_TO_DANFOSS[Number(value)];
        if (!mode) throw new Error(`Mode ${value} is not available on Danfoss Ally`);
        await setMode(model, mode);
        return;
      }
      case 'preset': {
        const mode = PRESET_TO_DANFOSS[Number(value)];
        if (!mode) throw new Error(`Preset ${value} is not available on Danfoss Ally`);
        await setMode(model, mode);
        return;
      }
      case 'child_lock':
        await command(model, [{ code: 'child_lock', value: Number(value) === 1 }]);
        return;
      default:
        throw new Error(`The feature ${key} is read-only`);
    }
  });

  // --- Scene actions ----------------------------------------------------------------

  gladys.onSceneAction(SCENE_ACTIONS.SET_MODE, async (fields = {}) => {
    const mode = String(fields.mode ?? '');
    if (!SETTABLE_MODES.includes(mode)) throw new Error(`Unknown mode ${mode}`);
    if (fields.device) {
      await setMode(requireDevice(fields.device), mode);
      return { count: 1, failed: 0 };
    }
    return setModeAll(mode);
  });

  gladys.onSceneAction(SCENE_ACTIONS.SET_MODE_TEMPERATURE, async (fields = {}) => {
    const model = requireDevice(fields.device);
    const mode = !fields.mode || fields.mode === 'current' ? null : String(fields.mode);
    if (mode && !SETTABLE_MODES.includes(mode)) throw new Error(`Unknown mode ${mode}`);
    const temperature = await setSetpoint(model, Number(fields.temperature), mode ?? undefined);
    return { temperature, mode: mode ?? model.mode ?? '' };
  });

  gladys.onSceneAction(SCENE_ACTIONS.SET_EXTERNAL_TEMPERATURE, async (fields = {}) => {
    const model = requireDevice(fields.device);
    if (!model.acceptsExternal) {
      throw new Error(
        `${deviceName(model)} takes no external temperature (Danfoss Ally radiator thermostats only)`,
      );
    }
    const temperature = parseExternalTemperature(fields.temperature);
    const elapsed = now() - state.externalSentAt(model.id);
    if (temperature !== null && elapsed < EXTERNAL_MIN_INTERVAL_MS) {
      // Not an error: a scene sending every minute keeps working, one value
      // in five minutes goes through.
      return {
        sent: false,
        temperature,
        wait_seconds: Math.ceil((EXTERNAL_MIN_INTERVAL_MS - elapsed) / 1000),
      };
    }
    await command(model, externalTemperatureCommands(temperature));
    state.setExternalSentAt(model.id, temperature === null ? 0 : now());
    state.save();
    return { sent: true, temperature: temperature ?? 0, wait_seconds: 0 };
  });

  gladys.onSceneAction(SCENE_ACTIONS.REFRESH, async () => {
    if (now() - lastAttemptAt >= MIN_MANUAL_GAP_MS || !lastSuccessAt) {
      const ok = await poll('manual');
      if (!ok) throw new Error(`Danfoss Ally reading failed (${connection})`);
    }
    const list = publishable();
    return { devices: list.length, online: list.filter((model) => model.online).length };
  });

  // --- Configuration button ----------------------------------------------------------

  gladys.onAction(ACTIONS.TEST, async () => {
    if (!api.hasCredentials()) return all('statusUnconfigured');
    const ok = await poll('manual');
    if (!ok) {
      if (connection === 'refused') {
        return all('statusRefused', { reason: connectionDetail ?? 'API_KEY_INVALID' });
      }
      if (connection === 'rate_limited') {
        return all('statusRateLimited', {
          n: Math.max(1, Math.ceil((pausedUntil - now()) / 60000)),
        });
      }
      return all('statusError', { error: connectionDetail ?? 'network' });
    }
    if (devices.size === 0) return all('statusNoDevice');
    return all((language) => {
      const list = models()
        .map((model) =>
          t(isPublishable(model) ? 'testDevice' : 'testInfrastructure', language, {
            name: deviceName(model),
            model: model.model || '?',
            state: t(model.online ? 'online' : 'offline', language),
            features: featuresOf(model).length,
          }),
        )
        .join(' · ');
      return t('testOk', language, { count: devices.size, list }).slice(0, 2000);
    });
  });

  // --- Widgets ------------------------------------------------------------------------

  /**
   * @description Remember the language of the last widget request (the
   * feature names follow it when the configuration says "automatic").
   * @param {string} lang - The language of the request.
   */
  function rememberLanguage(lang) {
    if (!isLanguage(lang) || lang === language) return;
    const before = textLanguage();
    language = lang;
    gladys
      .setConfig({ [INTERNAL_KEYS.language]: lang })
      .catch((err) => logger.warn(`Unable to store the language: ${err.message}`));
    if (textLanguage() !== before) publishDiscovery();
  }

  gladys.onWidgetGet(WIDGETS.ROOMS, async ({ settings = {}, language: lang, units } = {}) => {
    rememberLanguage(lang);
    const wanted = Array.isArray(settings.devices) ? settings.devices : [];
    let list = publishable().sort((a, b) => deviceName(a).localeCompare(deviceName(b)));
    if (wanted.length > 0) {
      list = list.filter((model) => wanted.includes(externalIdOf(model.id)));
    }
    return buildRoomsWidget({
      devices: list.slice(0, MAX_ITEMS).map((model) => ({
        model,
        name: deviceName(model),
        batteryLow: Boolean(state.snapshot(model.id)?.batteryLow),
      })),
      hidden: Math.max(0, list.length - MAX_ITEMS),
      connection,
      lastSuccessAt,
      canSetMode: models().some(hasModeSetpoints),
      language: isLanguage(lang) ? lang : textLanguage(),
      units,
      now: now(),
    });
  });

  gladys.onWidgetGet(WIDGETS.STATUS, async ({ language: lang } = {}) => {
    rememberLanguage(lang);
    const list = publishable();
    return buildStatusWidget({
      connection,
      online: list.filter((model) => model.online).length,
      total: list.length,
      requests: api.requestsLastHour(),
      lastSuccessAt,
      refreshMinutes: config.refreshMinutes,
      pausedUntil,
      language: isLanguage(lang) ? lang : textLanguage(),
      now: now(),
    });
  });

  /**
   * @description The buttons of the widgets.
   * @param {string} actionKey - The button.
   * @returns {Promise<object>} The toast.
   */
  async function widgetAction(actionKey) {
    if (actionKey === WIDGET_ACTIONS.ALL_AT_HOME || actionKey === WIDGET_ACTIONS.ALL_LEAVING_HOME) {
      const mode = actionKey === WIDGET_ACTIONS.ALL_AT_HOME ? 'at_home' : 'leaving_home';
      if (!models().some(hasModeSetpoints)) return all('toastNoThermostat');
      const { count, failed } = await setModeAll(mode);
      return all((language) =>
        t(failed ? 'toastModePartial' : 'toastModeAll', language, {
          mode: modeLabel(mode, language),
          n: count,
          failed,
        }),
      );
    }
    if (actionKey === WIDGET_ACTIONS.REFRESH) {
      if (now() - lastAttemptAt >= MIN_MANUAL_GAP_MS || !lastSuccessAt) {
        const ok = await poll('manual');
        if (!ok) {
          return all((language) =>
            t('toastFailed', language, { error: t(`connection_${connection}`, language) }),
          );
        }
      }
      return all('toastRefreshed', { n: publishable().length });
    }
    throw new Error(`Unknown button ${actionKey}`);
  }
  gladys.onWidgetAction(WIDGETS.ROOMS, widgetAction);
  gladys.onWidgetAction(WIDGETS.STATUS, widgetAction);

  // --- Devices and configuration --------------------------------------------------

  gladys.onScanRequest(async () => {
    await poll('scan');
    await publishDiscovery({ force: true });
  });

  gladys.onDeviceCreated(async (device) => {
    const model = byExternalId(device.external_id);
    if (model) await publishStates([model]);
    refreshWidgets();
  });

  gladys.onDeviceUpdated(async (device) => {
    const model = byExternalId(device.external_id);
    if (model) await publishStates([model]);
  });

  gladys.onConfigUpdated(async (raw) => {
    const previous = { ...config, language: textLanguage() };
    config = normalizeConfig(raw);
    language = readLanguage(raw, language);
    api.setCredentials(config.consumerKey, config.consumerSecret);
    const credentialsChanged =
      config.consumerKey !== previous.consumerKey ||
      config.consumerSecret !== previous.consumerSecret;
    if (credentialsChanged) {
      connection = 'unknown';
      connectionDetail = null;
      pausedUntil = 0;
      backoff = 0;
      lastStatus = null;
    }
    if (textLanguage() !== previous.language) await publishDiscovery();
    if (credentialsChanged || config.refreshMinutes !== previous.refreshMinutes) {
      nextPollAt = 0;
      await tick();
    } else {
      refreshWidgets();
    }
  });

  gladys.on('connected', async () => {
    const raw = gladys.config ?? {};
    config = normalizeConfig(raw);
    language = readLanguage(raw, language);
    api.setCredentials(config.consumerKey, config.consumerSecret);
    lastStatus = null;
    lastDiscovery = null;
    nextPollAt = 0;
    running = poll('connected');
    await running;
    if (tickMs > 0 && timer === null) {
      timer = setInterval(() => {
        running = tick().catch((err) => logger.error('Tick failed', err));
      }, tickMs);
      timer.unref?.();
    }
  });

  const stop = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  gladys.handleShutdown(async (signal) => {
    logger.info(`Received ${signal} -> graceful shutdown`);
    stop();
    await running;
    state.save();
  });

  return {
    poll,
    tick,
    stop,
    state,
    devices: () => models(),
    connection: () => connection,
    hot,
    pending,
  };
}

export {
  ACTIONS,
  TICK_MS,
  HOT_REFRESH_DELAYS_MS,
  PENDING_MS,
  MIN_MANUAL_GAP_MS,
  REFUSED_RETRY_MS,
  MAX_PAUSE_MS,
  TRIGGERS,
  createApp,
};
