// -----------------------------------------------------------------------------
// The dashboard widgets: every content fits the core's vocabulary and budget
// (validateWidgetContent of the SDK), in every state of a device, and the
// buttons do what they say.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_KEYS } from '../src/hub.js';
import { chosenKeys } from '../src/widgets.js';
import {
  APP_CONFIGS,
  FakeVizio,
  SOUNDBAR_IP,
  TV_IP,
  createWorld,
  deviceOf,
} from './helpers/world.js';

const LANGS = ['en', 'fr', 'de', 'es'];

async function contents(world, settings = {}) {
  const all = [];
  for (const key of Object.values(WIDGET_KEYS)) {
    for (const language of LANGS) {
      const ack = await world.fake.widgetGet(key, { settings, language });
      assert.equal(ack.success, true, `${key}: ${ack.error}`);
      all.push({ key, language, content: ack.data.content });
    }
  }
  return all;
}

function assertValid(list, where) {
  for (const { key, language, content } of list) {
    assert.deepEqual(validateWidgetContent(content), [], `${where} ${key} ${language}`);
  }
}

test('every widget content fits the core vocabulary, in every state and language', async (t) => {
  const world = await createWorld({
    devices: {
      [TV_IP]: new FakeVizio({ tokens: ['Zm9vYmFyMTIz'] }),
      [SOUNDBAR_IP]: new FakeVizio({ kind: 'soundbar' }),
    },
    saved: {
      devices: {
        LTMTEST24A00001: { host: TV_IP, port: 7345, kind: 'tv', token: 'Zm9vYmFyMTIz' },
      },
    },
  });
  t.after(() => world.app.stop());
  assertValid(await contents(world), 'on');
  world.tv.openApp(APP_CONFIGS.netflix);
  await world.hub.pollAll();
  assertValid(await contents(world, { shortcut_1: 'Netflix', shortcut_2: 'PS9' }), 'netflix');
  world.tv.power = false;
  await world.hub.pollAll();
  assertValid(await contents(world), 'standby');
  world.tv.online = false;
  await world.hub.pollAll();
  assertValid(await contents(world), 'asleep');
  const bar = world.fake.discoveredDevices.find((device) => device.name.includes('Sound Bar'));
  assertValid(await contents(world, { device: bar.external_id }), 'sound bar');
  assertValid(await contents(world, { device: 'ext:test-integration:smartcast:GONE' }), 'gone');
});

test('without any published device, the widgets explain what to do', async (t) => {
  const world = await createWorld({ devices: { [TV_IP]: new FakeVizio() } });
  t.after(() => world.app.stop());
  const ack = await world.fake.widgetGet(WIDGET_KEYS.REMOTE, { language: 'fr' });
  assert.match(ack.data.content.components[0].text, /appairez un téléviseur/);
  assertValid(await contents(world), 'none');
});

test('remote: state, what plays, volume; its four buttons act on the TV', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.tv.openApp(APP_CONFIGS.netflix);
  await world.hub.pollAll();
  const ack = await world.fake.widgetGet(WIDGET_KEYS.REMOTE, { language: 'en' });
  const [status, ...buttons] = ack.data.content.components;
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value]),
    [
      ['Living Room TV', 'On'],
      ['Now playing', 'Netflix'],
      ['Volume', 23],
    ],
  );
  assert.deepEqual(
    buttons.map((button) => button.action.key),
    ['power', 'volume_down', 'volume_up', 'mute'],
  );
  await world.fake.widgetAction(WIDGET_KEYS.REMOTE, 'volume_up', {});
  assert.equal(world.tv.volume, 25);
  await world.fake.widgetAction(WIDGET_KEYS.REMOTE, 'mute', {});
  assert.equal(world.tv.muted, true);
  const muted = await world.fake.widgetGet(WIDGET_KEYS.REMOTE, { language: 'en' });
  assert.equal(muted.data.content.components.at(-1).icon, 'check-circle');
  const off = await world.fake.widgetAction(WIDGET_KEYS.REMOTE, 'power', { on: false });
  assert.equal(world.tv.power, false);
  assert.match(off.data.message.fr, /Living Room TV éteint/);
});

test('shortcuts: the favorite apps by default, typed names otherwise, the current one checked', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.tv.rename('hdmi1', 'Xbox');
  world.clock.advance(world.hub.timings.inputsMs);
  await world.hub.pollAll();
  let ack = await world.fake.widgetGet(WIDGET_KEYS.SHORTCUTS, { language: 'en' });
  assert.deepEqual(
    ack.data.content.components.filter((c) => c.type === 'button').map((c) => c.label),
    ['Netflix', 'YouTube', 'Prime Video', 'Disney+'],
  );
  const settings = { shortcut_1: 'xbox', shortcut_2: 'hulu', shortcut_3: 'Nope' };
  ack = await world.fake.widgetGet(WIDGET_KEYS.SHORTCUTS, { settings, language: 'en' });
  const buttons = ack.data.content.components.filter((c) => c.type === 'button');
  assert.deepEqual(
    buttons.map((c) => c.label),
    ['Xbox', 'Hulu'],
  );
  assert.match(ack.data.content.components.find((c) => c.type === 'text').text, /Not found: Nope/);
  const done = await world.fake.widgetAction(
    WIDGET_KEYS.SHORTCUTS,
    buttons[1].action.key,
    buttons[1].action.params,
    { settings },
  );
  assert.match(done.data.message.en, /Hulu on screen/);
  assert.equal(world.tv.app.APP_ID, '3');
  await world.hub.pollAll();
  ack = await world.fake.widgetGet(WIDGET_KEYS.SHORTCUTS, { settings, language: 'en' });
  assert.equal(
    ack.data.content.components.filter((c) => c.type === 'button')[1].icon,
    'check-circle',
  );
  await world.fake.widgetAction(WIDGET_KEYS.SHORTCUTS, 'shortcut_1', buttons[0].action.params, {
    settings,
  });
  assert.equal(world.tv.input, 'hdmi1');
});

test('keys: the four chosen keys, only those a sound bar has', async (t) => {
  assert.deepEqual(chosenKeys({ key_2: 'ok', key_3: 'nope' }), ['up', 'ok', 'left', 'right']);
  const bar = new FakeVizio({ kind: 'soundbar' });
  const world = await createWorld({ devices: { [SOUNDBAR_IP]: bar } });
  t.after(() => world.app.stop());
  const settings = { device: deviceOf(world).external_id, key_1: 'play', key_2: 'menu' };
  const ack = await world.fake.widgetGet(WIDGET_KEYS.KEYS, { settings, language: 'de' });
  const buttons = ack.data.content.components.filter((c) => c.type === 'button');
  assert.deepEqual(
    buttons.map((c) => c.label),
    ['Abspielen'],
  );
  await world.fake.widgetAction(WIDGET_KEYS.KEYS, 'key_1', buttons[0].action.params, { settings });
  assert.equal(bar.keys.at(-1), '2,3');
});
