// Builds the widget contents of the illustrations with the integration's own
// code: node gen.mjs <repo> <out.json> (run by render.sh)
//
// The two widgets on the made-up devices of a home, on a fixed morning
// (Tuesday 27 October 2026, 8:42): five rooms (a radiator thermostat heating,
// one with its window open, a bathroom on the floor heating with a low
// battery, a bedroom away, a room sensor) and the connection to the API.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [repo, out] = process.argv.slice(2);
const load = (path) => import(pathToFileURL(`${repo}/${path}`).href);
const { buildRoomsWidget, buildStatusWidget } = await load('src/widgets.js');
const { parseDevice } = await load('src/ally.js');
const { LANGUAGES } = await load('src/i18n.js');
const manifest = JSON.parse(readFileSync(`${repo}/gladys-assistant-integration.json`, 'utf8'));

const NOW = Date.parse('2026-10-27T07:42:00Z');
const status = (entries) => Object.entries(entries).map(([code, value]) => ({ code, value }));
const radiator = (id, mode, values) => ({
  id,
  online: true,
  update_time: Math.floor(NOW / 1000) - 600,
  device_type: 'Danfoss Ally™ Radiator Thermostat',
  status: status({
    mode,
    temp_set: 210,
    lower_temp: 50,
    upper_temp: 350,
    window_state: 'close',
    child_lock: false,
    battery_percentage: 81,
    fault: 0,
    manual_mode_fast: 200,
    at_home_setting: 210,
    leaving_home_setting: 170,
    pause_setting: 50,
    holiday_setting: 150,
    ext_measured_rs: -8000,
    radiator_covered: false,
    pi_heating_demand: 0,
    ...values,
  }),
});
const RAW = [
  radiator('a1', 'at_home', { temp_current: 198, pi_heating_demand: 42 }),
  radiator('a2', 'at_home', { temp_current: 176, window_state: 'open', pi_heating_demand: 0 }),
  {
    id: 'a3',
    online: true,
    update_time: Math.floor(NOW / 1000) - 1800,
    device_type: 'Danfoss Icon2 RT',
    status: status({
      mode: 'manual',
      temp_set: 220,
      temp_current: 221,
      MeasuredValue: 254,
      floor_sensor: true,
      humidity_value: 612,
      battery_percentage: 14,
      child_lock: true,
      output_status: 'inactive',
      manual_mode_fast: 220,
      at_home_setting: 220,
      leaving_home_setting: 180,
      pause_setting: 150,
      holiday_setting: 150,
      lower_temp: 150,
      upper_temp: 300,
    }),
  },
  radiator('a4', 'leaving_home', { temp_current: 172, battery_percentage: 64 }),
  {
    id: 'a5',
    online: true,
    update_time: Math.floor(NOW / 1000) - 300,
    device_type: 'Danfoss Ally™ Room Sensor',
    status: status({ temp_current: 205, humidity_value: 468, battery_percentage: 92 }),
  },
];
const NAMES = {
  en: ['Living room', 'Kitchen', 'Bathroom', 'Bedroom', 'Office sensor'],
  fr: ['Salon', 'Cuisine', 'Salle de bains', 'Chambre', 'Capteur bureau'],
  de: ['Wohnzimmer', 'Küche', 'Badezimmer', 'Schlafzimmer', 'Sensor Büro'],
  es: ['Salón', 'Cocina', 'Baño', 'Dormitorio', 'Sensor despacho'],
};
const LOW_BATTERY = new Set(['a3']);

const contents = {};
for (const language of LANGUAGES) {
  const devices = RAW.map((raw, i) => {
    const model = parseDevice({ ...raw, name: NAMES[language][i] });
    return { model, name: model.name, batteryLow: LOW_BATTERY.has(raw.id) };
  });
  contents[language] = {
    rooms: buildRoomsWidget({
      devices,
      connection: 'ok',
      lastSuccessAt: NOW - 60 * 1000,
      canSetMode: true,
      language,
      units: 'metric',
      now: NOW,
    }),
    status: buildStatusWidget({
      connection: 'ok',
      online: 5,
      total: 5,
      requests: 34,
      lastSuccessAt: NOW - 60 * 1000,
      refreshMinutes: 2,
      language,
      now: NOW,
    }),
  };
}
const widgets = Object.fromEntries(
  manifest.widgets.map((w) => [w.key, { icon: w.icon, label: w.label }]),
);
writeFileSync(out, JSON.stringify({ now: NOW, widgets, contents }));
