# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-14

### Added

- VIZIO SmartCast TVs and sound bars, on the local network: found by mDNS through Gladys or at
  addresses typed in the configuration, one device per TV or sound bar, kept across IP changes.
- PIN pairing of the TVs with the "Start pairing" and "Enter the PIN" actions; the token is kept
  in the integration's storage, never in the logs.
- Features: power, volume, volume down and up, mute, input (with the names set on the TV), app
  (SmartCast Home and the favorite apps of the configuration), now playing, picture mode, sound
  mode of sound bars, channel down and up.
- Scene trigger "TV: app or input changed", scene actions "Open an app on the TV", "Choose an
  input" and "Send a remote control key".
- Dashboard widgets: VIZIO remote, VIZIO shortcuts and VIZIO keys.
- "Test the connection" action, and a status that says which TV needs pairing or does not answer.
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-vizio/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-vizio/releases/tag/v1.0.1
