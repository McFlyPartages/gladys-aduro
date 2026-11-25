// -----------------------------------------------------------------------------
// Pellet depletion prediction, heat level mode only.
//
// Port of the "heat level mode" part of the Home Assistant integration's
// prediction (https://github.com/NewImproved/Aduro, MIT):
//   - learn the consumption rate (kg/h) of each heat level from stable
//     burning periods: one observation every 30 minutes at the same level, or
//     when the level changes or the stove stops after 15 minutes or more;
//   - learn what an ignition burns, from the start-up states to state 5;
//   - prediction = (pellets left - ignition if not burning yet) / rate.
//
// Unlike Home Assistant, a prediction only needs enough data at the CURRENT
// level (the other levels and the temperature-mode cycles are not used), and
// periods during which the counter did not move are not learned (the stove
// consumption is read every 5 minutes).
//
// The temperature mode (heating/cooling cycles, weather forecast) is not
// ported. Pure logic: the caller passes the clock and the readings.
// -----------------------------------------------------------------------------

export const LEARNING = {
  SNAPSHOT_S: 30 * 60,
  MIN_PERIOD_S: 15 * 60,
  MIN_STARTUP_S: 60,
  // Hours learned at the current level before predicting, and for a "high"
  // confidence (Home Assistant asks 10 h per level).
  MIN_HOURS: 2,
  HIGH_HOURS: 10,
  RECENT_DAYS: 60,
};

// Stable burning, start-up sequence (Home Assistant's classification).
const BURNING_STATES = new Set(['5', '32']);
const STARTUP_STATES = new Set(['2', '4', '32']);

const DAY_MS = 24 * 3600 * 1000;

export function emptyLearning() {
  return {
    levels: {
      1: { hours: 0, kg: 0, updated: null },
      2: { hours: 0, kg: 0, updated: null },
      3: { hours: 0, kg: 0, updated: null },
    },
    startup: { count: 0, kg: 0, seconds: 0 },
  };
}

export class Learner {
  /** @param {object} [learning] persisted data, see emptyLearning() */
  constructor(learning) {
    const base = emptyLearning();
    this.data = {
      levels: { ...base.levels, ...(learning?.levels ?? {}) },
      startup: { ...base.startup, ...(learning?.startup ?? {}) },
    };
    // Running total of the pellets burnt, fed by the consumption increments.
    this.burnt = 0;
    this.period = null; // { level, since, burnt }
    this.startup = null; // { since, burnt }
  }

  /** Pellets burnt since the previous consumption read. */
  addConsumption(kg) {
    if (kg > 0) {
      this.burnt += kg;
    }
  }

  /**
   * Follow the stove after each poll. Returns true when something was learned
   * (the caller saves it).
   * @param {{ state: string, heatLevel: number, mode: number, now: number }} reading
   */
  observe({ state, heatLevel, mode, now }) {
    let learned = false;
    // Wood mode is not pellets: forget the running periods.
    if (mode !== 0 && mode !== 1) {
      this.period = null;
      this.startup = null;
      return false;
    }

    if (STARTUP_STATES.has(state)) {
      this.startup ??= { since: now, burnt: this.burnt };
    } else if (state === '5' && this.startup) {
      const seconds = (now - this.startup.since) / 1000;
      const kg = this.burnt - this.startup.burnt;
      if (seconds > LEARNING.MIN_STARTUP_S && kg > 0) {
        const startup = this.data.startup;
        startup.count += 1;
        startup.kg += kg;
        startup.seconds += seconds;
        learned = true;
      }
      this.startup = null;
    } else {
      this.startup = null;
    }

    if (BURNING_STATES.has(state)) {
      if (!this.period) {
        this.period = { level: heatLevel, since: now, burnt: this.burnt };
      } else if (this.period.level !== heatLevel) {
        learned = this.closePeriod(now, LEARNING.MIN_PERIOD_S) || learned;
        this.period = { level: heatLevel, since: now, burnt: this.burnt };
      } else if ((now - this.period.since) / 1000 >= LEARNING.SNAPSHOT_S) {
        learned = this.closePeriod(now, LEARNING.SNAPSHOT_S) || learned;
        this.period = { level: heatLevel, since: now, burnt: this.burnt };
      }
    } else if (this.period) {
      learned = this.closePeriod(now, LEARNING.MIN_PERIOD_S) || learned;
      this.period = null;
    }
    return learned;
  }

  closePeriod(now, minSeconds) {
    const seconds = (now - this.period.since) / 1000;
    const kg = this.burnt - this.period.burnt;
    if (seconds < minSeconds || kg <= 0) {
      return false;
    }
    const level = this.data.levels[this.period.level];
    if (!level) {
      return false;
    }
    level.hours += seconds / 3600;
    level.kg += kg;
    level.updated = now;
    return true;
  }

  /** Learned rate of a level, kg/h, or null below the minimum. */
  rate(level) {
    const learned = this.data.levels[level];
    if (!learned || learned.hours < LEARNING.MIN_HOURS || learned.kg <= 0) {
      return null;
    }
    return learned.kg / learned.hours;
  }

  /** What an ignition burns, kg (Home Assistant's default before learning). */
  get startupKg() {
    const { count, kg } = this.data.startup;
    return count > 0 ? kg / count : 0.15;
  }

  /**
   * @param {{ mode: number, state: string, heatLevel: number, pelletsLeft: number,
   *   reserve: number, now: number }} situation
   * @returns {{ status: 'ok' | 'empty' | 'learning' | 'temperature_mode' | 'wood_mode',
   *   hours?: number, at?: number, confidence?: 'high' | 'medium', rate?: number,
   *   learnedHours?: number }}
   */
  predict({ mode, state, heatLevel, pelletsLeft, reserve = 0, now }) {
    if (mode === 2) {
      return { status: 'wood_mode' };
    }
    if (mode !== 0) {
      return { status: 'temperature_mode' };
    }
    const learned = this.data.levels[heatLevel];
    const learnedHours = Math.round((learned?.hours ?? 0) * 10) / 10;
    const rate = this.rate(heatLevel);
    if (rate === null) {
      return { status: 'learning', learnedHours };
    }
    let pellets = pelletsLeft - reserve;
    if (!BURNING_STATES.has(state)) {
      pellets -= this.startupKg; // an ignition first
    }
    if (pellets <= 0) {
      return { status: 'empty', hours: 0, at: now };
    }
    const hours = pellets / rate;
    const recent =
      learned.updated !== null && now - learned.updated <= LEARNING.RECENT_DAYS * DAY_MS;
    return {
      status: 'ok',
      hours: Math.round(hours * 10) / 10,
      at: now + Math.round(hours * 3600 * 1000),
      confidence: learned.hours >= LEARNING.HIGH_HOURS && recent ? 'high' : 'medium',
      rate: Math.round(rate * 1000) / 1000,
      learnedHours,
    };
  }
}

const TEXTS = {
  learning: {
    en: 'Learning ({hours} h of {min} h at level {level})',
    fr: 'Apprentissage ({hours} h sur {min} h à la puissance {level})',
  },
  learningShort: { en: 'Learning ({hours}/{min} h)', fr: 'Apprentissage ({hours}/{min} h)' },
  temperature_mode: {
    en: 'Not available in temperature mode',
    fr: 'Non disponible en mode température',
  },
  wood_mode: { en: 'Not available in wood mode', fr: 'Non disponible en mode bois' },
  empty: { en: 'Empty', fr: 'Vide' },
  medium: { en: 'estimate', fr: 'estimation' },
  high: { en: 'reliable', fr: 'fiable' },
};

const ROMAN = { 1: 'I', 2: 'II', 3: 'III' };

/**
 * Text of the prediction feature, e.g. "Tue 25 Nov, 23:30 (reliable)".
 * @param {object} prediction result of Learner.predict
 * @param {string} language 'en' | 'fr'
 * @param {number} heatLevel
 * @param {string} [timeZone] defaults to the container's (TZ)
 * @param {{ short?: boolean }} [options] short: ≤ 40 characters (widget status)
 */
export function predictionText(prediction, language, heatLevel, timeZone, { short = false } = {}) {
  const pick = (texts) => texts[language] ?? texts.en;
  if (prediction.status === 'learning') {
    return pick(short ? TEXTS.learningShort : TEXTS.learning)
      .replace('{hours}', String(prediction.learnedHours))
      .replace('{min}', String(LEARNING.MIN_HOURS))
      .replace('{level}', ROMAN[heatLevel] ?? String(heatLevel));
  }
  if (prediction.status !== 'ok') {
    return pick(TEXTS[prediction.status]);
  }
  const date = new Intl.DateTimeFormat(language === 'fr' ? 'fr-FR' : 'en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(prediction.at));
  if (short) {
    return prediction.confidence === 'high' ? date : `≈ ${date}`;
  }
  return `${date} (${pick(TEXTS[prediction.confidence])})`;
}
