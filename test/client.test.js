import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { StoveClient, StoveTimeoutError } from '../src/client.js';
import { decodeFrame } from '../src/protocol.js';

/** A dgram socket stand-in: `answer(frame)` decides what the stove replies. */
function fakeSockets(answer) {
  const sockets = [];
  const create = () => {
    const socket = new EventEmitter();
    socket.closed = false;
    socket.bind = (port, callback) => {
      socket.port = port;
      callback();
    };
    socket.send = (buffer, port, host, callback) => {
      socket.sent = { text: buffer.toString('latin1'), port, host };
      callback(null);
      const reply = answer(socket.sent);
      if (reply !== undefined) {
        setImmediate(() => socket.emit('message', Buffer.from(reply, 'latin1')));
      }
    };
    socket.close = () => {
      socket.closed = true;
    };
    sockets.push(socket);
    return socket;
  };
  return { sockets, create };
}

// Reply header for a function code (status 0).
const reply = (functionId, payload) =>
  `___gladys___123456 ${String(functionId).padStart(2, '0')}01` +
  `0${String(payload.length).padStart(3, '0')}${payload}`;

test('a request goes to port 8483 from port 1901 and resolves with the reply', async () => {
  const { sockets, create } = fakeSockets(() => reply(11, '1,2,3'));
  const client = new StoveClient({ serial: '123456', pin: '1111111111', createSocket: create });
  const answer = await client.getStatus('192.168.1.5');
  assert.equal(answer.payload, '1,2,3');
  const [socket] = sockets;
  assert.equal(socket.port, 1901);
  assert.equal(socket.sent.port, 8483);
  assert.equal(socket.sent.host, '192.168.1.5');
  assert.ok(socket.sent.text.includes('pad 001*'));
  assert.ok(socket.closed);
});

test('a silent stove times out', async () => {
  const { sockets, create } = fakeSockets(() => undefined);
  const client = new StoveClient({ serial: '1', pin: '1', createSocket: create, timeoutMs: 20 });
  await assert.rejects(client.getStatus('10.0.0.1'), StoveTimeoutError);
  assert.ok(sockets[0].closed);
});

test('a late reply to another function is ignored', async () => {
  const { create } = fakeSockets(() => reply(6, 'stale'));
  const client = new StoveClient({ serial: '1', pin: '1', createSocket: create, timeoutMs: 20 });
  await assert.rejects(client.getStatus('10.0.0.1'), StoveTimeoutError);
});

test('requests run one at a time, even after a failure', async () => {
  const { sockets, create } = fakeSockets((sent) => {
    const functionId = Number(sent.text.slice(20, 22));
    return sent.text.includes('fail') ? undefined : reply(functionId, 'ok');
  });
  let overlap = false;
  const client = new StoveClient({
    serial: '1',
    pin: '1',
    timeoutMs: 20,
    createSocket: () => {
      overlap ||= sockets.some((socket) => !socket.closed);
      return create();
    },
  });
  const results = await Promise.allSettled([
    client.getSettings('h', 'fail'),
    client.getConsumption('h', 'total_days'),
    client.getOperating('h'),
  ]);
  assert.deepEqual(
    results.map((result) => result.status),
    ['rejected', 'fulfilled', 'fulfilled'],
  );
  assert.equal(overlap, false);
});

test('a write succeeds on an empty reply and fails otherwise', async () => {
  let payload = '';
  const { sockets, create } = fakeSockets(() => reply(2, payload));
  const client = new StoveClient({ serial: '1', pin: '1', createSocket: create });
  await client.set('h', 'boiler.temp', 21);
  assert.ok(sockets[0].sent.text.includes('boiler.temp=21'));
  payload = 'error';
  await assert.rejects(client.set('h', 'boiler.temp', 99), /refused/);
  assert.equal(decodeFrame(reply(2, 'x')).functionId, 2);
});
