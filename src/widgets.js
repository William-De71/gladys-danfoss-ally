// -----------------------------------------------------------------------------
// Dashboard widgets, built from the last reading (no request to Danfoss).
//
//   - rooms:  every thermostat and sensor (or the ones chosen in the widget
//             settings) as a list — measured temperature, setpoint, mode,
//             a badge for what needs attention (offline, fault, window open,
//             low battery, heating), the details on tap — and the buttons
//             "Home mode" / "Away mode" for the whole home, and "Refresh";
//   - status: the connection to the Danfoss Ally API, the devices online,
//             the requests of the last hour, and "Refresh".
//
// The content stays within the budget of the core (8 components, 1 focal,
// 2 texts, 1 status, 4 buttons) and every text exists in the four languages
// (test/widgets.test.js runs validateWidgetContent on them).
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { targetTemperature, hasModeSetpoints, MODE_TO_SETPOINT_CODE } from './ally.js';
import { t, ago, formatNumber } from './i18n.js';

const WIDGETS = { ROOMS: 'rooms', STATUS: 'status' };
const WIDGET_ACTIONS = {
  ALL_AT_HOME: 'all_at_home',
  ALL_LEAVING_HOME: 'all_leaving_home',
  REFRESH: 'refresh',
};
// A list card holds 8 rows at most.
const MAX_ITEMS = 8;
const TTL_SECONDS = 60;

const isFahrenheit = (units) => units === 'us' || units === 'imperial';

/**
 * @description A temperature in the unit of the user: "20.5 °C", "68.9 °F".
 * @param {number|null} celsius - The temperature.
 * @param {string} units - metric or us.
 * @param {string} language - The language.
 * @returns {string} The text ("—" when unknown).
 */
function formatTemperature(celsius, units, language) {
  if (celsius === null || celsius === undefined) return '—';
  if (isFahrenheit(units)) return `${formatNumber((celsius * 9) / 5 + 32, language)} °F`;
  return `${formatNumber(celsius, language)} °C`;
}

/**
 * @description The name of a Danfoss mode in a language.
 * @param {string|null} mode - The mode.
 * @param {string} language - The language.
 * @returns {string} The name.
 */
function modeLabel(mode, language) {
  if (!mode) return '';
  const key = `mode_${mode}`;
  const text = t(key, language);
  return text === key ? mode : text;
}

/**
 * @description The badge of a device: what needs attention first.
 * @param {object} model - A parsed device.
 * @param {boolean} batteryLow - The battery is under the threshold.
 * @param {string} language - The language.
 * @returns {{text: string, color: string}|undefined} The badge.
 */
function badgeOf(model, batteryLow, language) {
  if (!model.online) return { text: t('badgeOffline', language), color: WIDGET_COLORS.DANGER };
  if (model.fault || model.errorCode) {
    return { text: t('badgeFault', language), color: WIDGET_COLORS.DANGER };
  }
  if (model.windowOpen) return { text: t('badgeWindow', language), color: WIDGET_COLORS.WARNING };
  if (batteryLow && model.battery !== null) {
    return {
      text: t('badgeBattery', language, { n: model.battery }),
      color: WIDGET_COLORS.WARNING,
    };
  }
  if (model.heating) {
    return {
      text:
        model.valveOpening !== null
          ? t('badgeHeatingPercent', language, { n: model.valveOpening })
          : t('badgeHeating', language),
      color: WIDGET_COLORS.INFO,
    };
  }
  return undefined;
}

/**
 * @description The details of a device, shown when its row is tapped.
 * @param {object} model - A parsed device.
 * @param {object} options - Options.
 * @returns {string} One fact per line.
 */
function detailsOf(model, { units, language, now }) {
  const temperature = (value) => formatTemperature(value, units, language);
  const lines = [];
  // French typography: a (non-breaking) space before the colon.
  const separator = language === 'fr' ? '\u00a0: ' : ': ';
  const line = (key, value) => lines.push(`${t(key, language)}${separator}${value}`);
  if (model.model) line('detailModel', model.model);
  line('detailState', model.online ? t('online', language) : t('offline', language));
  if (model.temperature !== null) line('detailTemperature', temperature(model.temperature));
  const target = targetTemperature(model);
  if (target !== null) {
    const mode = model.mode ? ` (${modeLabel(model.mode, language)})` : '';
    line('detailSetpoint', `${temperature(target)}${mode}`);
  }
  if (hasModeSetpoints(model)) {
    const presets = ['at_home', 'leaving_home', 'pause', 'holiday', 'manual']
      .map(
        (mode) =>
          `${modeLabel(mode, language)} ${temperature(model.setpoints[MODE_TO_SETPOINT_CODE[mode]])}`,
      )
      .join(' · ');
    line('detailSetpoints', presets);
  }
  if (model.floorTemperature !== null) line('detailFloor', temperature(model.floorTemperature));
  if (model.humidity !== null)
    line('detailHumidity', `${formatNumber(model.humidity, language)} %`);
  if (model.valveOpening !== null) line('detailValve', `${model.valveOpening} %`);
  if (model.battery !== null) line('detailBattery', `${model.battery} %`);
  if (model.windowOpen !== null) {
    line('detailWindow', t(model.windowOpen ? 'windowOpen' : 'windowClosed', language));
  }
  if (model.childLock !== null) {
    line('detailChildLock', t(model.childLock ? 'yes' : 'no', language));
  }
  if (model.externalTemperature !== null) {
    line('detailExternal', temperature(model.externalTemperature));
  }
  if (model.fault || model.errorCode) {
    line('detailFault', [model.fault, model.errorCode].filter(Boolean).join(' / '));
  }
  if (model.updateTime) line('detailUpdated', ago(model.updateTime * 1000, now, language));
  return lines.join('\n');
}

/**
 * @description The one-line summary of a device: "20.5 °C → 21 °C · Home".
 * @param {object} model - A parsed device.
 * @param {string} units - metric or us.
 * @param {string} language - The language.
 * @returns {string} The summary.
 */
function summaryOf(model, units, language) {
  const parts = [];
  const target = targetTemperature(model);
  const measured = model.temperature;
  if (measured !== null && target !== null) {
    parts.push(
      `${formatTemperature(measured, units, language)} → ${formatTemperature(target, units, language)}`,
    );
  } else if (measured !== null) {
    parts.push(formatTemperature(measured, units, language));
  } else if (target !== null) {
    parts.push(`→ ${formatTemperature(target, units, language)}`);
  }
  if (model.mode) parts.push(modeLabel(model.mode, language));
  else if (model.humidity !== null) parts.push(`${formatNumber(model.humidity, language)} %`);
  return parts.join(' · ').slice(0, 60);
}

/**
 * @description The rooms widget.
 * @param {object} options - Options.
 * @param {Array<{model: object, name: string, batteryLow: boolean}>} options.devices - The devices to show.
 * @param {number} options.hidden - Devices left out (more than 8).
 * @param {string} options.connection - ok, unconfigured, refused, rate_limited, error, unknown.
 * @param {number} options.lastSuccessAt - Last successful reading (ms, 0: never).
 * @param {boolean} options.canSetMode - At least one device takes the mode buttons.
 * @param {string} options.language - The language.
 * @param {string} [options.units] - metric or us.
 * @param {number} options.now - Now (ms).
 * @returns {object} The content.
 */
function buildRoomsWidget({
  devices,
  hidden = 0,
  connection,
  lastSuccessAt,
  canSetMode,
  language,
  units = 'metric',
  now,
}) {
  const components = [];
  if (lastSuccessAt) {
    components.push({
      type: 'text',
      variant: 'caption',
      text:
        hidden > 0
          ? t('captionUpdatedHidden', language, {
              ago: ago(lastSuccessAt, now, language),
              n: hidden,
            })
          : t('captionUpdated', language, { ago: ago(lastSuccessAt, now, language) }),
    });
  }
  if (devices.length > 0) {
    components.push({
      type: 'card-list',
      display: 'list',
      items: devices.slice(0, MAX_ITEMS).map(({ model, name, batteryLow }) => {
        const badge = badgeOf(model, batteryLow, language);
        return {
          title: name.slice(0, 60),
          subtitle: summaryOf(model, units, language) || t('noReading', language),
          ...(badge ? { badge } : {}),
          description: detailsOf(model, { units, language, now }),
        };
      }),
    });
  } else {
    const key = connection === 'ok' ? 'emptyRooms' : `connection_${connection}_hint`;
    components.push({ type: 'text', variant: 'body', text: t(key, language) });
  }
  if (canSetMode) {
    components.push(
      {
        type: 'button',
        label: t('buttonAllHome', language),
        icon: 'home',
        style: 'primary',
        action: { key: WIDGET_ACTIONS.ALL_AT_HOME, confirm: true },
      },
      {
        type: 'button',
        label: t('buttonAllAway', language),
        icon: 'log-out',
        style: 'secondary',
        action: { key: WIDGET_ACTIONS.ALL_LEAVING_HOME, confirm: true },
      },
    );
  }
  components.push({
    type: 'button',
    label: t('buttonRefresh', language),
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: WIDGET_ACTIONS.REFRESH },
  });
  return { ttl_seconds: TTL_SECONDS, components };
}

const CONNECTION_COLOR = {
  ok: WIDGET_COLORS.SUCCESS,
  unconfigured: WIDGET_COLORS.WARNING,
  refused: WIDGET_COLORS.DANGER,
  rate_limited: WIDGET_COLORS.WARNING,
  error: WIDGET_COLORS.DANGER,
  unknown: WIDGET_COLORS.NEUTRAL,
};

/**
 * @description The connection widget.
 * @param {object} options - Options.
 * @param {string} options.connection - ok, unconfigured, refused, rate_limited, error, unknown.
 * @param {number} options.online - Devices online.
 * @param {number} options.total - Devices listed by Danfoss (published ones).
 * @param {number} options.requests - Requests of the last hour.
 * @param {number} options.lastSuccessAt - Last successful reading (ms, 0: never).
 * @param {number} options.refreshMinutes - The reading interval.
 * @param {number} options.pausedUntil - End of a slow-down (ms, 0: none).
 * @param {string} options.language - The language.
 * @param {number} options.now - Now (ms).
 * @returns {object} The content.
 */
function buildStatusWidget({
  connection,
  online,
  total,
  requests,
  lastSuccessAt,
  refreshMinutes,
  pausedUntil = 0,
  language,
  now,
}) {
  const components = [
    {
      type: 'value',
      value: `${online}/${total}`,
      label: t('tileOnline', language),
      icon: 'wifi',
      color: total > 0 && online === total ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.WARNING,
    },
    {
      type: 'value',
      value: requests,
      label: t('tileRequests', language),
      icon: 'activity',
    },
  ];
  const rows = [
    {
      label: t('rowConnection', language),
      value: t(`connection_${connection}`, language),
      color: CONNECTION_COLOR[connection] ?? WIDGET_COLORS.NEUTRAL,
    },
    {
      label: t('rowLastReading', language),
      value: ago(lastSuccessAt, now, language),
      color: WIDGET_COLORS.NEUTRAL,
    },
    {
      label: t('rowInterval', language),
      value: t('everyMinutes', language, { n: refreshMinutes }),
      color: WIDGET_COLORS.NEUTRAL,
    },
  ];
  if (pausedUntil > now) {
    rows.push({
      label: t('rowPaused', language),
      value: t('inMinutes', language, { n: Math.ceil((pausedUntil - now) / 60000) }),
      color: WIDGET_COLORS.WARNING,
    });
  }
  components.push({ type: 'status', items: rows });
  if (connection !== 'ok' && connection !== 'unknown') {
    components.push({
      type: 'text',
      variant: 'body',
      text: t(`connection_${connection}_hint`, language),
    });
  }
  components.push({
    type: 'button',
    label: t('buttonRefresh', language),
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: WIDGET_ACTIONS.REFRESH },
  });
  return { ttl_seconds: TTL_SECONDS, components };
}

export {
  WIDGETS,
  WIDGET_ACTIONS,
  MAX_ITEMS,
  formatTemperature,
  modeLabel,
  badgeOf,
  detailsOf,
  summaryOf,
  buildRoomsWidget,
  buildStatusWidget,
};
