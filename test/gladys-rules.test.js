// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures (the captures of a real VIZIO TV published by vizaio, and devices
// built in their shape): a recent TV and an older one, on SmartCast, on an
// HDMI input renamed on the TV, in an app, in standby, asleep in Eco mode, a
// sound bar — in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys". The
// option lists follow the core's normalizeSupportedOptions (unique values,
// non-empty labels, strings on text/select only).
// Do not loosen this test to make it pass: fix the integration.
// (Adapted from guim31/gladys-wled and guim31/gladys-sony-bravia.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PUSH_KEYS } from '../src/devices.js';
import {
  APP_CONFIGS,
  FakeVizio,
  SOUNDBAR_IP,
  TOKEN,
  TV_IP,
  createWorld,
  pairedTv,
} from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const OLD_TV_IP = '192.0.2.32';
const ASLEEP_IP = '192.0.2.33';

const saved = (devices) => ({
  clientId: 'gladys-0a1b2c3d',
  devices: Object.fromEntries(
    Object.entries(devices)
      .filter(([, device]) => device.kind === 'tv')
      .map(([ip, device]) => [
        device.serial,
        { host: ip, port: device.port, kind: 'tv', token: TOKEN },
      ]),
  ),
});

const scenarios = [
  {
    label: 'a recent TV on SmartCast Home',
    devices: () => ({ [TV_IP]: pairedTv() }),
  },
  {
    label: 'a recent TV in Netflix',
    devices: () => {
      const tv = pairedTv();
      tv.openApp(APP_CONFIGS.netflix);
      return { [TV_IP]: tv };
    },
  },
  {
    label: 'a TV on an HDMI input renamed on the TV, an app not in the catalog before',
    devices: () => {
      const tv = pairedTv();
      tv.rename('hdmi2', 'PS5');
      tv.show('hdmi2');
      return { [TV_IP]: tv };
    },
  },
  {
    label: 'an older TV (no /state_extended, serial in the settings) in standby',
    devices: () => ({
      [OLD_TV_IP]: pairedTv({ firmware: 'legacy', serial: 'LTMTEST19B00002', power: false }),
    }),
  },
  {
    label: 'a sound bar',
    devices: () => ({ [SOUNDBAR_IP]: new FakeVizio({ kind: 'soundbar' }) }),
  },
  ...['en', 'fr', 'de', 'es'].map((language) => ({
    label: `two TVs, one asleep in Eco mode, and a sound bar, names in ${language}`,
    language,
    devices: () => {
      const asleep = pairedTv({
        serial: 'LTMTEST22C00003',
        name: 'Bedroom TV',
        powerMode: 'Eco Mode',
      });
      asleep.online = false;
      const tv = pairedTv();
      tv.openApp(APP_CONFIGS.unknown);
      return {
        [TV_IP]: tv,
        [ASLEEP_IP]: asleep,
        [SOUNDBAR_IP]: new FakeVizio({ kind: 'soundbar' }),
      };
    },
  })),
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const devices = scenario.devices();
    // The asleep TV was found and paired on another day: it is in /data.
    const asleepTv = devices[ASLEEP_IP];
    const state = saved(devices);
    if (asleepTv) {
      state.devices[asleepTv.serial].identity = { model: asleepTv.model, name: asleepTv.name };
    }
    const { gladys, app } = await createWorld({
      devices,
      saved: state,
      config: { language: scenario.language ?? 'en', hosts: `${OLD_TV_IP}` },
    });
    try {
      const discovered = gladys.fake.discoveredDevices;
      assert.equal(discovered.length, Object.keys(devices).length);
      assert.equal(new Set(discovered.map((device) => device.external_id)).size, discovered.length);

      for (const device of discovered) {
        const where = device.name;

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }
        for (const param of device.params ?? []) {
          assert.ok(!/^GLADYS_/i.test(param.name), `${where}: reserved param ${param.name}`);
          assert.equal(typeof param.value, 'string');
          assert.ok(!param.value.includes(TOKEN), `${where}: the token is not a param`);
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);

          // The option lists, as the core's normalizeSupportedOptions wants them.
          const isSelect = feature.category === 'text' && feature.type === 'select';
          if (feature.supported_options !== undefined) {
            assert.ok(isSelect, `${at}: string options belong to text/select features only`);
            assert.ok(feature.supported_options.length > 0, `${at}: no option`);
            const values = feature.supported_options.map((option) => `${option.value}`);
            assert.equal(new Set(values).size, values.length, `${at}: duplicate option values`);
            for (const option of feature.supported_options) {
              assert.ok(
                typeof option.value === 'string' && option.value.trim().length > 0,
                `${at}: option value`,
              );
              assert.ok(
                typeof option.label === 'string' && option.label.trim().length > 0,
                `${at}: option label`,
              );
              assert.ok(Number.isInteger(option.sort_order), `${at}: option sort_order`);
            }
          } else {
            assert.ok(!isSelect, `${at}: a select without options`);
          }

          // The value published from the fixtures fits the feature.
          const key = feature.external_id.slice(device.external_id.length + 1);
          const value = gladys.fake.lastState(feature.external_id);
          if (PUSH_KEYS.has(key)) {
            assert.equal(value, undefined, `${at}: a push button has no state`);
            assert.equal(feature.read_only, false, `${at}: a push button is writable`);
            continue;
          }
          if (value === undefined) {
            // Volume, input, app and modes say nothing while off.
            assert.ok(
              ['volume', 'input', 'app', 'picture_mode', 'sound_mode'].includes(key),
              `${at}: no state published`,
            );
            continue;
          }
          if (feature.category === 'text') {
            assert.equal(typeof value, 'string', `${at}: ${value} is not a text`);
            assert.ok(value.trim().length > 0, `${at}: empty text`);
            if (isSelect) {
              assert.ok(
                feature.supported_options.some((option) => option.value === value),
                `${at}: ${value} is not one of the options`,
              );
            }
          } else {
            assert.equal(typeof value, 'number', `${at}: ${value} is not a number`);
            assert.ok(
              value >= feature.min && value <= feature.max,
              `${at}: ${value} out of bounds`,
            );
            assert.ok(Number.isInteger(value), `${at}: ${value} is not an integer`);
          }
        }
      }
    } finally {
      await app.stop();
    }
  });
}
