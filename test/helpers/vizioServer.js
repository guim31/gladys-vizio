// -----------------------------------------------------------------------------
// The fake TV of the tests (fakeVizio.js) over real HTTPS, with a self-signed
// certificate like a SmartCast device: used by test/https.test.js on the
// loopback interface, and runnable by hand to try the integration's
// container against it:
//
//   node test/helpers/vizioServer.js     # port 7345, or $PORT; PIN 1234
// -----------------------------------------------------------------------------

import https from 'node:https';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FakeVizio } from './fakeVizio.js';

const tls = (name) => readFileSync(new URL(`../fixtures/tls/${name}`, import.meta.url));

/**
 * @param {FakeVizio} tv
 * @returns {https.Server}
 */
export function createVizioServer(tv) {
  return https.createServer({ key: tls('key.pem'), cert: tls('cert.pem') }, (req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const answer = tv.handle({
        method: req.method,
        path: req.url,
        headers: { AUTH: req.headers.auth },
        body: chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined,
      });
      res.writeHead(answer.status, answer.headers);
      res.end(answer.body);
    });
  });
}

// `node --test` runs the helpers too: only a direct run opens a port.
if (process.argv[1] === fileURLToPath(import.meta.url) && !process.env.NODE_TEST_CONTEXT) {
  const tv = new FakeVizio({ pin: process.env.VIZIO_PIN || '1234' });
  const port = Number(process.env.PORT || 7345);
  createVizioServer(tv).listen(port, () => {
    console.log(`Fake VIZIO TV listening on https port ${port}, PIN ${tv.pin}`);
  });
}
