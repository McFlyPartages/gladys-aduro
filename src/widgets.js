// -----------------------------------------------------------------------------
// Dashboard widgets, in the core's declarative vocabulary (no HTML):
//
//   "stove": the drawing of the stove, its fire animated at the current level
//            (logs in wood mode), the fire and room temperatures, the state,
//            and four buttons: on/off and small / medium / large flame;
//   "stats": pellets, consumption chart, learned consumption, run-out
//            prediction, operating times, carbon monoxide.
//
// The pictures are animated WebP files rendered once by
// scripts/render-stove.mjs and shipped in assets/. Budget of a content (the
// core drops the rest): 8 components, 1 focal, 6 tiles, 1 status, 4 buttons.
// -----------------------------------------------------------------------------

import { readFile } from 'node:fs/promises';
import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { DEVICE_TYPE, FEATURE } from './device.js';
import { predictionText } from './prediction.js';
import {
  OPERATION_MODE,
  RUNNING_STATES,
  WOOD_STATE,
  stateLabel,
  substateLabel,
} from './readings.js';
import { FAULT_STATES } from './stove.js';

export const WIDGET = { STOVE: 'stove', STATS: 'stats' };

// Bumped whenever the pictures change: the core caches an image one hour by key.
const ASSETS_VERSION = 1;
const PICTURES = ['off', 'l1', 'l2', 'l3', 'wood'];

export const IMAGE_KEYS = Object.fromEntries(
  PICTURES.map((name) => [`stove-${name}-v${ASSETS_VERSION}`, `stove-${name}.webp`]),
);

const ASSETS = new URL('../assets/', import.meta.url);

/** Raw base64 of a widget picture (onWidgetGetImage). */
export async function loadImage(key) {
  const file = IMAGE_KEYS[key];
  if (!file) {
    throw new Error(`Unknown image ${key}`);
  }
  return (await readFile(new URL(file, ASSETS))).toString('base64');
}

/** Which picture shows the stove as it is now. */
export function pictureOf(operating) {
  if (!operating) {
    return 'off';
  }
  if (operating.state === WOOD_STATE) {
    return 'wood';
  }
  if (!RUNNING_STATES.has(operating.state)) {
    return 'off';
  }
  // Ignition: a small flame whatever the level asked.
  if (operating.state === '2' || operating.state === '4') {
    return 'l1';
  }
  return `l${operating.heat_level}`;
}

const T = {
  stoveAlt: { en: 'The stove', fr: 'Le poêle' },
  fire: { en: 'Fire', fr: 'Foyer' },
  room: { en: 'Room', fr: 'Ambiante' },
  state: { en: 'State', fr: 'État' },
  detail: { en: 'Detail', fr: 'Détail' },
  mode: { en: 'Mode', fr: 'Mode' },
  target: { en: 'Target', fr: 'Consigne' },
  start: { en: 'Start', fr: 'Allumer' },
  stop: { en: 'Stop', fr: 'Éteindre' },
  small: { en: 'Small flame', fr: 'Petite flamme' },
  medium: { en: 'Medium flame', fr: 'Flamme moyenne' },
  large: { en: 'Large flame', fr: 'Grande flamme' },
  unreachable: { en: 'The stove does not answer.', fr: 'Le poêle ne répond pas.' },
  modes: {
    [OPERATION_MODE.HEAT_LEVEL]: { en: 'Heat level', fr: 'Puissance' },
    [OPERATION_MODE.TEMPERATURE]: { en: 'Temperature', fr: 'Température' },
    [OPERATION_MODE.WOOD]: { en: 'Wood', fr: 'Bois' },
  },
  pellets: { en: 'Pellets', fr: 'Granulés' },
  timeLeft: { en: 'Time left', fr: 'Autonomie' },
  today: { en: 'Today', fr: "Aujourd'hui" },
  month: { en: 'This month', fr: 'Ce mois' },
  year: { en: 'This year', fr: 'Cette année' },
  output: { en: 'Output', fr: 'Puissance' },
  perDay: { en: 'Pellets burnt per day', fr: 'Granulés brûlés par jour' },
  perMonth: { en: 'Pellets burnt per month', fr: 'Granulés brûlés par mois' },
  runOut: { en: 'Run out', fr: 'Fin des granulés' },
  smoke: { en: 'Smoke / shaft', fr: 'Fumées / conduit' },
  co: { en: 'Carbon monoxide', fr: 'Monoxyde de carbone' },
  hours: { en: 'Operating time', fr: 'Fonctionnement' },
  augerIgnition: { en: 'Auger / ignition', fr: 'Vis / allumage' },
  ignitions: { en: 'Ignitions learned', fr: 'Allumages appris' },
  rates: { en: 'Learned kg/h', fr: 'kg/h appris' },
  sinceCleaning: { en: 'Since cleaning', fr: 'Depuis nettoyage' },
  total: { en: 'Total burnt', fr: 'Total brûlé' },
  noData: { en: 'No consumption read yet.', fr: 'Aucune consommation lue pour le moment.' },
};

const pick = (texts, language) => texts[language] ?? texts.en;
const number = (value, digits, language) =>
  new Intl.NumberFormat(language === 'fr' ? 'fr-FR' : 'en-GB', {
    maximumFractionDigits: digits,
  }).format(value);

function stateColor(state) {
  if (FAULT_STATES.has(state)) {
    return WIDGET_COLORS.DANGER;
  }
  if (state === WOOD_STATE || RUNNING_STATES.has(state)) {
    return WIDGET_COLORS.SUCCESS;
  }
  return WIDGET_COLORS.NEUTRAL;
}

/**
 * The "stove" widget.
 * @param {object} gladys SDK instance (only `externalIds` is used)
 * @param {object|null} stove a Stove, null when not configured
 * @param {object} config normalized configuration
 * @param {string} language user language, from the core
 */
export function stoveWidget(gladys, stove, config, language) {
  const operating = stove?.data.operating;
  const status = stove?.data.status;
  if (!operating || !status) {
    return {
      ttl_seconds: 30,
      components: [
        { type: 'image', key: `stove-off-v${ASSETS_VERSION}`, alt: pick(T.stoveAlt, language) },
        { type: 'text', text: pick(T.unreachable, language), variant: 'caption' },
      ],
    };
  }
  const ids = gladys.externalIds(DEVICE_TYPE, config.stove_serial);
  const running = RUNNING_STATES.has(operating.state);
  const level = status.operation_mode === OPERATION_MODE.HEAT_LEVEL ? operating.heat_level : null;
  const flame = (value, label) => ({
    type: 'button',
    label: pick(label, language),
    icon: 'sun',
    style: running && level === value ? 'primary' : 'secondary',
    // Action keys must be unique within a content.
    action: { key: `level_${value}` },
  });
  const statusItems = [
    {
      label: pick(T.state, language),
      value: stateLabel(operating.state, operating.heat_level, language),
      color: stateColor(operating.state),
    },
    {
      label: pick(T.detail, language),
      value: substateLabel(
        operating.state,
        operating.substate,
        language,
        stove.timerFor(operating.state, operating.substate),
      ),
    },
    {
      label: pick(T.mode, language),
      value: pick(T.modes[status.operation_mode] ?? T.modes[0], language),
    },
  ];
  if (status.operation_mode === OPERATION_MODE.TEMPERATURE) {
    statusItems.push({
      label: pick(T.target, language),
      value: `${number(operating.boiler_ref, 1, language)} °C`,
    });
  }
  return {
    ttl_seconds: 30,
    components: [
      {
        type: 'image',
        key: `stove-${pictureOf(operating)}-v${ASSETS_VERSION}`,
        alt: pick(T.stoveAlt, language),
        fit: 'cover',
      },
      {
        type: 'value',
        label: pick(T.fire, language),
        icon: 'thermometer',
        device_feature: ids.feature(FEATURE.SMOKE_TEMPERATURE),
      },
      {
        type: 'value',
        label: pick(T.room, language),
        icon: 'home',
        device_feature: ids.feature(FEATURE.ROOM_TEMPERATURE),
      },
      { type: 'status', items: statusItems },
      running
        ? {
            type: 'button',
            label: pick(T.stop, language),
            icon: 'power',
            style: 'danger',
            action: { key: 'power', params: { on: 0 }, confirm: true },
          }
        : {
            type: 'button',
            label: pick(T.start, language),
            icon: 'power',
            style: 'primary',
            action: { key: 'power', params: { on: 1 } },
          },
      flame(1, T.small),
      flame(2, T.medium),
      flame(3, T.large),
    ],
  };
}

/** Run a button of the "stove" widget; resolves the toast message. */
export async function runStoveAction(stove, actionKey, params) {
  if (!stove) {
    throw new Error('The stove is not configured');
  }
  if (actionKey === 'power') {
    if (Number(params?.on) === 1) {
      await stove.start();
      return { en: 'Starting the stove', fr: 'Allumage du poêle' };
    }
    await stove.stop();
    return { en: 'Stopping the stove', fr: 'Arrêt du poêle' };
  }
  const levelKey = /^level_([123])$/.exec(actionKey);
  if (levelKey) {
    const level = Number(levelKey[1]);
    await stove.setHeatLevel(level);
    const roman = { 1: 'I', 2: 'II', 3: 'III' }[level];
    return { en: `Heat level ${roman}`, fr: `Puissance ${roman}` };
  }
  throw new Error(`Unknown action ${actionKey}`);
}

// The stove's "empty" value.
const kilos = (value) => (value > 0.002 ? Math.round(value * 1000) / 1000 : 0);
const iso = (year, month, day) =>
  `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/**
 * Points of the consumption chart. The stove keeps one table of the days of
 * the month and one of the months of the year: the entries after today still
 * hold the previous month's (year's) values.
 * @param {{ per_day: number[], per_month: number[] }} consumption
 * @param {Date} today
 * @param {'days' | 'months'} period
 */
export function consumptionPoints(consumption, today, period) {
  const year = today.getFullYear();
  const month = today.getMonth();
  const points = [];
  if (period === 'months') {
    for (let index = 0; index < 12; index += 1) {
      const value = consumption.per_month?.[index];
      if (value === undefined) {
        continue;
      }
      const pointYear = index <= month ? year : year - 1;
      points.push({ t: iso(pointYear, index, 1), v: kilos(value) });
    }
  } else {
    const day = today.getDate();
    const previousMonthDays = new Date(year, month, 0).getDate();
    for (let index = 0; index < 31; index += 1) {
      const value = consumption.per_day?.[index];
      const dayOfMonth = index + 1;
      if (value === undefined) {
        continue;
      }
      if (dayOfMonth <= day) {
        points.push({ t: iso(year, month, dayOfMonth), v: kilos(value) });
      } else if (dayOfMonth <= previousMonthDays) {
        const previous = new Date(year, month - 1, 1);
        points.push({
          t: iso(previous.getFullYear(), previous.getMonth(), dayOfMonth),
          v: kilos(value),
        });
      }
    }
  }
  return points.sort((a, b) => a.t.localeCompare(b.t));
}

/**
 * The "stats" widget.
 * @param {{ period?: string }} settings widget instance settings
 */
export function statsWidget(gladys, stove, config, language, settings = {}, now = Date.now()) {
  const operating = stove?.data.operating;
  const status = stove?.data.status;
  if (!operating || !status) {
    return {
      ttl_seconds: 60,
      components: [{ type: 'text', text: pick(T.unreachable, language), variant: 'body' }],
    };
  }
  const ids = gladys.externalIds(DEVICE_TYPE, config.stove_serial);
  const feature = (key) => ids.feature(key);
  const period = settings.period === 'months' ? 'months' : 'days';
  const consumption = stove.data.consumption;
  const pellets = stove.pellets();
  const prediction = stove.prediction();
  const learning = stove.learner.data;
  const kg = (value, digits = 1) => `${number(value, digits, language)} kg`;
  const hours = (seconds) => `${number(seconds / 3600, 0, language)} h`;

  const rates = [1, 2, 3]
    .map((level) => {
      const rate = stove.learner.rate(level);
      return `${['I', 'II', 'III'][level - 1]} ${rate === null ? '–' : number(rate, 2, language)}`;
    })
    .join(' · ');
  const startup = learning.startup;
  const co = operating.carbon_monoxide;
  const coColor =
    operating.carbon_monoxide_red > 0 && co >= operating.carbon_monoxide_red
      ? WIDGET_COLORS.DANGER
      : operating.carbon_monoxide_yellow > 0 && co >= operating.carbon_monoxide_yellow
        ? WIDGET_COLORS.WARNING
        : WIDGET_COLORS.SUCCESS;

  const components = [
    {
      type: 'gauge',
      label: pick(T.pellets, language),
      device_feature: feature(FEATURE.PELLETS_LEVEL),
      color:
        pellets.percentage <= config.low_pellet_level
          ? WIDGET_COLORS.WARNING
          : WIDGET_COLORS.SUCCESS,
    },
    {
      type: 'value',
      label: pick(T.timeLeft, language),
      icon: 'clock',
      ...(prediction?.status === 'ok' || prediction?.status === 'empty'
        ? { value: Math.round(prediction.hours), unit: 'h' }
        : { value: '–' }),
    },
    {
      type: 'value',
      label: pick(T.today, language),
      icon: 'calendar',
      value: consumption ? Math.round(consumption.day * 10) / 10 : '–',
      unit: 'kg',
    },
    {
      type: 'value',
      label: pick(T.month, language),
      icon: 'calendar',
      value: consumption ? Math.round(consumption.month * 10) / 10 : '–',
      unit: 'kg',
    },
    {
      type: 'value',
      label: pick(T.year, language),
      icon: 'calendar',
      value: consumption ? Math.round(consumption.year) : '–',
      unit: 'kg',
    },
    {
      type: 'value',
      label: pick(T.output, language),
      icon: 'zap',
      device_feature: feature(FEATURE.HEAT_OUTPUT),
    },
  ];

  if (consumption?.per_day) {
    components.push({
      type: 'chart',
      chart_type: 'bar',
      title: pick(period === 'months' ? T.perMonth : T.perDay, language),
      unit: 'kg',
      series: [
        {
          name: pick(T.pellets, language),
          points: consumptionPoints(consumption, new Date(now), period),
        },
      ],
    });
  } else {
    components.push({ type: 'text', text: pick(T.noData, language), variant: 'caption' });
  }

  components.push({
    type: 'status',
    items: [
      {
        label: pick(T.runOut, language),
        value: prediction
          ? predictionText(prediction, language, operating.heat_level, undefined, { short: true })
          : '–',
        icon: 'clock',
      },
      {
        label: pick(T.smoke, language),
        value: `${number(operating.smoke_temp, 0, language)} / ${number(operating.shaft_temp, 0, language)} °C`,
        icon: 'thermometer',
      },
      { label: pick(T.co, language), value: `${number(co, 0, language)} ppm`, color: coColor },
      {
        label: pick(T.hours, language),
        value: hours(operating.operating_time_stove),
        icon: 'activity',
      },
      {
        label: pick(T.augerIgnition, language),
        value: `${hours(operating.operating_time_auger)} / ${hours(operating.operating_time_ignition)}`,
      },
      {
        label: pick(T.ignitions, language),
        value: `${startup.count} · ${kg(stove.learner.startupKg, 2)}`,
      },
      { label: pick(T.rates, language), value: rates },
      { label: pick(T.sinceCleaning, language), value: kg(pellets.consumed_total) },
      { label: pick(T.total, language), value: kg(status.consumption_total, 0) },
    ],
  });
  return { ttl_seconds: 60, components };
}
