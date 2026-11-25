// -----------------------------------------------------------------------------
// Decoding of the stove replies into plain readings, and the labels of its
// states.
//
// The positions and the label tables come from the Home Assistant
// integration this one is ported from (https://github.com/NewImproved/Aduro,
// MIT, Copyright (c) 2024 NewImproved) and from pyduro's STATUS_PARAMS.
// Pure functions: no socket, no clock except the `today` argument.
// -----------------------------------------------------------------------------

// Order of the values returned by function 11 with the "*" payload. Only the
// positions read below matter; the full list is in pyduro.
export const STATUS_INDEX = {
  consumption_total: 92,
  fixed_power: 99,
  operation_mode: 100,
};

export const OPERATION_MODE = { HEAT_LEVEL: 0, TEMPERATURE: 1, WOOD: 2 };

// Heat level <-> `regulation.fixed_power` (%).
export const HEAT_LEVEL_POWER = { 1: 10, 2: 50, 3: 100 };

// The stove reports its power as an approximate percentage.
export function heatLevelFromPower(percent) {
  if (percent <= 30) {
    return 1;
  }
  if (percent <= 75) {
    return 2;
  }
  return 3;
}

const number = (text) => {
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value : 0;
};

const fields = (payload) => String(payload ?? '').split(',');

/** Function 11, payload "*". */
export function parseStatus(payload) {
  const values = fields(payload);
  return {
    consumption_total: number(values[STATUS_INDEX.consumption_total]),
    operation_mode: Math.trunc(number(values[STATUS_INDEX.operation_mode])),
  };
}

/** Function 11, payload "001*". */
export function parseOperating(payload) {
  const values = fields(payload);
  if (values.length < 122) {
    throw new Error(`Operating data too short (${values.length} values)`);
  }
  // Position 99 is the power percentage on current firmwares (36 on older
  // ones, which the Home Assistant integration stopped reading).
  const powerPercent = values[104] ? number(values[99]) : 0;
  return {
    boiler_temp: number(values[0]),
    boiler_ref: number(values[1]),
    state: values[6],
    substate: values[5],
    power_kw: number(values[31]),
    power_pct: powerPercent,
    heat_level: heatLevelFromPower(Math.trunc(powerPercent)),
    shaft_temp: number(values[35]),
    smoke_temp: number(values[37]),
    carbon_monoxide: number(values[26]),
    carbon_monoxide_yellow: number(values[101]),
    carbon_monoxide_red: number(values[102]),
    operating_time_auger: Math.trunc(number(values[119])),
    operating_time_ignition: Math.trunc(number(values[120])),
    operating_time_stove: Math.trunc(number(values[121])),
  };
}

/** Function 1, payload "wifi.router". */
export function parseNetwork(payload) {
  const values = fields(payload);
  return {
    // First value is "router=<ssid>"-like: the SSID starts at character 7.
    ssid: (values[0] ?? '').slice(7),
    ip: values[4] ?? '',
    router_ip: values[5] ?? '',
    rssi: values[6] === undefined || values[6] === '' ? null : number(values[6]),
    mac: values[9] ?? '',
  };
}

// Each consumption table starts with its own name and "=".
function table(payload, name) {
  const text = String(payload ?? '');
  const prefix = `${name}=`;
  return fields(text.startsWith(prefix) ? text.slice(prefix.length) : text).map(number);
}

/**
 * Function 6 tables: one value per day of the current month ("total_days"),
 * per month of the calendar year ("total_months").
 * @param {{ days: string, months: string }} payloads
 * @param {Date} today
 */
export function parseConsumption({ days, months }, today) {
  const perDay = table(days, 'total_days');
  const perMonth = table(months, 'total_months');
  const day = today.getDate();
  const yesterday = new Date(today);
  yesterday.setDate(day - 1);
  const month = today.getMonth();
  // Months after the current one still hold last year's values: the year to
  // date only sums January to now. 0.002 is the stove's "empty" value.
  let year = 0;
  for (let index = 0; index <= month && index < perMonth.length; index += 1) {
    if (perMonth[index] > 0.002) {
      year += perMonth[index];
    }
  }
  return {
    day: perDay[day - 1] ?? 0,
    yesterday: perDay[yesterday.getDate() - 1] ?? 0,
    month: perMonth[month] ?? 0,
    year: Math.round(year * 1000) / 1000,
  };
}

// States in which the stove is burning or about to.
export const RUNNING_STATES = new Set(['0', '2', '4', '5', '6', '9', '24', '32']);
// States in which it stopped, by the user or by itself.
export const STOPPED_STATES = new Set([
  '11',
  '13',
  '14',
  '15',
  '17',
  '18',
  '19',
  '20',
  '23',
  '28',
  '33',
  '34',
  '35',
]);
export const WOOD_STATE = '9';

const ROMAN = { 1: 'I', 2: 'II', 3: 'III' };

const STATE_KEYS = {
  0: 'operating',
  2: 'operating_startup',
  4: 'operating_startup',
  5: 'operating',
  6: 'stopped',
  9: 'stopped',
  11: 'stopped_draft',
  13: 'stopped',
  14: 'off',
  15: 'stopped_smoke_sensor',
  17: 'stopped_dropshaft',
  18: 'stopped_burner_yellow',
  19: 'stopped_auger',
  20: 'stopped',
  23: 'stopped_timer',
  24: 'operating_air_damper',
  28: 'stopped',
  32: 'operating_iii',
  33: 'stopped_co_sensor',
  34: 'stopped',
  35: 'stopped_no_fan',
};

const STATE_LABELS = {
  operating: { en: 'Power {level}', fr: 'Puissance {level}' },
  operating_startup: { en: 'Power', fr: 'Puissance' },
  stopped: { en: 'Stopped', fr: 'Arrêté' },
  off: { en: 'Off', fr: 'Éteint' },
  operating_iii: { en: 'Power III', fr: 'Puissance III' },
  stopped_draft: { en: 'Drop shaft hot', fr: "Conduit d'alimentation chaud" },
  stopped_smoke_sensor: { en: 'Bad smoke sensor', fr: 'Capteur de fumée défectueux' },
  stopped_dropshaft: {
    en: 'Bad drop shaft sensor',
    fr: "Capteur du conduit d'alimentation défectueux",
  },
  stopped_burner_yellow: {
    en: 'Check burner (yellow light)',
    fr: 'Contrôlez le brûleur (voyant jaune)',
  },
  stopped_auger: { en: 'Bad external auger output', fr: 'Sortie de vis sans fin défectueuse' },
  stopped_timer: { en: 'Stopped by timer', fr: 'Arrêté par la minuterie' },
  operating_air_damper: { en: 'Air damper closed', fr: "Clapet d'air fermé" },
  stopped_co_sensor: { en: 'CO sensor defect', fr: 'Capteur de CO défectueux' },
  stopped_no_fan: {
    en: 'No power consumption for the fan',
    fr: 'Aucune consommation électrique du ventilateur',
  },
  unknown: { en: 'Unknown state ({code})', fr: 'État inconnu ({code})' },
};

// Substates are keyed by the main state, except state 14 which depends on
// the substate.
const SUBSTATE_KEYS = {
  0: 'waiting',
  2: 'ignition_1',
  4: 'ignition_2',
  5: 'normal',
  6: 'temp_reached',
  9: 'wood_burning',
  11: 'dropshaft_hot',
  13: 'failed_ignition',
  '14_0': 'by_button',
  '14_1': 'wood_burning_question',
  20: 'no_fuel',
  28: 'door_open',
  32: 'heating_up',
  34: 'check_burn_cup',
};

const SUBSTATE_LABELS = {
  waiting: { en: 'Waiting', fr: 'Attente' },
  ignition_1: { en: 'Ignition', fr: 'Allumage' },
  ignition_2: { en: 'Ignition 2', fr: 'Allumage 2' },
  normal: { en: 'Normal', fr: 'Normal' },
  temp_reached: { en: 'Room temperature reached', fr: 'Température ambiante atteinte' },
  wood_burning: { en: 'Wood burning', fr: 'Combustion du bois' },
  dropshaft_hot: { en: 'Drop shaft hot', fr: "Conduit d'alimentation chaud" },
  failed_ignition: {
    en: 'Failed ignition: open the door and check the burner for pellets',
    fr: "Échec d'allumage : ouvrez la porte et vérifiez les granulés dans le brûleur",
  },
  by_button: { en: 'By button', fr: 'Par le bouton' },
  wood_burning_question: { en: 'Wood burning?', fr: 'Combustion du bois ?' },
  no_fuel: { en: 'No fuel', fr: 'Plus de combustible' },
  door_open: { en: 'Door open', fr: 'Porte ouverte' },
  heating_up: { en: 'Heating up', fr: 'Montée en température' },
  check_burn_cup: { en: 'Check the burn cup', fr: 'Vérifiez le creuset' },
  unknown: { en: 'Unknown ({code})', fr: 'Inconnu ({code})' },
};

const pick = (labels, language) => labels[language] ?? labels.en;

/** Human label of the main state, in `language` ('en' or 'fr'). */
export function stateLabel(state, heatLevel, language = 'en') {
  const key = STATE_KEYS[state];
  if (!key) {
    return pick(STATE_LABELS.unknown, language).replace('{code}', String(state));
  }
  return pick(STATE_LABELS[key], language).replace('{level}', ROMAN[heatLevel] ?? '');
}

/** Human label of the substate, `remaining` seconds appended to the timers. */
export function substateLabel(state, substate, language = 'en', remaining = 0) {
  const key = SUBSTATE_KEYS[`${state}_${substate}`] ?? SUBSTATE_KEYS[state];
  const text = key
    ? pick(SUBSTATE_LABELS[key], language)
    : pick(SUBSTATE_LABELS.unknown, language).replace('{code}', `${state}/${substate}`);
  if (remaining > 0) {
    const minutes = String(Math.floor(remaining / 60)).padStart(2, '0');
    const seconds = String(remaining % 60).padStart(2, '0');
    return `${text} (${minutes}:${seconds})`;
  }
  return text;
}
