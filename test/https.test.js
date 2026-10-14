// -----------------------------------------------------------------------------
// End to end over real HTTPS: the fake TV served with a self-signed
// certificate (like a real SmartCast device) on the loopback interface, and
// the integration's own network code (src/vizio/http.js), from the device
// info to the pairing and a key press.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVizioServer } from './helpers/vizioServer.js';
import { FakeVizio } from './helpers/fakeVizio.js';
import { SmartCastClient } from '../src/vizio/client.js';
import { httpsRequest } from '../src/vizio/http.js';

test('the client talks to a TV with a self-signed certificate, port found, paired, keys sent', async (t) => {
  const tv = new FakeVizio({ pin: '2468' });
  const server = createVizioServer(tv);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  tv.port = server.address().port;

  const client = new SmartCastClient({ host: '127.0.0.1', port: tv.port });
  const info = await client.deviceInfo();
  assert.equal(info.serial, tv.serial);
  const challenge = await client.startPairing('gladys-e2e', 'Gladys');
  client.token = await client.finishPairing('gladys-e2e', challenge, '2468');
  assert.equal(await client.powerState(), true);
  await client.pressKeys([[11, 0]]);
  assert.equal(tv.power, false);
  assert.equal(tv.requests.at(-1).auth, client.token);
});

test('a closed port is a network error, quickly', async () => {
  const started = Date.now();
  await assert.rejects(
    httpsRequest({ host: '127.0.0.1', port: 9, method: 'GET', path: '/' }),
    (err) => ['ECONNREFUSED', 'ETIMEDOUT'].includes(err.code),
  );
  assert.ok(Date.now() - started < 5_000);
});
