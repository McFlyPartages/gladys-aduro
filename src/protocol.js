// -----------------------------------------------------------------------------
// NBE protocol spoken by the Aduro hybrid stoves (and NBE pellet burners):
// plain-text frames over UDP, port 8483 on the stove side.
//
// JavaScript port of pyduro (https://github.com/clementprevot/pyduro, MIT,
// Copyright (c) 2022 Clément Prévot): same frame layout, same defaults.
//
//   request  = app_id(12) serial(6) " " STX function(2) seq(2) pin(10)
//              timestamp(10) "pad " size(3) payload EOT
//   response = app_id(12) serial(6) ?(1) function(2) seq(2) status(1)
//              size(3) payload
//
// Pure functions only: the socket lives in src/client.js.
// -----------------------------------------------------------------------------

export const NBE_PORT = 8483;
// Port the Aduro app answers from; pyduro and the Home Assistant integration
// use it too, so the stove is known to reply to it.
export const SOURCE_PORT = 1901;
export const DEFAULT_APP_ID = '___gladys___';
export const MAX_PAYLOAD_SIZE = 495;
// Relay of the Aduro cloud, used by the app when the stove is not on the LAN.
export const CLOUD_RELAY = 'apprelay20.stokercloud.dk';

export const FUNCTIONS = {
  DISCOVER: 0,
  GET_SETTINGS: 1,
  SET: 2,
  GET_CONSUMPTION: 6,
  // Undocumented function the Aduro app uses: "*" returns the status values
  // (STATUS_PARAMS order), "001*" the operating values.
  GET_STATUS: 11,
};

export const DISCOVERY_PAYLOAD = 'NBE Discovery';

const STX = '\x02';
const EOT = '\x04';

/**
 * Build a request frame.
 * @param {{ serial?: string, pin?: string, functionId: number, payload?: string,
 *   sequence?: number, appId?: string, now?: number }} request
 * @returns {string}
 */
export function encodeFrame({
  serial = '',
  pin = '',
  functionId,
  payload = '*',
  sequence = 0,
  appId = DEFAULT_APP_ID,
  now = Date.now(),
}) {
  const body = payload || '*';
  if (body.length > MAX_PAYLOAD_SIZE) {
    throw new Error(`NBE payload too large (${body.length} > ${MAX_PAYLOAD_SIZE})`);
  }
  // Same normalizations as pyduro: app id right-padded with "_", serial
  // left-padded with "0" (6), pin right-padded with "0" (10), all truncated.
  const app = String(appId).padEnd(12, '_').slice(0, 12);
  const serialField = String(serial).slice(0, 6).padStart(6, '0');
  const pinField = String(pin).padEnd(10, '0').slice(0, 10);
  const fn = String(functionId).padStart(2, '0');
  const seq = String(sequence % 99).padStart(2, '0');
  // Python's str(time()) truncated to 10 characters: the Unix seconds.
  const timestamp = String(now / 1000)
    .slice(0, 10)
    .padStart(10, '0');
  const size = String(body.length).padStart(3, '0');
  return `${app}${serialField} ${STX}${fn}${seq}${pinField}${timestamp}pad ${size}${body}${EOT}`;
}

/**
 * Parse a response frame.
 * @param {string} frame
 * @returns {{ appId: string, serial: string, functionId: number, sequence: number,
 *   status: number, payload: string }}
 */
export function decodeFrame(frame) {
  const text = String(frame);
  if (text.length < 27) {
    throw new Error('NBE response too short');
  }
  const functionId = Number.parseInt(text.slice(19, 21), 10);
  const sequence = Number.parseInt(text.slice(21, 23), 10);
  const status = Number.parseInt(text.slice(23, 24), 10);
  const size = Number.parseInt(text.slice(24, 27), 10);
  if (![functionId, sequence, status, size].every(Number.isFinite)) {
    throw new Error('NBE response malformed');
  }
  const payload = text.slice(27, 27 + size);
  if (payload.length < size) {
    throw new Error('NBE response truncated');
  }
  return {
    appId: text.slice(0, 12),
    serial: text.slice(12, 18),
    functionId,
    sequence,
    status,
    payload,
  };
}

/**
 * pyduro's parse_payload: "a=1;b=2" -> { a, b }; "x;y" -> [x, y]; anything
 * else is returned as is.
 */
export function parsePayload(payload) {
  if (!payload.includes(';')) {
    return payload;
  }
  const parts = payload.split(';');
  if (!payload.includes('=')) {
    return parts;
  }
  const items = {};
  for (const part of parts) {
    const index = part.indexOf('=');
    if (index > 0) {
      items[part.slice(0, index)] = part.slice(index + 1);
    }
  }
  return items;
}

/**
 * Parse the payload of a discovery reply.
 * @returns {{ serial: string, ip: string, type: string, version: string,
 *   build: string, language: string } | null}
 */
export function parseDiscovery(payload) {
  const items = parsePayload(payload);
  if (!items || typeof items !== 'object' || Array.isArray(items) || !items.Serial) {
    return null;
  }
  return {
    serial: items.Serial,
    ip: items.IP ?? '',
    type: items.Type ?? '',
    version: items.Ver ?? '',
    build: items.Build ?? '',
    language: items.Lang ?? '',
  };
}

/** Serial numbers compare without their left zero padding. */
export function sameSerial(a, b) {
  const strip = (value) => String(value ?? '').replace(/^0+/, '');
  return strip(a) !== '' && strip(a) === strip(b);
}
