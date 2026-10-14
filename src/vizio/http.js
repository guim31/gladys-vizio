// -----------------------------------------------------------------------------
// The only network code of the integration: one HTTPS request to a SmartCast
// device, its answer as `{ status, body }`. The tests replace this function
// with a fake network (test/helpers/fakeVizio.js), and run it for real against
// the fake TV served over HTTPS (test/https.test.js).
//
// SmartCast devices serve their API over HTTPS with a self-signed certificate
// that no authority signed: the certificate cannot be verified, as in pyvizio
// and vizaio. The auth token goes to the address the user gave or the core's
// mDNS discovery found, on the local network only.
// -----------------------------------------------------------------------------

import https from 'node:https';

// The official app's budget: 2 s to connect, 10 s to read. A poll every 10 s
// cannot wait longer than that.
export const CONNECT_TIMEOUT_MS = 2_000;
export const REQUEST_TIMEOUT_MS = 8_000;

// One connection per device at a time, kept alive between the reads of a poll:
// the SmartCast server (lighttpd) is small, and pyvizio serializes for the same
// reason.
const agent = new https.Agent({ keepAlive: true, maxSockets: 1, rejectUnauthorized: false });

/**
 * @param {object} options
 * @param {string} options.host IP address or host name
 * @param {number} options.port 7345 or 9000
 * @param {'GET'|'PUT'} options.method
 * @param {string} options.path
 * @param {Record<string, string>} [options.headers]
 * @param {string} [options.body] JSON text
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ status: number, body: string }>} rejects with `code` on a network error
 */
export function httpsRequest({ host, port, method, path, headers = {}, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        host,
        port,
        method,
        path,
        agent,
        headers:
          body === undefined ? headers : { ...headers, 'Content-Length': Buffer.byteLength(body) },
        timeout: CONNECT_TIMEOUT_MS,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }),
        );
        response.on('error', reject);
      },
    );
    // `timeout` above is the idle socket timeout (connect included); this one
    // bounds the whole exchange.
    const overall = setTimeout(() => {
      request.destroy(Object.assign(new Error('Request timed out'), { code: 'ETIMEDOUT' }));
    }, timeoutMs ?? REQUEST_TIMEOUT_MS);
    request.on('timeout', () => {
      request.destroy(Object.assign(new Error('Connection timed out'), { code: 'ETIMEDOUT' }));
    });
    request.on('error', reject);
    request.on('close', () => clearTimeout(overall));
    if (body !== undefined) {
      request.write(body);
    }
    request.end();
  });
}
