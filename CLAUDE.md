# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for Danfoss Ally radiator
thermostats, room sensors and Icon / Icon2 room thermostats: a Node.js service
(Node 22+, ESM, no build step) that runs in its own sandboxed Docker container
and talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. The devices come from the official **Danfoss Ally
API** (developer.danfoss.com), with the Consumer Key and Consumer Secret of the
user's own app (OAuth2 client credentials). Transport: cloud.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
DEBUG=gladys-integration-sdk npm test     # with the SDK debug logs
npm run coverage                          # tests with the coverage of node --test
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store . --skip-image-check   # store checks
scripts/build-cover.sh                    # cover.jpg from docs/assets/cover.svg
docs/illustrations/render.sh              # docs/assets/widgets.<lang>.png
node .github/scripts/release.mjs next     # the version the next release would get
```

## Architecture

```
index.js                SDK wiring only (new GladysIntegration + createApp)
src/app.js              every handler, registered before connect(); the clock
                        (tick), the readings, the commands and their quick
                        readings, the errors (refused credentials, 429), the status
src/danfoss-api.js      the HTTP client: token (client credentials, renewed 30 s
                        before it expires), one request at a time (~3/s), 429
                        retried then reported, error classes; never logs a secret
src/ally.js             the Danfoss data model: status codes -> parsed device,
                        setpoint of a mode, command encoding (tenths, modes,
                        last_click_time, external temperature)
src/device.js           one Gladys device per Danfoss device, its features and states
src/constants.js        Gladys core values the SDK does not export (thermostat
                        mode / preset / operating state, opening sensor)
src/events.js           scene trigger detection (transitions) and action keys
src/widgets.js          rooms and status dashboard widgets
src/state.js            /data/state.json: trigger snapshots, external temperature times
src/config.js           configuration (credentials, interval, battery threshold, language)
src/i18n.js             runtime texts, en / fr / de / es
gladys-assistant-integration.json   manifest
docs/{en,fr,de,es}.md   user documentation, re-hosted by the store
docs/illustrations/     generated widget images (render.sh, gen.mjs, render.js)
.github/scripts/release.mjs         version, changelog, bump (tested in test/)
```

## Rules

- **External ids are forever**, and so is every key users store: the device
  external id `ext:<selector>:ally:<Danfoss id>` (URI-encoded, never the name),
  the feature keys (`target_temperature`, `mode`, `preset`, `operating_state`,
  `temperature`, `floor_temperature`, `humidity`, `battery`, `window`,
  `child_lock`), feature `category` / `type` / `unit` / `min` / `max` / `step`,
  the keys of `config_schema`, `actions`, the select values (`1`, `2`, `5`, `10`,
  `auto`…), the widgets and their settings, the widget button actions
  (`all_at_home`, `all_leaving_home`, `refresh`), the scene triggers (fields,
  options, variables) and scene actions (fields, options, outputs).
  `test/structure.test.js` compares them to
  `test/fixtures/discovery.baseline.json`: never update the baseline to make a
  test pass without a documented migration.
- **Category / type pairs** come from the SDK constants and the core 5.3.0:
  `thermostat` / `target-temperature`, `mode`, `preset`, `operating-state`;
  `temperature-sensor`, `humidity-sensor` / `decimal`; `battery` / `integer`;
  `opening-sensor` / `binary` (**0 = open, 1 = closed**); `child-lock` /
  `binary`. The Danfoss mode maps onto the Gladys mode + preset pair (table in
  `src/device.js`); there is no Gladys category for a valve opening in %: it
  shows in the rooms widget, and `operating-state` says whether it heats.
- **`should_poll` stays false**: one `GET /ally/devices` reads the whole home
  on the integration's own clock (1, 2, 5 or 10 minutes). Never add a request
  per device to the regular reading. After a command, the device alone is read
  again at 20 s, 1, 2, 3 and 5 min (`/status`, `/devices/{id}` when /status
  answers 500), and the commanded values are kept for 5 minutes over the cloud
  answers, which lag behind.
- **Danfoss throttles** without a published quota: at most about three
  requests per second, a 429 is retried twice (Retry-After first) then slows
  the readings down (the interval doubles, up to 30 minutes); refused
  credentials are tried again every 30 minutes or as soon as they change.
- **Writes**: setpoints in whole tenths, 5 to 35 °C by 0.5 °C, within the
  `lower_temp` / `upper_temp` of the device; the setpoint written is the one of
  the current mode (`MODE_TO_SETPOINT_CODE`), `temp_set` on a device that has
  no per-mode setpoints. A mode change to `at_home` / `leaving_home` carries
  `last_click_time`. An external temperature is sent at most every 5 minutes
  per device.
- **The Consumer Secret** is a `secret`: never logged, never in /data, never
  in a scene variable nor an error message; neither is the access token.
- **Scene events**: one per transition between two readings of a device the
  user added (baseline at the first reading, kept in /data across restarts);
  never as the consequence of a command of the integration (a mode the
  integration asked for never fires `mode_changed`).
- **Gladys does not pass DEBUG / LOG_LEVEL to the container**: never tell a
  store user to set them; "Test the connection" is the diagnostic button.
- **The container rootfs is read-only.** Write only under `/data`.
- **Four languages.** Every user-facing text (manifest, runtime messages in
  `src/i18n.js`, `docs/*.md`, README) exists in English, French, German and
  Spanish. `test/i18n.test.js` checks it.
- **Widget images.** After any change to the content of a widget, run
  `docs/illustrations/render.sh` again and look at the four PNG files.
- **No copied code.** The protocol facts come from pydanfossally (credited in
  NOTICE); never copy code from it nor from the Home Assistant `danfoss_ally`
  component (GPL-3.0).
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, the lockfile or the manifest, nor the `docker_image` tag.
  The version stays below 1.0.0 until the maintainer runs the Release workflow
  with `release-as: 1.0.0`.
- **Changelog.** Never edit CHANGELOG.md by hand, it is generated at the
  release. Write the PR title as the line the user will read.
- **Commits and PR titles** follow Conventional Commits, in English: `feat` ->
  minor, `fix` / `perf` -> patch, `!` or `BREAKING CHANGE:` -> major (minor
  below 1.0.0); `docs`, `chore`, `ci`, `test`, `style`, `refactor`, `build`
  release nothing.
- **Manifest.** Texts are objects `{ "en", "fr", "de", "es" }`; the catalog
  `description` holds 10 to 100 characters per language; the file stays under
  100 KB. `>=5.3.0` for `keywords`; no `countries` (Danfoss Ally is sold
  across Europe and beyond); no permission. Transport: `["cloud"]`.
- **CI smoke test.** `ci.yml` counts the features of a radiator thermostat (8)
  and of a room sensor (3) in the Docker image: update it with the features.
- **Forum drafts** (`.github/forum-*.md`) are never committed.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
