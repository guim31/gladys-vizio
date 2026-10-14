// -----------------------------------------------------------------------------
// The SmartCast client against the fake devices: the port found by trying
// 7345 then 9000, the AUTH header, the error kinds, the HASHVAL writes, the
// input switch of recent and older firmware, the pairing payloads, the keys.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS, SmartCastClient } from '../src/vizio/client.js';
import { CODES } from '../src/vizio/keys.js';
import { FakeVizio, createNetwork } from './helpers/fakeVizio.js';

const TOKEN = 'secret-token';

function setup(device = new FakeVizio({ tokens: [TOKEN] }), options = {}) {
  const network = createNetwork({ '192.0.2.30': device });
  const client = new SmartCastClient({ host: '192.0.2.30', request: network.request, ...options });
  return { device, network, client };
}

test('the port is found by trying 7345 then 9000, and kept', async () => {
  const { client, network } = setup(new FakeVizio({ kind: 'soundbar' }));
  const info = await client.deviceInfo();
  assert.equal(client.port, 9000);
  assert.equal(info.kind, 'soundbar');
  assert.equal(info.serial, 'SBTEST3651F0001');
  await client.powerState();
  assert.deepEqual(
    network.requests.map((request) => request.port),
    [7345, 9000, 9000],
  );
});

test('older firmware: the serial number is read in the settings tree', async () => {
  const { client } = setup(new FakeVizio({ firmware: 'legacy', serial: 'LTMOLD0001' }));
  assert.equal((await client.deviceInfo()).serial, 'LTMOLD0001');
});

test('the token goes in an AUTH header; none, or a forgotten one, is an auth error', async () => {
  const { client, device } = setup();
  await client.deviceInfo();
  await assert.rejects(client.powerState(), { kind: ERROR_KINDS.AUTH, status: 403 });
  client.token = TOKEN;
  assert.equal(await client.powerState(), true);
  assert.equal(device.requests.at(-1).auth, TOKEN);
  // The device info never carries the token.
  assert.equal(device.requests[0].auth, null);
  device.tokens.clear();
  const error = await client.powerState().catch((err) => err);
  assert.equal(error.kind, ERROR_KINDS.AUTH);
  assert.ok(!error.message.includes(TOKEN));
});

test('a device that does not answer, an endpoint the firmware lacks, a non-SmartCast server', async () => {
  const { client, device } = setup(undefined, { token: TOKEN, port: 7345 });
  device.online = false;
  await assert.rejects(client.powerState(), { kind: ERROR_KINDS.UNREACHABLE });
  device.online = true;
  await assert.rejects(client.call('GET', '/nothing/here'), { kind: ERROR_KINDS.NOT_FOUND });
  const html = new SmartCastClient({
    host: '192.0.2.99',
    port: 7345,
    request: async () => ({ status: 200, body: '<html>router</html>' }),
  });
  await assert.rejects(html.deviceInfo(), { kind: ERROR_KINDS.NOT_SMARTCAST });
});

test('state_extended on recent firmware; URI_NOT_FOUND on older firmware', async () => {
  const { client, device } = setup(undefined, { token: TOKEN, port: 7345 });
  device.openApp({ APP_ID: '1', NAME_SPACE: 3, MESSAGE: null });
  assert.deepEqual(await client.stateExtended(), {
    power: true,
    powerMode: 'Quick Start',
    input: 'SMARTCAST',
    app: { appId: '1', nameSpace: 3, message: null },
  });
  const old = setup(new FakeVizio({ firmware: 'legacy', tokens: [TOKEN] }), {
    token: TOKEN,
    port: 7345,
  });
  await assert.rejects(old.client.stateExtended(), { kind: ERROR_KINDS.NOT_FOUND });
});

test('a setting is written with the HASHVAL read just before', async () => {
  const { client, device } = setup(undefined, { token: TOKEN, port: 7345 });
  await client.writeSetting('audio', 'volume', 40);
  assert.equal(device.volume, 40);
  const put = device.requests.at(-1);
  assert.equal(put.method, 'PUT');
  assert.deepEqual(Object.keys(JSON.parse(put.body)).sort(), ['HASHVAL', 'REQUEST', 'VALUE']);
  await client.writeSetting('picture', 'picture_mode', 'Game');
  assert.equal(device.settings.picture.picture_mode.value, 'Game');
});

test('recent firmware switches inputs by cname, older firmware by name; same input skipped', async () => {
  const { client, device } = setup(undefined, { token: TOKEN, port: 7345 });
  const inputs = await client.inputs();
  await client.setInput(inputs.find((input) => input.cname === 'hdmi2'));
  assert.equal(device.input, 'hdmi2');
  assert.equal(JSON.parse(device.requests.at(-1).body).VALUE, 'hdmi2');
  const before = device.requests.length;
  await client.setInput(inputs.find((input) => input.cname === 'hdmi2'));
  assert.equal(device.requests.length, before + 1, 'only the current input was read');

  const old = setup(new FakeVizio({ firmware: 'legacy', tokens: [TOKEN] }), {
    token: TOKEN,
    port: 7345,
  });
  const oldInputs = await old.client.inputs();
  await old.client.setInput(oldInputs.find((input) => input.cname === 'hdmi1'));
  assert.equal(old.device.input, 'hdmi1');
  assert.equal(JSON.parse(old.device.requests.at(-1).body).VALUE, 'HDMI-1');
});

test('keys: one KEYLIST request, KEYPRESS actions, power on is (11, 1)', async () => {
  const { client, device } = setup(undefined, { token: TOKEN, port: 7345 });
  device.power = false;
  await client.pressKeys([CODES.POWER_ON, CODES.VOLUME_UP, CODES.VOLUME_UP]);
  assert.equal(device.power, true);
  assert.deepEqual(JSON.parse(device.requests.at(-1).body), {
    KEYLIST: [
      { CODESET: 11, CODE: 1, ACTION: 'KEYPRESS' },
      { CODESET: 5, CODE: 1, ACTION: 'KEYPRESS' },
      { CODESET: 5, CODE: 1, ACTION: 'KEYPRESS' },
    ],
  });
  assert.equal(device.volume, 25);
});

test('pairing: challenge, PIN, token; a wrong PIN is a PIN error', async () => {
  const { client, device } = setup(new FakeVizio({ pin: '4321' }));
  const challenge = await client.startPairing('gladys-1234', 'Gladys');
  assert.deepEqual(JSON.parse(device.requests.at(-1).body), {
    DEVICE_ID: 'gladys-1234',
    DEVICE_NAME: 'Gladys',
  });
  assert.equal(challenge.type, 1);
  await assert.rejects(client.finishPairing('gladys-1234', challenge, '0000'), {
    kind: ERROR_KINDS.PIN,
  });
  const token = await client.finishPairing('gladys-1234', challenge, '4321');
  assert.ok(device.tokens.has(token));
  assert.deepEqual(Object.keys(JSON.parse(device.requests.at(-1).body)).sort(), [
    'CHALLENGE_TYPE',
    'DEVICE_ID',
    'PAIRING_REQ_TOKEN',
    'RESPONSE_VALUE',
  ]);
  await client.cancelPairing('gladys-1234', 'Gladys');
});
