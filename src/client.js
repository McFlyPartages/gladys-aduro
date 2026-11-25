// -----------------------------------------------------------------------------
// UDP client of one stove: one request at a time, one reply awaited per
// request, a timeout instead of an exception when the stove keeps quiet.
//
// Requests are serialized because every one of them is sent from the same
// source port (1901, the one the stove is known to answer), and because the
// stove controller copes badly with concurrent sessions.
//
// The socket factory is injected (`createSocket`) so the tests never open a
// real socket.
// -----------------------------------------------------------------------------

import dgram from 'node:dgram';
import { FUNCTIONS, NBE_PORT, SOURCE_PORT, decodeFrame, encodeFrame } from './protocol.js';

export const DEFAULT_TIMEOUT_MS = 5000;

export class StoveTimeoutError extends Error {
  constructor(host) {
    super(`No reply from the stove at ${host}`);
    this.name = 'StoveTimeoutError';
  }
}

const defaultSocketFactory = () => dgram.createSocket({ type: 'udp4', reuseAddr: true });

export class StoveClient {
  /**
   * @param {{ serial: string, pin: string, createSocket?: () => object,
   *   timeoutMs?: number, sourcePort?: number }} options
   */
  constructor({
    serial,
    pin,
    createSocket = defaultSocketFactory,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    sourcePort = SOURCE_PORT,
  }) {
    this.serial = serial;
    this.pin = pin;
    this.createSocket = createSocket;
    this.timeoutMs = timeoutMs;
    this.sourcePort = sourcePort;
    this.queue = Promise.resolve();
    this.sequence = 0;
  }

  /**
   * Send one request and resolve with the decoded reply.
   * @param {string} host IP address or host name of the stove (or the relay)
   * @param {number} functionId
   * @param {string} payload
   */
  request(host, functionId, payload) {
    const run = () => this.exchange(host, functionId, payload);
    const result = this.queue.then(run, run);
    // The queue survives a failed request.
    this.queue = result.catch(() => {});
    return result;
  }

  exchange(host, functionId, payload) {
    this.sequence = (this.sequence + 1) % 99;
    const frame = encodeFrame({
      serial: this.serial,
      pin: this.pin,
      functionId,
      payload,
      sequence: this.sequence,
    });
    return new Promise((resolve, reject) => {
      const socket = this.createSocket();
      let settled = false;
      const finish = (err, value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        try {
          socket.close();
        } catch {
          // Already closed.
        }
        if (err) {
          reject(err);
        } else {
          resolve(value);
        }
      };
      const timer = setTimeout(() => finish(new StoveTimeoutError(host)), this.timeoutMs);
      socket.on('error', (err) => finish(err));
      socket.on('message', (message) => {
        try {
          const reply = decodeFrame(message.toString('latin1'));
          // A late reply to an earlier (timed out) request carries its own
          // function code: ignore it and keep waiting.
          if (reply.functionId !== functionId) {
            return;
          }
          finish(null, reply);
        } catch (err) {
          finish(err);
        }
      });
      socket.bind(this.sourcePort, () => {
        socket.send(Buffer.from(frame, 'latin1'), NBE_PORT, host, (err) => {
          if (err) {
            finish(err);
          }
        });
      });
    });
  }

  /** Read a setting (function 1), e.g. "wifi.router". */
  getSettings(host, path) {
    return this.request(host, FUNCTIONS.GET_SETTINGS, path);
  }

  /** Read the status values (function 11, "*"). */
  getStatus(host) {
    return this.request(host, FUNCTIONS.GET_STATUS, '*');
  }

  /** Read the operating values (function 11, "001*"). */
  getOperating(host) {
    return this.request(host, FUNCTIONS.GET_STATUS, '001*');
  }

  /** Read a consumption table (function 6), e.g. "total_days". */
  getConsumption(host, table) {
    return this.request(host, FUNCTIONS.GET_CONSUMPTION, table);
  }

  /**
   * Write a setting (function 2). The stove answers with an empty payload
   * when it accepted the value.
   */
  async set(host, path, value) {
    const reply = await this.request(host, FUNCTIONS.SET, `${path}=${value}`);
    if (reply.payload !== '') {
      throw new Error(`The stove refused ${path}=${value} (${reply.payload})`);
    }
  }
}
