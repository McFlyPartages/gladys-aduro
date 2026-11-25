// -----------------------------------------------------------------------------
// Entry point of the Gladys external integration for Aduro hybrid stoves.
//
// This file only wires the SDK to the bridge (src/bridge.js): handlers are
// registered BEFORE connect(), the protocol and the stove logic live in src/.
//
// Environment variables provided by the Gladys supervisor to the container
// (read by the SDK): GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN,
// GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { Bridge } from './src/bridge.js';
import { StoveClient } from './src/client.js';
import { normalizeConfig, sameConnection } from './src/config.js';
import { Store } from './src/store.js';
import { WIDGET, loadImage } from './src/widgets.js';

const gladys = new GladysIntegration();

const bridge = new Bridge(gladys, {
  createClient: (config) => new StoveClient({ serial: config.stove_serial, pin: config.stove_pin }),
  // /data is the only writable volume of the container; DATA_DIR for local runs.
  store: new Store(process.env.DATA_DIR || '/data'),
});

let config = null;

async function applyConfig(raw) {
  const next = normalizeConfig(raw);
  if (config && sameConnection(config, next)) {
    config = next;
    await bridge.update(next);
    return;
  }
  config = next;
  await bridge.start(config);
}

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  if (bridge.devices().length === 0) {
    await bridge.pollOnce();
  }
  await gladys.publishDiscoveredDevices(bridge.devices());
});

// --- Command: the user acts on a controllable feature ------------------------
// A throw is acknowledged to Gladys as a failure, shown in the UI.
gladys.onSetValue(async (device, feature, value) => {
  logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
  await bridge.setValue(feature, value);
});

// --- Dashboard widgets -------------------------------------------------------
gladys.onWidgetGet(WIDGET.STOVE, (options) => bridge.widget(WIDGET.STOVE, options));
gladys.onWidgetGet(WIDGET.STATS, (options) => bridge.widget(WIDGET.STATS, options));
gladys.onWidgetGetImage((key) => loadImage(key));
gladys.onWidgetAction(WIDGET.STOVE, (actionKey) => bridge.widgetAction(actionKey));

// --- Device lifecycle --------------------------------------------------------
// States sent before the user created the device were dropped by Gladys.
gladys.onDeviceCreated(() => bridge.replayStates());
gladys.onDeviceUpdated(() => bridge.replayStates());

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated((newConfig) => applyConfig(newConfig));

// --- Connection lifecycle ----------------------------------------------------
gladys.on('connected', async () => {
  try {
    await applyConfig(await gladys.getConfig());
    await bridge.publishDevice();
    await bridge.replayStates();
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
  }
});

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown(async (signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  await bridge.stop();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the Aduro integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
