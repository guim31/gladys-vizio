// -----------------------------------------------------------------------------
// The configuration: addresses, favorite apps, choices, defaults.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  MAX_FAVORITE_APPS,
  normalizeConfig,
  parseFavoriteApps,
  parseHost,
  parseHosts,
} from '../src/config.js';

test('an address: IP, IP and port, host name, pasted URL; never credentials', () => {
  assert.deepEqual(parseHost('192.0.2.30'), { host: '192.0.2.30', port: null });
  assert.deepEqual(parseHost(' 192.0.2.30:9000 '), { host: '192.0.2.30', port: 9000 });
  assert.deepEqual(parseHost('https://192.0.2.30:7345/state'), { host: '192.0.2.30', port: 7345 });
  assert.deepEqual(parseHost('Vizio-TV.local'), { host: 'vizio-tv.local', port: null });
  for (const bad of [
    '',
    'user:pass@192.0.2.30',
    '300.1.1.1',
    '192.0.2.30:99999',
    'a b',
    'http://',
  ]) {
    assert.equal(parseHost(bad), null, bad);
  }
});

test('the addresses field: separators, duplicates, invalid entries', () => {
  const { hosts, invalid } = parseHosts('192.0.2.30, 192.0.2.31;192.0.2.30 nope!');
  assert.deepEqual(
    hosts.map((entry) => entry.host),
    ['192.0.2.30', '192.0.2.31'],
  );
  assert.deepEqual(invalid, ['nope!']);
});

test('favorite apps: catalog names, loose spelling, unknown ones reported, at most 12', () => {
  assert.deepEqual(parseFavoriteApps('netflix, disney plus, Nope TV, Netflix'), {
    apps: ['Netflix', 'Disney+'],
    unknown: ['Nope TV'],
  });
  const many = parseFavoriteApps(
    'Netflix,YouTube,Hulu,Plex,Tubi,Vudu,Crackle,Pandora,Peacock,PBS,NBC,STARZ,Shudder,XUMO',
  );
  assert.equal(many.apps.length, MAX_FAVORITE_APPS);
  assert.deepEqual(parseFavoriteApps(DEFAULT_CONFIG.favorite_apps).unknown, []);
});

test('normalized configuration: defaults, and unknown choices fall back', () => {
  const config = normalizeConfig({});
  assert.deepEqual(config.hosts, []);
  assert.equal(config.pollIntervalMs, 10_000);
  assert.equal(config.volumeStep, 2);
  assert.equal(config.language, 'fr');
  assert.equal(config.favoriteApps[0], 'Netflix');
  const other = normalizeConfig({
    poll_interval: '7',
    volume_step: 5,
    language: 'it',
    favorite_apps: '',
  });
  assert.equal(other.pollIntervalMs, 10_000);
  assert.equal(other.volumeStep, 5);
  assert.equal(other.language, 'fr');
  assert.deepEqual(other.favoriteApps, []);
  assert.equal(normalizeConfig(null).language, 'fr');
});
