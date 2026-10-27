import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import { parseDevice } from '../src/ally.js';
import {
  buildRoomsWidget,
  buildStatusWidget,
  formatTemperature,
  summaryOf,
  detailsOf,
  WIDGET_ACTIONS,
  MAX_ITEMS,
} from '../src/widgets.js';
import { LANGUAGES } from '../src/i18n.js';
import { ALL, RADIATOR, ICON2, ROOM_SENSOR, ICON_RT, variant } from './helpers/fixtures.js';

const NOW = Date.parse('2026-10-27T07:42:00Z');
const entry = (raw, batteryLow = false) => {
  const model = parseDevice(raw);
  return { model, name: model.name, batteryLow };
};
const rooms = (overrides = {}) =>
  buildRoomsWidget({
    devices: [RADIATOR, ICON2, ROOM_SENSOR, ICON_RT].map((raw) => entry(raw)),
    connection: 'ok',
    lastSuccessAt: NOW - 60000,
    canSetMode: true,
    language: 'en',
    now: NOW,
    ...overrides,
  });
const status = (overrides = {}) =>
  buildStatusWidget({
    connection: 'ok',
    online: 4,
    total: 4,
    requests: 31,
    lastSuccessAt: NOW - 30000,
    refreshMinutes: 2,
    language: 'en',
    now: NOW,
    ...overrides,
  });
const byType = (content, type) => content.components.filter((c) => c.type === type);

test('every content is rendered exactly as sent, in every language and state', () => {
  const states = ['ok', 'unknown', 'unconfigured', 'refused', 'rate_limited', 'error'];
  for (const language of LANGUAGES) {
    for (const units of ['metric', 'us']) {
      assert.deepEqual(validateWidgetContent(rooms({ language, units })), [], language);
    }
    const many = Array.from({ length: 12 }, (_, i) =>
      entry({ ...RADIATOR, id: `id${i}`, name: `Room with a rather long name number ${i}` }),
    );
    assert.deepEqual(
      validateWidgetContent(rooms({ language, devices: many.slice(0, 8), hidden: 4 })),
      [],
    );
    const troubles = [
      entry(variant(RADIATOR, {}, { online: false })),
      entry(variant(RADIATOR, { fault: 4, sw_error_code: 'E12' })),
      entry(variant(RADIATOR, { window_state: 'open' })),
      entry(variant(RADIATOR, { battery_percentage: 100 }), true),
      entry(variant(ICON2, { output_status: 'inactive', mode: 'holiday_sat' })),
    ];
    assert.deepEqual(validateWidgetContent(rooms({ language, devices: troubles })), [], language);
    for (const connection of states) {
      assert.deepEqual(
        validateWidgetContent(rooms({ language, devices: [], connection, lastSuccessAt: 0 })),
        [],
        `${language} rooms ${connection}`,
      );
      assert.deepEqual(
        validateWidgetContent(
          status({ language, connection, pausedUntil: NOW + 9 * 60000, total: 0, online: 0 }),
        ),
        [],
        `${language} status ${connection}`,
      );
    }
  }
});

test('rooms: one row per device, the details on tap, the buttons for the whole home', () => {
  const content = rooms({ language: 'fr' });
  const [list] = byType(content, 'card-list');
  assert.equal(list.display, 'list');
  assert.equal(list.items.length, 4);
  const [living] = list.items;
  assert.equal(living.title, 'Living room');
  assert.equal(living.subtitle, '19,8 °C → 21 °C · Maison');
  assert.deepEqual(living.badge, { text: 'Chauffe 42 %', color: 'info' });
  assert.match(living.description, /Consignes\u00a0: Maison 21 °C · Absent 17 °C · Pause 5 °C/);
  assert.match(living.description, /Ouverture de vanne\u00a0: 42 %/);
  assert.deepEqual(
    byType(content, 'button').map((b) => b.action.key),
    [WIDGET_ACTIONS.ALL_AT_HOME, WIDGET_ACTIONS.ALL_LEAVING_HOME, WIDGET_ACTIONS.REFRESH],
  );
  assert.ok(
    byType(content, 'button')
      .slice(0, 2)
      .every((b) => b.action.confirm === true),
  );
  assert.equal(byType(content, 'text')[0].text, 'Relevé il y a 1 min');
  assert.deepEqual(
    byType(rooms({ canSetMode: false }), 'button').map((b) => b.action.key),
    [WIDGET_ACTIONS.REFRESH],
  );
  assert.equal(list.items[2].subtitle, '19,1 °C · 48,8 %', 'a sensor shows its humidity');
});

test('rooms: badges by priority, Fahrenheit for US units, at most 8 rows', () => {
  const badge = (raw, low = false) =>
    byType(rooms({ devices: [entry(raw, low)] }), 'card-list')[0].items[0].badge;
  assert.equal(
    badge(variant(RADIATOR, { window_state: 'open' }, { online: false })).text,
    'Offline',
  );
  assert.equal(badge(variant(RADIATOR, { window_state: 'open', fault: 3 })).text, 'Fault');
  assert.equal(badge(variant(RADIATOR, { window_state: 'open' })).text, 'Window open');
  assert.equal(badge(variant(RADIATOR, { battery_percentage: 9 }), true).text, 'Battery 9 %');
  assert.equal(badge(variant(RADIATOR, { pi_heating_demand: 0 })), undefined);
  assert.equal(formatTemperature(20, 'us', 'en'), '68 °F');
  assert.equal(formatTemperature(null, 'metric', 'en'), '—');
  const us = byType(rooms({ units: 'us' }), 'card-list')[0].items[0];
  assert.equal(us.subtitle, '67.6 °F → 69.8 °F · Home');
  const twelve = Array.from({ length: 12 }, (_, i) => entry({ ...RADIATOR, id: `id${i}` }));
  const content = rooms({ devices: twelve, hidden: 4 });
  assert.equal(byType(content, 'card-list')[0].items.length, MAX_ITEMS);
  assert.match(byType(content, 'text')[0].text, /4 more/);
});

test('rooms without a device say why', () => {
  const empty = rooms({ devices: [], connection: 'ok' });
  assert.match(byType(empty, 'text').at(-1).text, /same e-mail address/);
  const refused = rooms({ devices: [], connection: 'refused', lastSuccessAt: 0 });
  assert.match(byType(refused, 'text')[0].text, /refuses the Consumer Key/);
});

test('status: devices online, requests, connection, slow-down, hint', () => {
  const content = status();
  assert.deepEqual(
    byType(content, 'value').map((v) => v.value),
    ['4/4', 31],
  );
  assert.equal(byType(content, 'value')[0].color, 'success');
  const [rows] = byType(content, 'status');
  assert.deepEqual(
    rows.items.map((row) => row.value),
    ['Connected', 'just now', 'every 2 min'],
  );
  assert.equal(byType(content, 'text').length, 0);
  const slowed = status({ connection: 'rate_limited', pausedUntil: NOW + 8 * 60000 + 1 });
  assert.equal(byType(slowed, 'status')[0].items.at(-1).value, 'in 9 min');
  assert.match(byType(slowed, 'text')[0].text, /slow down/);
  assert.equal(byType(status({ online: 3 }), 'value')[0].color, 'warning');
});

test('summaries and details of every model fit their bounds', () => {
  for (const raw of ALL) {
    const model = parseDevice(raw);
    for (const language of LANGUAGES) {
      assert.ok(summaryOf(model, 'metric', language).length <= 60);
      assert.ok(detailsOf(model, { units: 'metric', language, now: NOW }).length <= 2000);
    }
  }
  assert.match(
    detailsOf(parseDevice(variant(RADIATOR, { ext_measured_rs: 2050, fault: 4 })), {
      units: 'metric',
      language: 'de',
      now: NOW,
    }),
    /Externer Sensor: 20,5 °C[\s\S]*Störung: 4/,
  );
});
