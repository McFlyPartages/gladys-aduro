// -----------------------------------------------------------------------------
// The stove as a Gladys device: its features, the states read from a Stove,
// and the commands of its controllable features.
//
// Feature keys are part of the external ids users' dashboards and scenes are
// keyed on: never rename one.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORY,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
} from '@gladysassistant/integration-sdk';
import { OPERATION_MODE } from './readings.js';
import { stateLabel, substateLabel } from './readings.js';
import { predictionText } from './prediction.js';

export const DEVICE_TYPE = 'stove';

export const FEATURE = {
  POWER: 'power',
  HEAT_LEVEL: 'heat-level',
  TARGET_TEMPERATURE: 'target-temperature',
  OPERATION_MODE: 'operation-mode',
  STATE: 'state',
  SUBSTATE: 'substate',
  ROOM_TEMPERATURE: 'room-temperature',
  SMOKE_TEMPERATURE: 'smoke-temperature',
  SHAFT_TEMPERATURE: 'shaft-temperature',
  HEAT_OUTPUT: 'heat-output',
  CARBON_MONOXIDE: 'carbon-monoxide',
  PELLETS_LEVEL: 'pellets-level',
  PELLETS_REMAINING: 'pellets-remaining',
  PELLETS_SINCE_CLEANING: 'pellets-since-cleaning',
  PELLETS_TIME_LEFT: 'pellets-time-left',
  PELLETS_DEPLETION: 'pellets-depletion',
  CONSUMPTION_TODAY: 'consumption-today',
  CONSUMPTION_YESTERDAY: 'consumption-yesterday',
  CONSUMPTION_MONTH: 'consumption-month',
  CONSUMPTION_YEAR: 'consumption-year',
  CONSUMPTION_TOTAL: 'consumption-total',
  OPERATING_TIME: 'operating-time',
  AUGER_TIME: 'auger-time',
  IGNITION_TIME: 'ignition-time',
  AUTO_SHUTDOWN: 'auto-shutdown',
  AUTO_RESUME_WOOD: 'auto-resume-wood',
  FORCE_FAN: 'force-fan',
  FORCE_AUGER: 'force-auger',
  REFILL: 'refill',
  CLEANED: 'cleaned',
  RESUME_WOOD: 'resume-wood',
  RESET_ALARM: 'reset-alarm',
};

const MODE_OPTION = {
  [OPERATION_MODE.HEAT_LEVEL]: 'heat_level',
  [OPERATION_MODE.TEMPERATURE]: 'temperature',
  [OPERATION_MODE.WOOD]: 'wood',
};

const NAMES = {
  [FEATURE.POWER]: { en: 'Power', fr: 'Marche' },
  [FEATURE.HEAT_LEVEL]: { en: 'Heat level', fr: 'Puissance' },
  [FEATURE.TARGET_TEMPERATURE]: { en: 'Target temperature', fr: 'Température de consigne' },
  [FEATURE.OPERATION_MODE]: { en: 'Operation mode', fr: 'Mode de fonctionnement' },
  [FEATURE.STATE]: { en: 'State', fr: 'État' },
  [FEATURE.SUBSTATE]: { en: 'Detail', fr: 'Détail' },
  [FEATURE.ROOM_TEMPERATURE]: { en: 'Room temperature', fr: 'Température ambiante' },
  [FEATURE.SMOKE_TEMPERATURE]: { en: 'Smoke temperature', fr: 'Température des fumées' },
  [FEATURE.SHAFT_TEMPERATURE]: { en: 'Shaft temperature', fr: 'Température du conduit' },
  [FEATURE.HEAT_OUTPUT]: { en: 'Heat output', fr: 'Puissance de chauffe' },
  [FEATURE.CARBON_MONOXIDE]: { en: 'Carbon monoxide', fr: 'Monoxyde de carbone' },
  [FEATURE.PELLETS_LEVEL]: { en: 'Pellets level', fr: 'Niveau de granulés' },
  [FEATURE.PELLETS_REMAINING]: { en: 'Pellets left (kg)', fr: 'Granulés restants (kg)' },
  [FEATURE.PELLETS_SINCE_CLEANING]: {
    en: 'Burnt since cleaning (kg)',
    fr: 'Brûlé depuis le nettoyage (kg)',
  },
  [FEATURE.PELLETS_TIME_LEFT]: { en: 'Pellets time left', fr: 'Autonomie en granulés' },
  [FEATURE.PELLETS_DEPLETION]: { en: 'Pellets run out', fr: 'Fin des granulés prévue' },
  [FEATURE.CONSUMPTION_TODAY]: {
    en: 'Consumption today (kg)',
    fr: "Consommation aujourd'hui (kg)",
  },
  [FEATURE.CONSUMPTION_YESTERDAY]: {
    en: 'Consumption yesterday (kg)',
    fr: 'Consommation hier (kg)',
  },
  [FEATURE.CONSUMPTION_MONTH]: {
    en: 'Consumption this month (kg)',
    fr: 'Consommation du mois (kg)',
  },
  [FEATURE.CONSUMPTION_YEAR]: {
    en: 'Consumption this year (kg)',
    fr: "Consommation de l'année (kg)",
  },
  [FEATURE.CONSUMPTION_TOTAL]: { en: 'Total consumption (kg)', fr: 'Consommation totale (kg)' },
  [FEATURE.OPERATING_TIME]: { en: 'Operating time', fr: 'Temps de fonctionnement' },
  [FEATURE.AUGER_TIME]: { en: 'Auger operating time', fr: 'Temps de fonctionnement de la vis' },
  [FEATURE.IGNITION_TIME]: { en: 'Ignition time', fr: "Temps d'allumage" },
  [FEATURE.AUTO_SHUTDOWN]: { en: 'Stop at low pellets', fr: 'Arrêt si granulés bas' },
  [FEATURE.AUTO_RESUME_WOOD]: { en: 'Resume after wood', fr: 'Reprise après le bois' },
  [FEATURE.FORCE_FAN]: { en: 'Forced fan', fr: 'Ventilateur forcé' },
  [FEATURE.FORCE_AUGER]: { en: 'Forced auger', fr: 'Vis sans fin forcée' },
  [FEATURE.REFILL]: { en: 'Pellets refilled', fr: 'Granulés rechargés' },
  [FEATURE.CLEANED]: { en: 'Stove cleaned', fr: 'Poêle nettoyé' },
  [FEATURE.RESUME_WOOD]: { en: 'Resume pellets after wood', fr: 'Reprendre les granulés' },
  [FEATURE.RESET_ALARM]: { en: 'Reset alarm', fr: "Réarmer l'alarme" },
};

const MODE_LABELS = {
  heat_level: { en: 'Heat level', fr: 'Puissance' },
  temperature: { en: 'Temperature', fr: 'Température' },
  wood: { en: 'Wood', fr: 'Bois' },
};

const BASE = { has_feedback: false, keep_history: false };

const sensor = (category, type, extra = {}) => ({
  category,
  type,
  read_only: true,
  ...BASE,
  keep_history: true,
  ...extra,
});
const control = (category, type, extra = {}) => ({
  category,
  type,
  read_only: false,
  ...BASE,
  has_feedback: true,
  ...extra,
});
const kilograms = () =>
  sensor(CATEGORY.COUNTER_SENSOR, TYPE.SENSOR.DECIMAL, { min: 0, max: 100000 });
const hours = () =>
  sensor(CATEGORY.DURATION, TYPE.DURATION.DECIMAL, { unit: UNIT.HOURS, min: 0, max: 1000000 });
const binarySwitch = () => control(CATEGORY.SWITCH, TYPE.SWITCH.BINARY, { min: 0, max: 1 });
const button = () => ({
  category: CATEGORY.BUTTON,
  type: TYPE.BUTTON.PUSH,
  read_only: false,
  ...BASE,
  min: 0,
  max: 1,
});

function featureDefinitions(language) {
  return {
    [FEATURE.POWER]: binarySwitch(),
    [FEATURE.HEAT_LEVEL]: control(CATEGORY.TEXT, TYPE.TEXT.SELECT, {
      min: 0,
      max: 0,
      supported_options: [
        { value: '1', label: 'I', sort_order: 0 },
        { value: '2', label: 'II', sort_order: 1 },
        { value: '3', label: 'III', sort_order: 2 },
      ],
    }),
    [FEATURE.TARGET_TEMPERATURE]: control(CATEGORY.THERMOSTAT, TYPE.THERMOSTAT.TARGET_TEMPERATURE, {
      unit: UNIT.CELSIUS,
      min: 5,
      max: 35,
      step: 1,
      keep_history: true,
    }),
    [FEATURE.OPERATION_MODE]: control(CATEGORY.TEXT, TYPE.TEXT.SELECT, {
      min: 0,
      max: 0,
      supported_options: Object.entries(MODE_LABELS).map(([value, labels], index) => ({
        value,
        label: labels[language] ?? labels.en,
        sort_order: index,
      })),
    }),
    [FEATURE.STATE]: sensor(CATEGORY.TEXT, TYPE.TEXT.TEXT, { min: 0, max: 0, keep_history: false }),
    [FEATURE.SUBSTATE]: sensor(CATEGORY.TEXT, TYPE.TEXT.TEXT, {
      min: 0,
      max: 0,
      keep_history: false,
    }),
    [FEATURE.ROOM_TEMPERATURE]: sensor(CATEGORY.TEMPERATURE_SENSOR, TYPE.SENSOR.DECIMAL, {
      unit: UNIT.CELSIUS,
      min: -20,
      max: 60,
    }),
    // "probe": not the air of the room, kept out of the room average.
    [FEATURE.SMOKE_TEMPERATURE]: sensor(
      CATEGORY.TEMPERATURE_SENSOR,
      TYPE.TEMPERATURE_SENSOR.PROBE,
      {
        unit: UNIT.CELSIUS,
        min: 0,
        max: 1000,
      },
    ),
    [FEATURE.SHAFT_TEMPERATURE]: sensor(
      CATEGORY.TEMPERATURE_SENSOR,
      TYPE.TEMPERATURE_SENSOR.PROBE,
      {
        unit: UNIT.CELSIUS,
        min: 0,
        max: 1000,
      },
    ),
    [FEATURE.HEAT_OUTPUT]: sensor(CATEGORY.ENERGY_SENSOR, TYPE.ENERGY_SENSOR.POWER, {
      unit: UNIT.KILOWATT,
      min: 0,
      max: 20,
    }),
    [FEATURE.CARBON_MONOXIDE]: sensor(CATEGORY.CO_SENSOR, TYPE.SENSOR.INTEGER, {
      unit: UNIT.PPM,
      min: 0,
      max: 10000,
    }),
    [FEATURE.PELLETS_LEVEL]: sensor(CATEGORY.LEVEL_SENSOR, TYPE.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT, {
      unit: UNIT.PERCENT,
      min: 0,
      max: 100,
    }),
    [FEATURE.PELLETS_REMAINING]: kilograms(),
    [FEATURE.PELLETS_SINCE_CLEANING]: kilograms(),
    [FEATURE.PELLETS_TIME_LEFT]: hours(),
    [FEATURE.PELLETS_DEPLETION]: sensor(CATEGORY.TEXT, TYPE.TEXT.TEXT, {
      min: 0,
      max: 0,
      keep_history: false,
    }),
    [FEATURE.CONSUMPTION_TODAY]: kilograms(),
    [FEATURE.CONSUMPTION_YESTERDAY]: kilograms(),
    [FEATURE.CONSUMPTION_MONTH]: kilograms(),
    [FEATURE.CONSUMPTION_YEAR]: kilograms(),
    [FEATURE.CONSUMPTION_TOTAL]: kilograms(),
    [FEATURE.OPERATING_TIME]: hours(),
    [FEATURE.AUGER_TIME]: hours(),
    [FEATURE.IGNITION_TIME]: hours(),
    [FEATURE.AUTO_SHUTDOWN]: binarySwitch(),
    [FEATURE.AUTO_RESUME_WOOD]: binarySwitch(),
    [FEATURE.FORCE_FAN]: binarySwitch(),
    [FEATURE.FORCE_AUGER]: binarySwitch(),
    [FEATURE.REFILL]: button(),
    [FEATURE.CLEANED]: button(),
    [FEATURE.RESUME_WOOD]: button(),
    [FEATURE.RESET_ALARM]: button(),
  };
}

/**
 * The Gladys device of the stove.
 * @param {object} gladys SDK instance (only `externalIds` is used)
 * @param {object} stove a Stove
 * @param {object} config normalized configuration
 */
export function buildDevice(gladys, stove, config) {
  const ids = gladys.externalIds(DEVICE_TYPE, config.stove_serial);
  const language = config.language;
  const features = Object.entries(featureDefinitions(language)).map(([key, feature]) => ({
    name: NAMES[key][language] ?? NAMES[key].en,
    external_id: ids.feature(key),
    ...feature,
  }));
  const params = [];
  const network = stove.data.network;
  if (stove.transport !== 'unreachable' && stove.host) {
    params.push({ name: 'HOST', value: stove.host });
  }
  if (network?.mac) {
    params.push({ name: 'MAC_ADDRESS', value: network.mac });
  }
  if (network?.ssid) {
    params.push({ name: 'WIFI_NETWORK', value: network.ssid });
  }
  if (stove.firmware?.version) {
    const { version, build } = stove.firmware;
    params.push({ name: 'FIRMWARE', value: build ? `${version}.${build}` : version });
  }
  return {
    name: `Aduro ${config.stove_model}`,
    external_id: ids.device,
    model: config.stove_model,
    features,
    params,
  };
}

const hoursOf = (seconds) => Math.round((seconds / 3600) * 10) / 10;

/** Current states of every feature the stove has values for. */
export function buildStates(gladys, stove, config) {
  const ids = gladys.externalIds(DEVICE_TYPE, config.stove_serial);
  const language = config.language;
  const values = [];
  const put = (key, state) => {
    if (state === undefined || state === null || Number.isNaN(state)) {
      return;
    }
    values.push({
      device_feature_external_id: ids.feature(key),
      ...(typeof state === 'string' ? { text: state } : { state }),
    });
  };
  const bool = (value) => (value ? 1 : 0);

  const { operating, status, consumption } = stove.data;
  if (operating && status) {
    put(FEATURE.POWER, bool(stove.running));
    put(FEATURE.HEAT_LEVEL, String(operating.heat_level));
    put(FEATURE.TARGET_TEMPERATURE, operating.boiler_ref);
    put(FEATURE.OPERATION_MODE, MODE_OPTION[status.operation_mode]);
    put(FEATURE.STATE, stateLabel(operating.state, operating.heat_level, language));
    put(
      FEATURE.SUBSTATE,
      substateLabel(
        operating.state,
        operating.substate,
        language,
        stove.timerFor(operating.state, operating.substate),
      ),
    );
    put(FEATURE.ROOM_TEMPERATURE, operating.boiler_temp);
    put(FEATURE.SMOKE_TEMPERATURE, operating.smoke_temp);
    put(FEATURE.SHAFT_TEMPERATURE, operating.shaft_temp);
    put(FEATURE.HEAT_OUTPUT, operating.power_kw);
    put(FEATURE.CARBON_MONOXIDE, Math.round(operating.carbon_monoxide));
    put(FEATURE.CONSUMPTION_TOTAL, status.consumption_total);
    put(FEATURE.OPERATING_TIME, hoursOf(operating.operating_time_stove));
    put(FEATURE.AUGER_TIME, hoursOf(operating.operating_time_auger));
    put(FEATURE.IGNITION_TIME, hoursOf(operating.operating_time_ignition));
  }
  if (consumption) {
    put(FEATURE.CONSUMPTION_TODAY, consumption.day);
    put(FEATURE.CONSUMPTION_YESTERDAY, consumption.yesterday);
    put(FEATURE.CONSUMPTION_MONTH, consumption.month);
    put(FEATURE.CONSUMPTION_YEAR, consumption.year);
  }
  const pellets = stove.pellets();
  put(FEATURE.PELLETS_LEVEL, pellets.percentage);
  put(FEATURE.PELLETS_REMAINING, pellets.amount);
  put(FEATURE.PELLETS_SINCE_CLEANING, pellets.consumed_total);
  const prediction = stove.prediction();
  if (prediction) {
    put(FEATURE.PELLETS_TIME_LEFT, prediction.hours);
    put(FEATURE.PELLETS_DEPLETION, predictionText(prediction, language, operating.heat_level));
  }
  put(FEATURE.AUTO_SHUTDOWN, bool(stove.saved.auto_shutdown));
  put(FEATURE.AUTO_RESUME_WOOD, bool(stove.saved.auto_resume_wood));
  put(FEATURE.FORCE_FAN, bool(stove.forced.fan.active));
  put(FEATURE.FORCE_AUGER, bool(stove.forced.auger.active));
  return values;
}

const MODE_VALUES = Object.fromEntries(
  Object.entries(MODE_OPTION).map(([mode, option]) => [option, Number(mode)]),
);

/**
 * Run the command of a controllable feature.
 * @returns {Promise<boolean>} false when the feature is not ours
 */
export async function runCommand(gladys, stove, config, featureExternalId, value) {
  const ids = gladys.externalIds(DEVICE_TYPE, config.stove_serial);
  const key = Object.values(FEATURE).find(
    (candidate) => ids.feature(candidate) === featureExternalId,
  );
  const on = Number(value) === 1;
  switch (key) {
    case FEATURE.POWER:
      await (on ? stove.start() : stove.stop());
      return true;
    case FEATURE.HEAT_LEVEL:
      await stove.setHeatLevel(Number(value));
      return true;
    case FEATURE.TARGET_TEMPERATURE:
      await stove.setTemperature(Number(value));
      return true;
    case FEATURE.OPERATION_MODE:
      if (!(value in MODE_VALUES)) {
        throw new Error(`Unknown operation mode "${value}"`);
      }
      await stove.setOperationMode(MODE_VALUES[value]);
      return true;
    case FEATURE.AUTO_SHUTDOWN:
      await stove.setAutoShutdown(on);
      return true;
    case FEATURE.AUTO_RESUME_WOOD:
      await stove.setAutoResumeWood(on);
      return true;
    case FEATURE.FORCE_FAN:
      await (on ? stove.startForced('fan') : stove.stopForced('fan'));
      return true;
    case FEATURE.FORCE_AUGER:
      await (on ? stove.startForced('auger') : stove.stopForced('auger'));
      return true;
    case FEATURE.REFILL:
      stove.refillPellets();
      return true;
    case FEATURE.CLEANED:
      stove.cleaned();
      return true;
    case FEATURE.RESUME_WOOD:
      await stove.resumeAfterWood();
      return true;
    case FEATURE.RESET_ALARM:
      await stove.resetAlarm();
      return true;
    default:
      return false;
  }
}
