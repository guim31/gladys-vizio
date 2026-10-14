// -----------------------------------------------------------------------------
// What the integration writes in its logs, and the timer that reads the
// devices. At the info level only the life cycle shows: a normal evening
// (reads, states, apps and inputs that change, a TV going to sleep in Eco
// mode and waking up) writes nothing, and a problem that lasts writes one
// line, then one when it is gone. The token never shows, even in debug.
// The core may never poll these devices (GladysAssistant/Gladys#3198): the
// container's own timer must read them, without any onPoll.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_CONFIGS,
  FakeVizio,
  TOKEN,
  TV_IP,
  createAll,
  createWorld,
  deviceOf,
  stateOf,
} from './helpers/world.js';

/** Every line the SDK logger writes (console.log for debug/info, console.error above). */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    if (previous === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = previous;
    }
  });
  const lines = [];
  const keep = (...args) => lines.push(args.map(String).join(' '));
  t.mock.method(console, 'log', keep);
  t.mock.method(console, 'error', keep);
  t.mock.method(console, 'warn', keep);
  t.mock.method(console, 'info', keep);
  return lines;
}

test('a normal evening writes nothing at the info level', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  const lines = captureLogs(t);
  for (let round = 0; round < 3; round += 1) {
    world.tv.volume = 20 + round;
    await world.hub.pollAll();
    world.tv.openApp(APP_CONFIGS.netflix);
    await world.hub.pollAll();
    world.tv.show('hdmi1');
    await world.hub.pollAll();
    world.tv.openApp(APP_CONFIGS.unknown);
    await world.hub.pollAll();
    // The night: standby, then asleep in Eco mode, read again and again.
    world.tv.power = false;
    await world.hub.pollAll();
    world.tv.online = false;
    for (let read = 0; read < 5; read += 1) {
      await world.hub.pollAll();
    }
    // The morning.
    world.tv.online = true;
    world.tv.power = true;
    world.tv.show('cast');
    await world.hub.pollAll();
  }
  assert.ok(world.fake.states.length > 10, 'states were published');
  assert.ok(world.fake.sceneEvents.length > 3, 'events were fired');
  assert.deepEqual(lines, []);
});

test('a problem that lasts: one line, then one when it is gone', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const lines = captureLogs(t);

  // The TV forgot Gladys (reset, or paired again by another client id).
  world.tv.tokens.clear();
  for (let read = 0; read < 4; read += 1) {
    await world.hub.pollAll();
  }
  // Asleep meanwhile: still the same problem, no new line.
  world.tv.online = false;
  await world.hub.pollAll();
  world.tv.online = true;
  await world.hub.pollAll();
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /\[WARN\].*Living Room TV \(192\.0\.2\.30\).*HTTP 403/);
  world.tv.tokens.add(TOKEN);
  await world.hub.pollAll();
  await world.hub.pollAll();
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[1], /\[INFO\].*Living Room TV .*: answers normally again/);

  // Gladys refuses the states (restarting): one warning, then one line back.
  lines.length = 0;
  const publishStates = world.gladys.publishStates.bind(world.gladys);
  world.gladys.publishStates = async () => {
    throw new Error('HTTP 503');
  };
  for (let read = 0; read < 4; read += 1) {
    world.tv.volume = 40 + read;
    await world.hub.pollAll();
  }
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /\[WARN\].*States of Living Room TV .* refused: HTTP 503/);
  world.gladys.publishStates = publishStates;
  await world.hub.pollAll();
  await world.hub.pollAll();
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[1], /\[INFO\].*States: working again/);
  assert.equal(stateOf(world, 'volume'), 43);
});

test('a typed address that does not answer: one warning, one line when it answers', async (t) => {
  const tv = new FakeVizio({ kind: 'soundbar' });
  tv.online = false;
  const world = await createWorld({
    devices: { '192.0.2.40': tv },
    config: { language: 'en', hosts: '192.0.2.40' },
    mdns: false,
    connect: false,
  });
  t.after(() => world.app.stop());
  const lines = captureLogs(t);
  await world.gladys.connect();
  await world.app.ready;
  for (let read = 0; read < 4; read += 1) {
    world.clock.advance(60_000);
    await world.hub.pollAll();
  }
  const about = () => lines.filter((line) => /192\.0\.2\.40/.test(line));
  assert.equal(about().length, 1, lines.join('\n'));
  assert.match(about()[0], /\[WARN\].*192\.0\.2\.40.*does not answer/);
  tv.online = true;
  world.clock.advance(60_000);
  await world.hub.pollAll();
  await world.hub.pollAll();
  assert.equal(about().length, 3, lines.join('\n'));
  assert.match(about()[1], /\[INFO\].*192\.0\.2\.40: answers now/);
  assert.match(about()[2], /\[INFO\].*Found VIZIO sound bar/);
});

test('neither the token nor the PIN ever shows in the logs, even in debug', async (t) => {
  const tv = new FakeVizio({ pin: '8135' });
  const world = await createWorld({ devices: { [TV_IP]: tv }, config: { language: 'en' } });
  t.after(() => world.app.stop());
  const lines = captureLogs(t, 'debug');
  await world.fake.action('start_pairing', {});
  await world.fake.action('finish_pairing', { pin: '0000' });
  const ack = await world.fake.action('finish_pairing', { pin: '8135' });
  assert.equal(ack.success, true, ack.error);
  await createAll(world);
  for (let read = 0; read < 3; read += 1) {
    await world.hub.pollAll();
  }
  tv.tokens.clear();
  await world.hub.pollAll();
  const { token } = world.hub.records.get(tv.serial);
  assert.ok(token, 'paired');
  assert.ok(lines.length > 3, `debug lines were written: ${lines.join('\n')}`);
  for (const line of lines) {
    assert.ok(!line.includes(token), `token in: ${line}`);
    assert.ok(!line.includes('8135'), `PIN in: ${line}`);
  }
});

test('the container reads the devices on its own timer, without any poll from Gladys', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const world = await createWorld({ timers: true });
  t.after(() => world.app.stop());
  await createAll(world);
  const device = deviceOf(world);
  // Published for a core that would poll, but nothing here calls `fake.poll`.
  assert.equal(device.should_poll, true);
  assert.equal(stateOf(world, 'volume'), 23);
  const settle = async (key, value) => {
    for (let turn = 0; turn < 200 && stateOf(world, key) !== value; turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  world.tv.volume = 33;
  t.mock.timers.tick(world.hub.config.pollIntervalMs);
  await settle('volume', 33);
  assert.equal(stateOf(world, 'volume'), 33);
  // And again at the next interval: the timer is set again after each read.
  world.tv.openApp(APP_CONFIGS.netflix);
  t.mock.timers.tick(world.hub.config.pollIntervalMs);
  await settle('app', 'Netflix');
  assert.equal(stateOf(world, 'app'), 'Netflix');
  assert.equal(
    world.fake.requests.filter((request) => request.path.includes('poll')).length,
    0,
    'no poll from the core',
  );
});

test("the core's poll, when it comes, does not read a device the timer just read", async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const device = deviceOf(world);
  const before = world.tv.requests.length;
  assert.deepEqual(await world.fake.poll(device), { success: true });
  assert.equal(world.tv.requests.length, before, 'read less than a period ago: skipped');
  world.clock.advance(world.hub.config.pollIntervalMs);
  world.tv.volume = 51;
  assert.deepEqual(await world.fake.poll(device), { success: true });
  assert.equal(stateOf(world, 'volume'), 51);
});
