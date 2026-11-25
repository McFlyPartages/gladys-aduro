import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeFrame,
  encodeFrame,
  parseDiscovery,
  parsePayload,
  sameSerial,
} from '../src/protocol.js';

// What pyduro sends for `Frame('<serial>', '<pin>', 0, 'NBE Discovery').get()`
// at time 1700000000.123, worked out from its format strings.
test('the discovery frame is the one pyduro builds', () => {
  const frame = encodeFrame({
    serial: '<serial>',
    pin: '<pin>',
    functionId: 0,
    payload: 'NBE Discovery',
    appId: '___pyduro___',
    now: 1700000000123,
  });
  assert.equal(frame, '___pyduro___<seria \x020000<pin>000001700000000pad 013NBE Discovery\x04');
});

test('serial, pin, function and sequence are padded like pyduro', () => {
  const frame = encodeFrame({
    serial: '1234',
    pin: '42',
    functionId: 11,
    payload: '*',
    sequence: 105,
    now: 0,
  });
  assert.equal(frame.slice(12, 18), '001234');
  assert.equal(frame.slice(20, 22), '11');
  assert.equal(frame.slice(22, 24), '06');
  assert.equal(frame.slice(24, 34), '4200000000');
  assert.ok(frame.endsWith('pad 001*\x04'));
});

test('a too large payload is refused', () => {
  assert.throws(() => encodeFrame({ functionId: 2, payload: 'x'.repeat(496) }), /too large/);
});

test('a reply is decoded', () => {
  const reply = decodeFrame('___gladys___123456 0207' + '0' + '005hello');
  assert.deepEqual(reply, {
    appId: '___gladys___',
    serial: '123456',
    functionId: 2,
    sequence: 7,
    status: 0,
    payload: 'hello',
  });
  assert.equal(decodeFrame('___gladys___123456 0207' + '0' + '000').payload, '');
});

test('a truncated or malformed reply throws', () => {
  assert.throws(() => decodeFrame('short'), /too short/);
  assert.throws(() => decodeFrame('___gladys___123456 0207' + '0' + '010abc'), /truncated/);
  assert.throws(() => decodeFrame('___gladys___123456 xx07' + '0' + '000'), /malformed/);
});

test('payloads are parsed like pyduro parse_payload', () => {
  assert.equal(parsePayload('1,2,3'), '1,2,3');
  assert.deepEqual(parsePayload('a;b'), ['a', 'b']);
  assert.deepEqual(parsePayload('Serial=123;IP=1.2.3.4=x'), { Serial: '123', IP: '1.2.3.4=x' });
});

test('a discovery reply is read', () => {
  assert.deepEqual(parseDiscovery('Serial=123456;IP=192.168.1.5;Type=H2;Ver=705;Build=12;Lang=0'), {
    serial: '123456',
    ip: '192.168.1.5',
    type: 'H2',
    version: '705',
    build: '12',
    language: '0',
  });
  assert.equal(parseDiscovery('nothing'), null);
});

test('serials compare without their zero padding', () => {
  assert.ok(sameSerial('012345', '12345'));
  assert.ok(!sameSerial('12345', '12346'));
  assert.ok(!sameSerial('', '000'));
});
