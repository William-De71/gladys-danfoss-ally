// -----------------------------------------------------------------------------
// Entry point of the Danfoss Ally external integration.
//
// Danfoss Ally radiator thermostats, room sensors and Icon room thermostats,
// through the official Danfoss Ally API and the user's own app of the Danfoss
// developer portal:
//   - devices: one per Danfoss device that reports something (setpoint,
//     heating mode and preset, room and floor temperature, humidity, battery,
//     open window, heating state, child lock), offered on the Discovery
//     screen (see src/device.js);
//   - scene triggers: window opened / closed, battery low, device offline /
//     back online, fault reported, mode changed from the app or the device;
//   - scene actions: change the mode (one device or all), set the setpoint of
//     a mode, send an external temperature, read now;
//   - dashboard widgets: the rooms (with "Home mode" / "Away mode" for the
//     whole home), the connection.
//
// This file only wires the SDK client: the handlers are in src/app.js.
//
// Environment variables provided by the Gladys supervisor:
//   GLADYS_HOST_API_URL / GLADYS_INTEGRATION_TOKEN / GLADYS_INTEGRATION_SELECTOR
//   TZ (the timezone of Gladys: the local time of the mode changes)
// The SDK reads the first three: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';
import { createDanfossApi } from './src/danfoss-api.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const gladys = new GladysIntegration();
createApp(gladys, { api: createDanfossApi({ userAgent: `gladys-danfoss-ally/${version}` }) });

// --- Startup -----------------------------------------------------------------------
logger.info(`Starting the Danfoss Ally integration ${version}...`);
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
