// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys (with the core's mDNS scan
// answering for the fake devices), fake SmartCast devices on a fake network,
// a temporary /data and a manual clock, with the integration wired on top
// through registerHandlers. No timer runs (unless `timers`, with mocked
// timers): the tests read the devices with `world.hub.pollAll()`, and the
// waits of the commands are instant.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { FakeVizio, createNetwork } from './fakeVizio.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const TV_IP = '192.0.2.30';
export const SOUNDBAR_IP = '192.0.2.31';
export const TOKEN = 'Zm9vYmFyMTIz';

/** A manual clock; `sleep` moves it forward instead of waiting. */
export function createClock(start = Date.UTC(2026, 9, 14, 19, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
    sleep: async (ms) => {
      clock.time += ms;
    },
  };
  return clock;
}

/** What the core's mDNS scan relays for these devices (`_viziocast._tcp`). */
export function mdnsResults(devices) {
  return Object.entries(devices).map(([ip, device]) => ({
    name: `${device.name}._viziocast._tcp.local`,
    host: `${device.name.replace(/\W+/g, '-')}.local`,
    addresses: ['fe80::1', ip],
    port: device.port,
    txt: ['wp=8005', 'wsp=8006', `mdl=${device.model}`],
  }));
}

/** A TV that already accepts TOKEN (paired before). */
export const pairedTv = (options = {}) => new FakeVizio({ tokens: [TOKEN], ...options });

/**
 * @param {object} [options]
 * @param {Record<string, FakeVizio>} [options.devices] by IP address
 * @param {object} [options.config] raw integration config
 * @param {object} [options.saved] content of /data/vizio-state.json
 * @param {boolean} [options.mdns] whether the core's mDNS scan finds them
 */
export async function createWorld({
  clock = createClock(),
  devices,
  config = { language: 'en' },
  saved,
  mdns = true,
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-vizio-')),
  timings = {},
  timers = false,
  gladysDevices = [],
} = {}) {
  const network = createNetwork(devices ?? { [TV_IP]: pairedTv() });
  const gladys = createFakeGladys({
    config,
    devices: gladysDevices,
    scanResults: { mdns: mdns ? mdnsResults(network.devices) : [] },
  });
  const store = new Store(dataDir);
  if (saved) {
    store.save(saved);
    await store.flush();
  } else if (!devices) {
    // The default world: the TV already paired (as after the pairing actions).
    store.save({
      clientId: 'gladys-0a1b2c3d',
      devices: {
        [network.devices[TV_IP].serial]: { host: TV_IP, port: 7345, kind: 'tv', token: TOKEN },
      },
    });
    await store.flush();
  }
  const app = registerHandlers(gladys, {
    store,
    request: network.request,
    timers,
    timings,
    now: clock.now,
    sleep: clock.sleep,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return {
    gladys,
    fake: gladys.fake,
    network,
    tv: network.devices[TV_IP],
    app,
    hub: app.hub,
    clock,
    dataDir,
    store,
  };
}

/** The discovered device at this index. */
export const deviceOf = (world, index = 0) => world.fake.discoveredDevices[index];

/** A feature of a discovered device, by key. */
export const featureOf = (device, key) =>
  device.features.find((feature) => feature.external_id === `${device.external_id}:${key}`);

/** The last state published for a feature of the first device. */
export const stateOf = (world, key, index = 0) =>
  world.fake.lastState(`${deviceOf(world, index).external_id}:${key}`);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

export { FakeVizio, APP_CONFIGS } from './fakeVizio.js';
