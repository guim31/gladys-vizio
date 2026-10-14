// -----------------------------------------------------------------------------
// The readers of the SmartCast answers, on the captures of a real TV
// (test/fixtures/vizio/, from vizaio) and on the shapes older firmware sends.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isAppInput,
  lowerKeys,
  matchInput,
  parseCurrentApp,
  parseCurrentInput,
  parseDeviceInfo,
  parseEnvelope,
  parseInputs,
  parsePowerMode,
  parseSetting,
  parseSettingOptions,
  parseStateExtended,
} from '../src/vizio/model.js';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/vizio/${name}.json`, import.meta.url), 'utf8'));
const env = (name) => parseEnvelope(fixture(name));

test('the envelope is read whatever the case of its keys', () => {
  const upper = parseEnvelope({ STATUS: { RESULT: 'SUCCESS' }, ITEMS: [{ CNAME: 'x', VALUE: 1 }] });
  const lower = parseEnvelope({ status: { result: 'success' }, items: [{ cname: 'x', value: 1 }] });
  assert.deepEqual(upper.items, lower.items);
  assert.equal(upper.result, 'success');
  assert.equal(parseEnvelope({ hello: 1 }), null);
  assert.equal(env('esn_modern_404').result, 'uri_not_found');
  assert.deepEqual(lowerKeys({ A: [{ B: 'C' }] }), { a: [{ b: 'C' }] });
});

test('the device info of a real TV: serial, model, name, capabilities', () => {
  const info = parseDeviceInfo(env('device_info'));
  assert.equal(info.serial, 'LTMTEST24A00001');
  assert.equal(info.model, 'VHD24M-0810');
  assert.equal(info.name, 'Living Room TV');
  assert.equal(info.kind, 'tv');
  assert.equal(info.stateExtended, true);
  assert.equal(info.tuner, true);
  assert.equal(info.firmware, '3.720.9.1-1');
  assert.deepEqual(info.pictureModes.slice(0, 2), ['Vivid', 'Bright']);
});

test('a sound bar, and older firmware without capabilities', () => {
  const json = fixture('device_info');
  const value = json.ITEMS[0].VALUE;
  value.SETTINGS_ROOT = 'audio_settings';
  delete value.SCPL_CAPABILITIES;
  delete value.SYSTEM_INFO.SERIAL_NUMBER;
  const info = parseDeviceInfo(parseEnvelope(json));
  assert.equal(info.kind, 'soundbar');
  assert.equal(info.stateExtended, null);
  assert.equal(info.serial, null);
});

test('power, current input, inputs, current app of a real TV', () => {
  assert.equal(parsePowerMode(env('power_mode')), true);
  assert.deepEqual(parseCurrentInput(env('current_input')), {
    value: 'SMARTCAST',
    hashval: 2023834057,
  });
  const inputs = parseInputs(env('inputs'));
  assert.deepEqual(
    inputs.map((input) => input.cname),
    ['cast', 'hdmi1', 'hdmi2', 'comp', 'tuner'],
  );
  assert.deepEqual(inputs[1], { cname: 'hdmi1', name: 'HDMI-1', meta: 'HDMI-1', label: 'HDMI-1' });
  // The cast input keeps its display name, not "SMARTCAST".
  assert.equal(inputs[0].label, 'CAST');
  assert.equal(inputs[0].meta, 'SMARTCAST');
  assert.deepEqual(parseCurrentApp(env('current_app')), {
    appId: '1',
    nameSpace: 4,
    message: '{"app":"home","bundle":"bundles/home"}',
  });
  assert.equal(
    parseCurrentApp(parseEnvelope({ STATUS: { RESULT: 'SUCCESS' }, ITEM: { VALUE: null } })),
    null,
  );
});

test('a current input value matches its input by cname, name or the name set on the TV', () => {
  const json = fixture('inputs');
  json.ITEMS[2].VALUE.NAME = 'PS5';
  const inputs = parseInputs(parseEnvelope(json));
  assert.equal(inputs[2].label, 'PS5');
  // The TV reports a renamed HDMI input by its display name.
  assert.equal(matchInput(inputs, 'HDMI-2').cname, 'hdmi2');
  assert.equal(matchInput(inputs, 'PS5').cname, 'hdmi2');
  assert.equal(matchInput(inputs, 'SMARTCAST').cname, 'cast');
  assert.equal(matchInput(inputs, 'hdmi1').cname, 'hdmi1');
  assert.equal(matchInput(inputs, 'nothing'), null);
  assert.ok(isAppInput('SMARTCAST') && isAppInput('cast') && !isAppInput('HDMI-1'));
});

test('state_extended: power, power mode, input and app in one answer', () => {
  assert.deepEqual(parseStateExtended(fixture('state_extended')), {
    power: true,
    powerMode: 'Quick Start',
    input: 'SMARTCAST',
    app: { appId: '1', nameSpace: 4, message: '{"app":"home","bundle":"bundles/home"}' },
  });
});

test('settings: values, hashvals, bounds and choices', () => {
  assert.deepEqual(parseSetting(env('settings_audio_volume'), 'volume'), {
    value: 23,
    hashval: 3662031975,
    type: 'T_VALUE_V1',
  });
  assert.equal(parseSetting(env('settings_audio'), 'mute').value, 'Off');
  const options = parseSettingOptions(env('static_audio'));
  assert.deepEqual(options.volume, { min: 0, max: 100 });
  assert.deepEqual(options.mute, { choices: ['Off', 'On'] });
  assert.equal(options.eq, undefined);
});
