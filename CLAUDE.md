# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for Aduro hybrid pellet stoves: a
Node.js service (Node 22+, ESM, no build step) that runs in its own sandboxed
Docker container. It talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
(the only runtime dependency) and to the stove over UDP with the NBE protocol
(`node:dgram`).

It is a port of the Home Assistant integration
[NewImproved/Aduro](https://github.com/NewImproved/Aduro) (stove logic, value
positions, labels) and of [pyduro](https://github.com/clementprevot/pyduro)
(frames). Both are MIT: keep their notices in `NOTICE.md`. When the stove
behaves oddly, those two sources are the reference.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/stove.test.js            # one file
node --test --test-name-pattern "pellets" # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
npm run release -- patch                  # release bump (minor, major, x.y.z), see Releasing
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image (on GitHub only): run the three
commands before pushing.

## Architecture

```
index.js                          SDK wiring only: handlers registered before connect()
src/config.js                     DEFAULT_CONFIG (mirrors the manifest defaults), LIMITS, normalization
src/protocol.js                   NBE frames (pure)
src/client.js                     UDP client (socket factory injected), requests serialized
src/readings.js                   reply payloads -> readings, state labels (pure)
src/stove.js                      one stove: reach, poll, command follow-up, pellets, alerts
src/prediction.js                 learned kg/h per heat level, run-out prediction (pure)
src/device.js                     Stove -> Gladys device, states, commands
src/widgets.js                    dashboard widgets "stove" and "stats", widget buttons, pictures
scripts/render-stove.mjs          draws assets/stove-*.webp (npm run render); bump ASSETS_VERSION after
src/bridge.js                     poll loop and publications (client, store, timers injected)
src/store.js                      /data/state.json: pellet counters and switches
gladys-assistant-integration.json manifest: name, config_schema, scene_triggers, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, against the SDK's fake Gladys and test/fixtures.js
.github/scripts/release.mjs       release bump (npm run release) and notes, tested in test/
```

## Forgejo first, GitHub as a mirror

The repository lives on Forgejo (`McFly/gladys-aduro`). A **push mirror**
copies it to GitHub (`McFlyPartages/gladys-aduro`) on every push to Forgejo
(branch or tag) and every 8 hours, **overwriting** GitHub: branches, tags and
commits that exist only on GitHub are lost at the next sync. So:

- Pull requests are opened and merged **on Forgejo only**. Never merge a pull
  request, push or run a workflow that commits on GitHub.
- GitHub is still where the public things happen: the store indexer reads its
  default branch, its Actions build the image on `ghcr.io` and publish the
  GitHub Releases. The image and Release jobs only run on GitHub
  (`if: github.server_url == 'https://github.com'`); the Forgejo runner only
  runs the lint and test jobs.

## Releasing

1. On a branch: `npm run release -- patch` (or `minor`, `major`, `x.y.z`). It
   bumps `package.json`, `package-lock.json`, the manifest (`version` and the
   `docker_image` tag) and moves `## [Unreleased]` of `CHANGELOG.md` under the
   new version. Then `npm run format:check && npm test`, commit
   `chore(release): x.y.z`, pull request on Forgejo.
2. Once it is merged: tag the merge commit and push the tag to Forgejo,
   `git tag -a vx.y.z -m "Release x.y.z" <commit> && git push origin vx.y.z`.
3. The mirror brings the tag to GitHub, where `build.yml` publishes
   `:x.y.z` + `:latest` and `github-release.yml` the GitHub Release. Check that
   the image is anonymously pullable, then the store picks the version up at
   its next indexing.

Between the merge (step 1) and the image (step 3), GitHub's manifest points at
an image that does not exist yet: an indexing run in that window rejects the
integration until the next one. Push the tag right after the merge.

## Rules

- **Network.** The container sits on a bridge network: unicast UDP works both
  ways, a broadcast never leaves it. Discovery goes through
  `gladys.scanNetwork('udp-active-broadcast')` and the manifest
  `network_discovery` entry (port 8483).
- **External ids are forever.** The device is
  `gladys.externalIds('stove', <serial>)`; feature keys are the `FEATURE`
  values of `src/device.js`. Never rename one: Gladys keys devices, history,
  scenes and dashboards on them. The same goes for `config_schema` keys and
  `scene_triggers` keys (`test/manifest.test.js` checks that the triggers are
  exactly the events `src/stove.js` emits).
- **Acks.** Gladys waits 5 s for a command ack; the bridge acknowledges after
  4 s and lets a longer command (mode + set point) go on.
- **The container rootfs is read-only.** Write only under `/data`. Never log
  the PIN code.
- **Versions belong to `npm run release`** (see Releasing). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md`. Never write a version heading.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`.
  `scene_triggers` require `gladys_version >= 5.1.0`.
- **User-facing text** is bilingual (English and French), kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
