# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/). This file is generated at
each release from the Conventional Commits: do not edit it by hand.

## [0.1.0] - 2026-10-27

### Added

- Danfoss Ally radiator thermostats, room sensors and Icon / Icon2 room thermostats through the official Danfoss Ally API, with the Consumer Key and Consumer Secret of the user's app on the Danfoss developer portal; the whole home read in one request every 1, 2, 5 or 10 minutes, a "Test the connection" button.
- One device per Danfoss device that reports something, with the features its status allows: setpoint (the one of the current mode, 5 to 35 °C by 0.5 °C), heating mode and preset (off / heating / auto, frost protection / away / comfort, mapped to the Danfoss modes), heating state, room and floor temperature, humidity, battery, open window, child lock.
- Commands followed by quick readings of the device for 5 minutes, the commanded values kept until the cloud confirms them; 429 answers slow the readings down instead of insisting.
- Scene triggers: window opened or closed, battery low, device offline or back online, fault reported, mode changed from the Ally app, the device or its schedule; each one filtered by device.
- Scene actions: change the heating mode of one thermostat or of all of them, set the setpoint of a mode, send a room temperature to a radiator thermostat behind a cover (once every 5 minutes at most), read the thermostats now.
- Dashboard widgets: the heating rooms (temperature, setpoint, mode, window, battery, details on tap, "Home mode" and "Away mode" for the whole home) and the connection to the Danfoss Ally API.
- English, French, German and Spanish everywhere: settings, devices, widgets, scenes and documentation.

[0.1.0]: https://github.com/William-De71/gladys-danfoss-ally/releases/tag/v0.1.0
