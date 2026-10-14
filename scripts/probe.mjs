// -----------------------------------------------------------------------------
// Read-only probe of a real SmartCast device with the integration's own client:
// what the integration would read, nothing it would write. Run it from a
// machine on the same network as the TV or sound bar:
//
//   node scripts/probe.mjs 192.168.1.30            # device info only (no token needed)
//   VIZIO_TOKEN=... node scripts/probe.mjs 192.168.1.30:7345
//
// The token comes from the environment, never from the command line (shell
// history), and is never printed; the serial number is masked. No key is
// pressed, no setting written, no pairing started.
// -----------------------------------------------------------------------------

import { SmartCastClient } from '../src/vizio/client.js';
import { appNameOf } from '../src/vizio/apps.js';
import { parseHost } from '../src/config.js';

const target = parseHost(process.argv[2]);
if (!target) {
  console.error('Usage: [VIZIO_TOKEN=...] node scripts/probe.mjs <ip[:port]>');
  process.exit(2);
}

const mask = (value) => (value ? `${String(value).slice(0, 3)}…${String(value).slice(-2)}` : value);
const client = new SmartCastClient({ ...target, token: process.env.VIZIO_TOKEN || null });

async function step(what, fn) {
  try {
    const result = await fn();
    console.log(`OK   ${what}:`, JSON.stringify(result));
    return result;
  } catch (err) {
    console.log(`FAIL ${what}: ${err.kind ?? ''} ${err.message}`);
    return undefined;
  }
}

const info = await step('device info', async () => {
  const value = await client.deviceInfo();
  return { ...value, serial: mask(value.serial), port: client.port };
});
if (!info) {
  process.exit(1);
}
await step('power (/state/device/power_mode)', () => client.powerState());
if (!client.token && info.kind === 'tv') {
  console.log('No VIZIO_TOKEN: the reads that need the pairing token are skipped.');
  process.exit(0);
}
if (info.kind === 'tv') {
  await step('/state_extended', async () => {
    const state = await client.stateExtended();
    return { ...state, appName: appNameOf(state.app) };
  });
  await step('current app', async () => {
    const app = await client.currentApp();
    return { app, name: appNameOf(app) };
  });
  await step('picture options', () => client.settingOptions('picture'));
  await step('picture mode', () => client.setting('picture', 'picture_mode'));
}
await step('current input', () => client.currentInput());
await step('inputs', () => client.inputs());
await step('audio settings', () => client.settingValues('audio'));
await step('audio options', () => client.settingOptions('audio'));
await step('volume (own path)', () => client.setting('audio', 'volume'));
