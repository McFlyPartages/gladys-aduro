# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Aduro H1 to H6 hybrid stoves over the local NBE protocol (UDP 8483): fixed IP
  address or discovery on the local network through Gladys. The Aduro cloud
  relay is an opt-in fallback, off by default.
- Start and stop, heat level, target temperature and operation mode, with the
  change followed until the stove applies it and re-sent when it does not.
- Temperatures (room, smoke, shaft), heat output, carbon monoxide, state and
  detail texts in English or French, operating times.
- Consumption (today, yesterday, month, year, total) and the pellets left in
  the hopper, with refill and cleaning buttons.
- Automatic stop at low pellets, automatic return to pellets after wood mode,
  forced fan and forced auger.
- Pellets run-out prediction in heat level mode: the consumption of each
  level and of an ignition is learned while the stove burns.
- Scene triggers: smoke too hot, wood fire dying, low pellets, stopped at low
  pellets, stove fault.
