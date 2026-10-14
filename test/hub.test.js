// -----------------------------------------------------------------------------
// The hub, end to end against the SDK's fake Gladys and fake devices:
// discovery (mDNS through the core, typed addresses), the PIN pairing of a
// TV, what is kept under /data, the states, the scene event, the commands.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  APP_CONFIGS,
  FakeVizio,
  SOUNDBAR_IP,
  TOKEN,
  TV_IP,
  createAll,
  createWorld,
  deviceOf,
  featureOf,
  pairedTv,
  stateOf,
} from './helpers/world.js';

const setValue = (world, key, value, index = 0) => {
  const device = deviceOf(world, index);
  return world.fake.setValue(device, featureOf(device, key), value);
};

test('a TV found by mDNS waits for its pairing; the two actions pair it and publish it', async (t) => {
  const tv = new FakeVizio({ pin: '5521' });
  const world = await createWorld({ devices: { [TV_IP]: tv } });
  t.after(() => world.app.stop());
  // Found, but not published: without its token the TV says nothing.
  assert.equal(world.hub.records.size, 1);
  assert.deepEqual(world.fake.discoveredDevices, []);
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /Living Room TV: pairing needed/);
  assert.match(world.fake.connectionStatus.message.fr, /Living Room TV : appairage nécessaire/);

  // The PIN action before the first one.
  let ack = await world.fake.action('finish_pairing', { pin: '5521' });
  assert.equal(ack.success, false);
  assert.match(ack.error, /No pairing in progress/);

  ack = await world.fake.action('start_pairing', {});
  assert.equal(ack.success, true, ack.error);
  assert.match(ack.data.message.en, /A PIN is shown on Living Room TV/);
  assert.match(ack.data.message.de, /PIN eingeben/);
  assert.ok(tv.pairing, 'the TV shows a PIN');

  ack = await world.fake.action('finish_pairing', { pin: '12' });
  assert.match(ack.error, /4 digits/);
  ack = await world.fake.action('finish_pairing', { pin: '9999' });
  assert.match(ack.error, /Wrong PIN/);
  ack = await world.fake.action('finish_pairing', { pin: ' 55 21 ' });
  assert.equal(ack.success, true, ack.error);
  assert.match(ack.data.message.en, /Living Room TV is paired/);

  assert.equal(world.fake.discoveredDevices.length, 1);
  assert.equal(world.fake.connectionStatus.connected, true);
  await createAll(world);
  assert.equal(stateOf(world, 'power'), 1);
  assert.equal(stateOf(world, 'playing'), 'SmartCast Home');

  // The token is kept under /data, readable by the integration only.
  await world.store.flush();
  const file = join(world.dataDir, 'vizio-state.json');
  const saved = JSON.parse(await readFile(file, 'utf8'));
  const [entry] = Object.values(saved.devices);
  assert.ok(tv.tokens.has(entry.token));
  assert.match(saved.clientId, /^gladys-[0-9a-f]{8}$/);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test('pairing: an address picks the TV among several; a sound bar needs none', async (t) => {
  const devices = {
    [TV_IP]: new FakeVizio(),
    '192.0.2.35': new FakeVizio({ serial: 'LTMTEST22C00003', name: 'Bedroom TV' }),
    [SOUNDBAR_IP]: new FakeVizio({ kind: 'soundbar' }),
  };
  const world = await createWorld({ devices });
  t.after(() => world.app.stop());
  // The sound bar is published at once.
  assert.deepEqual(
    world.fake.discoveredDevices.map((device) => device.name),
    ['Living Room Sound Bar'],
  );
  let ack = await world.fake.action('start_pairing', {});
  assert.match(ack.error, /Several TVs are waiting for pairing/);
  ack = await world.fake.action('start_pairing', { address: '192.0.2.35' });
  assert.match(ack.data.message.en, /Bedroom TV/);
  ack = await world.fake.action('start_pairing', { address: SOUNDBAR_IP });
  assert.match(ack.data.message.en, /sound bar: it needs no pairing/);
  ack = await world.fake.action('start_pairing', { address: '192.0.2.99' });
  assert.match(ack.error, /No VIZIO device answers at 192\.0\.2\.99/);
  // The second action finds the TV with a PIN pending without an address.
  ack = await world.fake.action('finish_pairing', { pin: '1234' });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(world.fake.discoveredDevices.map((device) => device.name).sort(), [
    'Bedroom TV',
    'Living Room Sound Bar',
  ]);
});

test('a pairing left open is closed on the TV after 5 minutes, and at stop', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const tv = new FakeVizio();
  const world = await createWorld({ devices: { [TV_IP]: tv }, timers: false });
  await world.fake.action('start_pairing', {});
  assert.ok(tv.pairing);
  t.mock.timers.tick(5 * 60_000);
  for (let turn = 0; turn < 50 && tv.pairing; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(tv.pairing, null);
  await world.fake.action('start_pairing', {});
  await world.app.stop();
  assert.equal(tv.pairing, null);
});

test('typed addresses find what mDNS does not see; wrong ones are reported', async (t) => {
  const world = await createWorld({
    devices: { '192.0.2.50': new FakeVizio({ kind: 'soundbar', port: 9000 }) },
    mdns: false,
    config: { language: 'fr', hosts: '192.0.2.50, 192.0.2.51, nope!' },
  });
  t.after(() => world.app.stop());
  assert.equal(world.fake.discoveredDevices.length, 1);
  const status = world.fake.connectionStatus;
  assert.equal(status.connected, true);
  assert.match(status.message.fr, /192\.0\.2\.51 : ne répond pas/);
  assert.match(status.message.fr, /Adresse incomprise/);
  const report = await world.fake.action('test_connection');
  assert.match(report.data.message.en, /Living Room Sound Bar: OK, SB3651-F6, on/);
  assert.match(report.data.message.en, /192\.0\.2\.51: does not answer/);
});

test('the core without mediated discovery (403): typed addresses only', async (t) => {
  const world = await createWorld({ connect: false, config: { language: 'en', hosts: TV_IP } });
  t.after(() => world.app.stop());
  world.gladys.scanNetwork = async () => {
    throw Object.assign(new Error('Forbidden'), { status: 403 });
  };
  await world.gladys.connect();
  await world.app.ready;
  assert.equal(world.fake.discoveredDevices.length, 1);
  assert.equal(world.hub.mdnsUnavailable, true);
});

test('states follow the TV: apps, inputs, volume, mute, picture mode, standby, Eco', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  assert.equal(stateOf(world, 'app'), 'home');
  assert.equal(stateOf(world, 'input'), 'cast');
  assert.equal(stateOf(world, 'volume'), 23);
  assert.equal(stateOf(world, 'picture_mode'), 'Calibrated');

  world.tv.openApp(APP_CONFIGS.netflix);
  await world.hub.pollAll();
  assert.equal(stateOf(world, 'app'), 'Netflix');
  assert.equal(stateOf(world, 'playing'), 'Netflix');

  world.tv.openApp(APP_CONFIGS.unknown);
  await world.hub.pollAll();
  assert.equal(stateOf(world, 'app'), 'other');
  assert.equal(stateOf(world, 'playing'), 'Unknown app');

  world.tv.rename('hdmi2', 'PS5');
  world.tv.show('hdmi2');
  await world.hub.pollAll();
  assert.equal(stateOf(world, 'input'), 'hdmi2');
  assert.equal(stateOf(world, 'app'), 'other');
  assert.equal(stateOf(world, 'playing'), 'HDMI-2');
  // The input list is read again every 30 minutes: the new name shows.
  world.clock.advance(world.hub.timings.inputsMs);
  await world.hub.pollAll();
  assert.equal(stateOf(world, 'playing'), 'PS5');

  world.tv.power = false;
  await world.hub.pollAll();
  assert.equal(stateOf(world, 'power'), 0);
  assert.equal(stateOf(world, 'playing'), 'Off');

  world.tv.online = false;
  await world.hub.pollAll();
  assert.equal(stateOf(world, 'power'), 0);
  assert.deepEqual(world.fake.transports.at(-1), {
    device_external_id: deviceOf(world).external_id,
    transport: 'unreachable',
  });
  // Asleep in Eco mode is no error.
  assert.equal(world.fake.connectionStatus.connected, true);
});

test('a firmware that leaves the volume out of the audio group: read on its own path', async (t) => {
  const tv = pairedTv({ volumeInGroup: false });
  const world = await createWorld({
    devices: { [TV_IP]: tv },
    saved: { devices: { [tv.serial]: { host: TV_IP, port: 7345, kind: 'tv', token: TOKEN } } },
  });
  t.after(() => world.app.stop());
  assert.equal(stateOf(world, 'volume'), 23);
});

test('an older TV: power on its own path, input and app read separately', async (t) => {
  const tv = pairedTv({ firmware: 'legacy' });
  const world = await createWorld({ devices: { [TV_IP]: tv }, saved: undefined });
  t.after(() => world.app.stop());
  // Not paired in /data here: pair it the usual way.
  await world.fake.action('start_pairing', {});
  await world.fake.action('finish_pairing', { pin: '1234' });
  tv.openApp(APP_CONFIGS.hulu);
  await world.hub.pollAll();
  assert.equal(stateOf(world, 'playing'), 'Hulu');
  assert.equal(world.hub.records.get(tv.serial).identity.stateExtended, false);
  assert.ok(tv.requests.some((request) => request.path === '/app/current'));
});

test('the scene event: something new in front, turning on included, not the first read', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.deepEqual(world.fake.sceneEvents, []);
  world.tv.openApp(APP_CONFIGS.netflix);
  await world.hub.pollAll();
  await world.hub.pollAll();
  world.tv.show('hdmi1');
  await world.hub.pollAll();
  world.tv.power = false;
  await world.hub.pollAll();
  world.tv.power = true;
  await world.hub.pollAll();
  assert.deepEqual(
    world.fake.sceneEvents.map((event) => [event.key, event.data.kind, event.data.name]),
    [
      ['content_changed', 'app', 'Netflix'],
      ['content_changed', 'input', 'HDMI-1'],
      ['content_changed', 'input', 'HDMI-1'],
    ],
  );
  assert.equal(world.fake.sceneEvents[0].data.device, deviceOf(world).external_id);
  assert.equal(world.fake.sceneEvents[0].data.tv, 'Living Room TV');
});

test('commands: power, volume, mute, input, app, picture mode, channel', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  const { tv } = world;

  assert.equal((await setValue(world, 'volume', 150)).success, true);
  assert.equal(tv.volume, 100, 'clamped to the scale of the TV');
  await setValue(world, 'volume_down', 1);
  assert.equal(tv.volume, 98, 'volume step 2');
  await setValue(world, 'mute', 1);
  assert.equal(tv.muted, true);
  await setValue(world, 'input', 'hdmi1');
  assert.equal(tv.input, 'hdmi1');
  await setValue(world, 'app', 'YouTube');
  assert.deepEqual(tv.app, { APP_ID: '1', NAME_SPACE: 5, MESSAGE: null });
  await setValue(world, 'app', 'home');
  assert.equal(tv.app.APP_ID, '1');
  assert.equal(tv.app.NAME_SPACE, 4);
  const before = tv.requests.length;
  await setValue(world, 'app', 'other');
  assert.equal(tv.requests.length, before, '"Other" does nothing');
  await setValue(world, 'picture_mode', 'Game');
  assert.equal(tv.settings.picture.picture_mode.value, 'Game');
  await setValue(world, 'channel_up', 1);
  assert.equal(tv.keys.at(-1), '8,1');
  await setValue(world, 'power', 0);
  assert.equal(tv.power, false);
  assert.equal(stateOf(world, 'power'), 0);
  const unknown = await setValue(world, 'picture_mode', 'Nope');
  assert.equal(unknown.success, false);
  assert.match(unknown.error, /Unknown mode/);
});

test('a command on a TV in standby turns it on first; asleep in Eco mode, it says why', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.tv.power = false;
  await world.hub.pollAll();
  const ack = await world.fake.sceneAction('open_app', { app: 'disney plus' });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, { app: 'Disney+' });
  assert.equal(world.tv.power, true);
  assert.equal(world.tv.keys[0], '11,1');

  world.tv.online = false;
  await world.hub.pollAll();
  const asleep = await world.fake.sceneAction('select_input', { input: 'HDMI-1' });
  assert.equal(asleep.success, false);
  assert.match(asleep.error, /Eco mode/);
});

test('a feature command still running after 4 s is acknowledged to Gladys', async (t) => {
  const world = await createWorld({ timings: { featureAckMs: 5 } });
  t.after(() => world.app.stop());
  const original = world.network.request;
  world.network.request = async (options) => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return original(options);
  };
  world.hub.records.get(world.tv.serial).client.request = world.network.request;
  const ack = await setValue(world, 'mute', 1);
  assert.equal(ack.success, true);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(world.tv.muted, true);
});

test('scene actions: inputs by name, keys by name, errors in the configured language', async (t) => {
  const world = await createWorld({ config: { language: 'fr' } });
  t.after(() => world.app.stop());
  world.tv.rename('hdmi2', 'PS5');
  let ack = await world.fake.sceneAction('select_input', { input: 'ps5' });
  assert.deepEqual(ack.data.outputs, { input: 'PS5' });
  assert.equal(world.tv.input, 'hdmi2');
  ack = await world.fake.sceneAction('send_key', { key: 'up', repeat: 3 });
  assert.deepEqual(ack.data.outputs, { presses: 3 });
  assert.deepEqual(world.tv.keys.slice(-3), ['3,8', '3,8', '3,8']);
  ack = await world.fake.sceneAction('select_input', { input: 'HDMI-9' });
  assert.match(ack.error, /Aucune entrée « HDMI-9 »/);
  ack = await world.fake.sceneAction('open_app', { app: 'Nope TV' });
  assert.match(ack.error, /Application inconnue « Nope TV »/);
});

test('a sound bar: its scale, its EQ, its inputs, no apps', async (t) => {
  const bar = new FakeVizio({ kind: 'soundbar' });
  const world = await createWorld({ devices: { [SOUNDBAR_IP]: bar } });
  t.after(() => world.app.stop());
  const device = deviceOf(world);
  assert.equal(featureOf(device, 'volume').max, 31);
  assert.equal(featureOf(device, 'app'), undefined);
  assert.equal(featureOf(device, 'channel_up'), undefined);
  assert.deepEqual(
    featureOf(device, 'sound_mode').supported_options.map((option) => option.value),
    ['Music', 'Movie', 'Direct', 'Dialogue'],
  );
  assert.equal(stateOf(world, 'sound_mode'), 'Music');
  assert.equal(stateOf(world, 'playing'), 'HDMI');
  await setValue(world, 'sound_mode', 'Movie');
  assert.equal(bar.settings.audio.eq.value, 'Movie');
  await setValue(world, 'input', 'bluetooth');
  assert.equal(bar.input, 'bluetooth');
  const ack = await world.fake.sceneAction('open_app', { app: 'Netflix' });
  assert.match(ack.error, /Apps are on VIZIO TVs only/);
  const key = await world.fake.sceneAction('send_key', { key: 'menu' });
  assert.match(key.error, /Unknown key "menu"/);
  // No request carries a token to a sound bar.
  assert.ok(bar.requests.every((request) => request.auth === null || request.auth === undefined));
});

test('a TV that forgot Gladys: reported, its states kept, back once paired again', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.tv.tokens.clear();
  await world.hub.pollAll();
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /no longer accepts Gladys: pair it again/);
  assert.equal(stateOf(world, 'power'), 1);
  const ack = await world.fake.action('start_pairing', {});
  assert.equal(ack.success, true, ack.error);
  await world.fake.action('finish_pairing', { pin: '1234' });
  assert.equal(world.fake.connectionStatus.connected, true);
});

test('a new address (DHCP) is found again by mDNS; the device stays the same', async (t) => {
  const world = await createWorld({ timings: { relocateMs: 0 } });
  t.after(() => world.app.stop());
  const id = deviceOf(world).external_id;
  const tv = world.network.devices[TV_IP];
  delete world.network.devices[TV_IP];
  world.network.devices['192.0.2.77'] = tv;
  world.fake.scanResults.mdns[0].addresses = ['192.0.2.77'];
  for (let read = 0; read < 4; read += 1) {
    await world.hub.pollAll();
  }
  assert.equal(world.hub.records.get(tv.serial).host, '192.0.2.77');
  assert.equal(deviceOf(world).external_id, id);
  assert.equal(
    deviceOf(world).params.find((param) => param.name === 'VIZIO_ADDRESS').value,
    '192.0.2.77:7345',
  );
  tv.volume = 31;
  await world.hub.pollAll();
  assert.equal(stateOf(world, 'volume'), 31);
});

test('after a restart, the paired TV is published from /data even while it sleeps', async (t) => {
  const tv = pairedTv();
  tv.online = false;
  const world = await createWorld({
    devices: { [TV_IP]: tv },
    saved: {
      clientId: 'gladys-0a1b2c3d',
      devices: {
        [tv.serial]: {
          host: TV_IP,
          port: 7345,
          kind: 'tv',
          token: TOKEN,
          identity: { model: tv.model, name: tv.name },
          inputs: [{ cname: 'hdmi1', name: 'HDMI-1', meta: 'HDMI-1', label: 'HDMI-1' }],
        },
      },
    },
  });
  t.after(() => world.app.stop());
  assert.equal(deviceOf(world).name, 'Living Room TV');
  assert.ok(featureOf(deviceOf(world), 'input'));
  assert.equal(stateOf(world, 'power'), 0);
});

test('a device created in Gladys gets its states again, and the widgets a refresh', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const before = world.fake.states.length;
  await createAll(world);
  assert.ok(world.fake.states.length > before, 'states sent again');
  assert.ok(world.fake.widgetRefreshes.length > 0);
});

test('the language of the configuration names the features and the lists', async (t) => {
  const world = await createWorld({ config: { language: 'es' } });
  t.after(() => world.app.stop());
  const device = deviceOf(world);
  assert.equal(featureOf(device, 'power').name, 'Encendido');
  assert.equal(featureOf(device, 'app').supported_options[0].label, 'Inicio de SmartCast');
  assert.equal(stateOf(world, 'playing'), 'Inicio de SmartCast');
  await world.fake.configUpdated({ language: 'de' });
  assert.equal(featureOf(deviceOf(world), 'power').name, 'Ein / Aus');
});
