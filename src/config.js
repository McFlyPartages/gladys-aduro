// -----------------------------------------------------------------------------
// Integration configuration: defaults (mirror of the manifest `config_schema`
// defaults, test/manifest.test.js keeps them aligned) and normalization of
// what Gladys sends.
// -----------------------------------------------------------------------------

export const STOVE_MODELS = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'];

export const DEFAULT_CONFIG = {
  stove_serial: '',
  stove_pin: '',
  stove_ip: '',
  stove_model: 'H2',
  // Off unless the user opts in: the PIN would cross the Internet in clear.
  cloud_relay: false,
  language: 'en',
  pellet_capacity: 9.5,
  low_pellet_level: 10,
  shutdown_level: 5,
  high_smoke_temp: 370,
  high_smoke_duration: 30,
  low_wood_temp: 175,
  low_wood_duration: 300,
  force_fan_duration: 60,
  force_auger_duration: 15,
};

// Limits of the numeric settings, the same as the manifest and as the Home
// Assistant integration's number entities.
export const LIMITS = {
  pellet_capacity: [1, 100],
  low_pellet_level: [0, 100],
  shutdown_level: [0, 100],
  high_smoke_temp: [300, 450],
  high_smoke_duration: [10, 1800],
  low_wood_temp: [20, 200],
  low_wood_duration: [10, 1800],
  force_fan_duration: [1, 900],
  force_auger_duration: [1, 300],
};

const text = (value) => (typeof value === 'string' ? value.trim() : '');

function numberIn(value, [min, max], fallback) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

/** Complete and clean the configuration Gladys sends. */
export function normalizeConfig(raw = {}) {
  const config = { ...DEFAULT_CONFIG };
  config.stove_serial = text(raw.stove_serial);
  config.stove_pin = text(raw.stove_pin);
  config.stove_ip = text(raw.stove_ip);
  config.stove_model = STOVE_MODELS.includes(raw.stove_model)
    ? raw.stove_model
    : DEFAULT_CONFIG.stove_model;
  config.cloud_relay = raw.cloud_relay === true || raw.cloud_relay === 'true';
  config.language = raw.language === 'fr' ? 'fr' : 'en';
  for (const [key, limits] of Object.entries(LIMITS)) {
    config[key] = numberIn(raw[key], limits, DEFAULT_CONFIG[key]);
  }
  // Gladys' "prefer the local connection" toggle (transports local + cloud).
  config.prefer_local = raw.GLADYS_PREFER_LOCAL !== false;
  return config;
}

/** Whether two configurations need a new stove session. */
export function sameConnection(a, b) {
  return (
    a.stove_serial === b.stove_serial &&
    a.stove_pin === b.stove_pin &&
    a.stove_ip === b.stove_ip &&
    a.cloud_relay === b.cloud_relay &&
    a.prefer_local === b.prefer_local
  );
}
