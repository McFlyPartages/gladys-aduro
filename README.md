# gladys-aduro

**English** · [Français](README.fr.md)

[Gladys Assistant](https://gladysassistant.com/) external integration for
Aduro hybrid pellet stoves (H1 to H6). Local first: Gladys talks to the stove
with the NBE protocol of the Aduro Hybrid app (UDP 8483). The Aduro cloud
relay is an optional fallback, off by default.

User documentation: [English](docs/en.md) · [Français](docs/fr.md).

It is a JavaScript port of the Home Assistant integration
[NewImproved/Aduro](https://github.com/NewImproved/Aduro) and of
[pyduro](https://github.com/clementprevot/pyduro), see [NOTICE.md](NOTICE.md).

## Features

Start/stop, heat level, target temperature, operation mode (with retries until
the stove applies the change), temperatures, heat output, carbon monoxide,
state texts, consumption, pellets left, automatic stop at low pellets,
automatic return to pellets after wood mode, forced fan and auger, scene
triggers for the alerts, two dashboard widgets (animated stove, statistics),
pellets run-out prediction in heat level mode. The temperature mode prediction
of the Home Assistant integration (heating cycles, weather forecast) is not
ported.

## Try a test build

1. On GitHub, **Actions → Build and publish image → Run workflow** on the
   branch to try. The image is published as
   `ghcr.io/mcflypartages/gladys-aduro:<branch>`.
2. The build summary shows the **manifest to paste**, its `docker_image`
   already pointing at that image.
3. The image must be pullable without credentials: make the package public
   (**Packages → gladys-aduro → Package settings → Change visibility**).
4. In Gladys (5.1.0 or later): **Integrations → Install an integration →
   Developer mode**, paste the manifest.
5. Configure the integration following the [documentation](docs/en.md).

## Development

```bash
npm install
npm test              # node --test, no network
npm run lint
npm run format:check
```

To run against a Gladys instance, create a development integration in Gladys
and start with the variables it gives you:

```bash
GLADYS_HOST_API_URL="http://<gladys>:1443" \
GLADYS_INTEGRATION_TOKEN=... \
GLADYS_INTEGRATION_SELECTOR=... \
DATA_DIR=./data LOG_LEVEL=debug npm start
```

The pictures of the stove widget (`assets/stove-*.webp`, animated WebP) are
drawn by `npm run render` (`scripts/render-stove.mjs`, SVG + sharp, a
development dependency) and committed: bump `ASSETS_VERSION` in
`src/widgets.js` when they change, the core caches them one hour by key.

The serial number, PIN code and IP address of the stove are entered in the
integration configuration screen in Gladys, not in environment variables.

## How it works

| File                | Role                                                              |
| ------------------- | ----------------------------------------------------------------- |
| `src/protocol.js`   | NBE frames: encoding, decoding, discovery replies (pyduro port)   |
| `src/client.js`     | UDP exchanges with the stove, one at a time, with a timeout       |
| `src/readings.js`   | Values at their positions in the replies, state labels            |
| `src/stove.js`      | Reaching the stove, command follow-up, pellets, alerts, wood mode |
| `src/prediction.js` | Learned consumption per heat level, pellets run-out prediction    |
| `src/widgets.js`    | Dashboard widgets: the animated stove and the statistics          |
| `src/device.js`     | The stove as a Gladys device: features, states, commands          |
| `src/bridge.js`     | Poll loop, publications to Gladys, scene events                   |
| `src/store.js`      | Pellet counters and switches persisted under `/data`              |
| `index.js`          | SDK wiring                                                        |

Integration containers run on a bridge network: the broadcast discovery is
emitted by the Gladys core (`network_discovery`, `udp-active-broadcast` on port
8483), every other exchange is unicast UDP from the container.

## License

MIT, see [LICENSE](LICENSE).

## Links

- Source code: [github.com/McFlyPartages/gladys-aduro](https://github.com/McFlyPartages/gladys-aduro)
- Issues and suggestions: [GitHub issues](https://github.com/McFlyPartages/gladys-aduro/issues)
- User documentation: [English](docs/en.md) · [Français](docs/fr.md)
- Gladys Assistant: [gladysassistant.com](https://gladysassistant.com/) ·
  [external integrations](https://gladysassistant.com/fr/docs/dev/external-integrations/)
- Home Assistant integration this one is ported from:
  [NewImproved/Aduro](https://github.com/NewImproved/Aduro)
- NBE protocol library: [clementprevot/pyduro](https://github.com/clementprevot/pyduro)
