// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACTION_KEYS } from '../src/app.js';
import { DEFAULT_CONFIG, LANGUAGES, POLL_INTERVALS, VOLUME_STEPS } from '../src/config.js';
import { CONTENT_KINDS, TRIGGERS, WIDGET_KEYS } from '../src/hub.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { KEY_LABELS, KEY_NAMES } from '../src/vizio/keys.js';
import { DEFAULT_KEYS, WIDGETS } from '../src/widgets.js';
import { APP_CONFIGS, createWorld, deviceOf } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const CAPABILITY_FIELDS = ['scene_triggers', 'scene_actions', 'widgets'];
const CAPABILITY_MIN_GLADYS_VERSION = [5, 1, 0];
const CATEGORIES_MIN_GLADYS_VERSION = [4, 86, 0];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('identity: name, image, cover, local transport, multimedia, mDNS discovery', () => {
  assert.equal(manifest.name, 'VIZIO SmartCast');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-vizio:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-vizio/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['multimedia']);
  // The SmartCast devices announce themselves in mDNS, which only the core sees.
  assert.deepEqual(manifest.network_discovery, [{ type: 'mdns', service: '_viziocast._tcp' }]);
  // No Wake-on-LAN: a VIZIO TV asleep in Eco mode does not wake on it (docs).
  assert.equal(manifest.network_wake, undefined);
});

test('every manifest action has a handler', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.deepEqual(keysOf(manifest.actions).sort(), Object.values(ACTION_KEYS).sort());
  const ack = await world.fake.action(ACTION_KEYS.TEST_CONNECTION, {});
  assert.equal(ack.success, true, ack.error);
  // Without a TV waiting for pairing, the pairing actions answer with a sentence.
  const start = await world.fake.action(ACTION_KEYS.START_PAIRING, {});
  assert.equal(start.success, true, start.error);
  const finish = await world.fake.action(ACTION_KEYS.FINISH_PAIRING, { pin: '0000' });
  assert.equal(finish.success, false);
  assert.match(finish.error, /Wrong PIN|No pairing/);
});

test('declaring catalog categories requires Gladys >= 4.86.0', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(isAtLeast(minGladysVersion(), CATEGORIES_MIN_GLADYS_VERSION));
});

test('declaring scene triggers, scene actions or widgets requires Gladys >= 5.1.0', () => {
  const declared = CAPABILITY_FIELDS.filter((field) => manifest[field] !== undefined);
  assert.deepEqual(declared, CAPABILITY_FIELDS);
  assert.ok(isAtLeast(minGladysVersion(), CAPABILITY_MIN_GLADYS_VERSION));
  // No widget button opens a form (Gladys#3168, 5.2.0): 5.1.0 is enough.
  assert.equal(manifest.gladys_version, '>=5.1.0');
});

test('every scene_actions key has a handler, and returns the declared outputs', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
  const world = await createWorld();
  t.after(() => world.app.stop());
  const fields = {
    open_app: { app: 'Netflix' },
    select_input: { input: 'HDMI-1' },
    send_key: { key: 'home', repeat: 1 },
  };
  for (const action of manifest.scene_actions) {
    const ack = await world.fake.sceneAction(action.key, {
      device: deviceOf(world).external_id,
      ...fields[action.key],
    });
    assert.equal(ack.success, true, `${action.key}: ${ack.error}`);
    assert.deepEqual(
      Object.keys(ack.data.outputs).sort(),
      keysOf(action.outputs).sort(),
      `${action.key} outputs`,
    );
  }
});

test('the key lists of the scene action and the widget are the keys of the code', () => {
  const sendKey = manifest.scene_actions.find((action) => action.key === 'send_key');
  const lists = [
    sendKey.fields.find((field) => field.key === 'key').options,
    ...manifest.widgets
      .find((widget) => widget.key === WIDGET_KEYS.KEYS)
      .settings.filter((field) => field.key.startsWith('key_'))
      .map((field) => field.options),
  ];
  for (const options of lists) {
    assert.deepEqual(
      options.map((option) => option.value),
      KEY_NAMES,
    );
    for (const option of options) {
      assert.deepEqual(option.label, KEY_LABELS[option.value]);
    }
  }
  const defaults = manifest.widgets
    .find((widget) => widget.key === WIDGET_KEYS.KEYS)
    .settings.filter((field) => field.key.startsWith('key_'))
    .map((field) => field.default);
  assert.deepEqual(defaults, DEFAULT_KEYS);
  const repeat = sendKey.fields.find((field) => field.key === 'repeat');
  assert.deepEqual([repeat.min, repeat.max, repeat.default], [1, 10, 1]);
});

test('the scene trigger is the one the hub fires, with its filters and variables', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_triggers), Object.values(TRIGGERS));
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.tv.openApp(APP_CONFIGS.netflix);
  await world.hub.pollAll();
  const [event] = world.fake.sceneEvents;
  assert.equal(event.key, TRIGGERS.CONTENT_CHANGED);
  const [trigger] = manifest.scene_triggers;
  for (const key of [...keysOf(trigger.fields), ...keysOf(trigger.variables)]) {
    assert.ok(key in event.data, `"${key}" is in the event data`);
  }
  for (const key of Object.keys(event.data)) {
    assert.ok(
      keysOf(trigger.variables).includes(key) || keysOf(trigger.fields).includes(key),
      `"${key}" is declared`,
    );
  }
  const options = trigger.fields
    .find((field) => field.key === 'kind')
    .options.map((option) => option.value);
  assert.deepEqual(options.sort(), Object.values(CONTENT_KINDS).sort());
});

test('every widgets key has a handler', async (t) => {
  assert.deepEqual(keysOf(manifest.widgets), Object.values(WIDGET_KEYS));
  assert.deepEqual(Object.keys(WIDGETS), Object.values(WIDGET_KEYS));
  const world = await createWorld();
  t.after(() => world.app.stop());
  for (const key of Object.values(WIDGET_KEYS)) {
    const ack = await world.fake.widgetGet(key, { settings: {} });
    assert.equal(ack.success, true, ack.error);
  }
});

test('config_schema defaults and options stay consistent with the code', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(
        DEFAULT_CONFIG[field.key],
        field.default,
        `DEFAULT_CONFIG.${field.key} must match the manifest default`,
      );
    }
  }
  const options = (key) =>
    manifest.config_schema.find((f) => f.key === key).options.map((o) => o.value);
  assert.deepEqual(options('language'), LANGUAGES);
  assert.deepEqual(options('poll_interval'), POLL_INTERVALS);
  assert.deepEqual(options('volume_step'), VOLUME_STEPS);
  assert.deepEqual(
    Object.keys(DEFAULT_CONFIG).sort(),
    manifest.config_schema
      .filter((f) => f.type !== 'section')
      .map((f) => f.key)
      .sort(),
  );
  assert.equal(DEFAULT_CONFIG.language, 'fr');
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0);
  for (const section of sections) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  const dynamicSelects = allFields.filter((f) => f.source !== undefined);
  assert.ok(dynamicSelects.length > 0);
  for (const field of dynamicSelects) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined);
  }
});

test('number fields have integer bounds and defaults (the form has no step)', () => {
  for (const field of allFields.filter((f) => f.type === 'number')) {
    for (const key of ['min', 'max', 'default']) {
      if (field[key] !== undefined) {
        assert.ok(Number.isInteger(field[key]), `field "${field.key}".${key} must be an integer`);
      }
    }
  }
});

test('actions declare no secret field, no required field (no default is applied)', () => {
  // Gladys#3154/#3155: a secret in an action form cannot be filled, and an
  // action applies no default while enforcing `required`.
  for (const action of manifest.actions ?? []) {
    for (const field of action.fields ?? []) {
      assert.notEqual(field.type, 'secret');
      assert.notEqual(field.required, true);
    }
  }
});

test('widget settings hold no secret, at most 10 fields', () => {
  for (const widget of manifest.widgets) {
    assert.ok(widget.settings.length <= 10, `${widget.key}: too many settings`);
    for (const field of widget.settings) {
      assert.ok(['string', 'number', 'boolean', 'select', 'multi_select'].includes(field.type));
    }
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${lang} has ${text.length} characters (10 to 100 allowed)`,
    );
  }
});
