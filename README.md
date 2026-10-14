# VIZIO SmartCast for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for **VIZIO SmartCast TVs and sound
bars**, on the local network: power, volume, mute, inputs, apps, picture and sound modes, remote
keys, a scene trigger, scene actions and dashboard widgets. No cloud, no VIZIO account.

> **Developed without the hardware: feedback welcome.** The requests follow the open-source
> libraries below and the answers of a real TV they published, but this integration has not run
> against a real VIZIO device yet. Please report what works and what does not in the
> [issues](https://github.com/guim31/gladys-vizio/issues).

Not affiliated with VIZIO, Inc. VIZIO and SmartCast are trademarks of their owners.

## What it does

- **Finds the devices** on the network through Gladys (mDNS `_viziocast._tcp`), or at the addresses
  typed in the configuration.
- **Pairs each TV** by PIN with two configuration actions, **Start pairing** and **Enter the PIN**;
  the token stays in the integration's private storage (`/data`). Sound bars need no pairing.
- **One Gladys device per TV or sound bar**, keyed by its serial number: Power, Volume, Volume
  down/up, Mute, Input (with the names set on the TV), App (SmartCast Home and your favorite apps),
  Now playing, Picture mode (TVs), Sound mode (sound bar EQ), Channel down/up (TVs with a tuner).
- **Scene trigger** "TV: app or input changed" (Netflix → dim the lights), **scene actions** to open
  any app of the SmartCast catalog, choose an input and send a remote key.
- **Widgets**: a remote (state, volume, power, mute), four shortcuts (apps or inputs), four keys.
- Texts in English, French, German and Spanish.

The user documentation is in [docs/en.md](docs/en.md) ([fr](docs/fr.md), [de](docs/de.md),
[es](docs/es.md)).

## Requirements

- A VIZIO SmartCast TV (2016 and later) or sound bar, on the same network as Gladys.
- Gladys Assistant 5.1.0 or later.
- The TV's power mode set to **Quick Start**: in Eco Mode a TV in standby turns its network off, and
  cannot be turned on from Gladys.

## Installation

In Gladys: **Integrations → Install from GitHub**, then `guim31/gladys-vizio`. Turn the devices on,
pair each TV from the configuration page, and add the devices in the Discovery tab.

## Limitations

- Developed without the hardware (see above).
- A TV in Eco Mode is neither seen nor turned on while in standby; Wake-on-LAN is not used.
- SmartCast has no request listing the installed apps: the app list is the catalog of pyvizio.
- Mute is a toggle button (SmartCast TVs toggle on every mute key); its state shows in the widget.
- Picture and sound modes appear only when the firmware offers them.

## Development

Node.js 22 or later, the official
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js) as the
only runtime dependency.

```bash
npm ci
npm run format:check
npm run lint
npm test
node test/helpers/vizioServer.js            # a fake TV over HTTPS on port 7345, PIN 1234
VIZIO_TOKEN=... node scripts/probe.mjs <ip>  # read-only check of a real device
```

The tests run against the SDK's fake Gladys and fake SmartCast devices answering with the captures
of a real TV (`test/fixtures/vizio/`). See [CLAUDE.md](CLAUDE.md) for the architecture and the rules
of the repository.

## Credits

- [pyvizio](https://github.com/raman325/pyvizio) (MIT, Copyright (c) 2017 Vlad Korniev): the SmartCast endpoints, key codes and the catalog of apps (`src/vizio/apps.json`).
- [vizaio](https://github.com/raman325/vizaio) (MIT, Copyright (c) 2026 Raman Gupta): the protocol
  notes checked on hardware and the captures of a real TV used as test fixtures.
- The Home Assistant [`vizio`](https://www.home-assistant.io/integrations/vizio) integration
  (Apache-2.0): how the devices are polled and paired.
- The structure of [gladys-sony-bravia](https://github.com/guim31/gladys-sony-bravia) and
  [gladys-roku](https://github.com/guim31/gladys-roku).

## License

[Apache-2.0](LICENSE)
