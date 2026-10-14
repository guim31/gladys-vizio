// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// The devices themselves are not configured here: the core's mDNS discovery
// finds them, the addresses field only adds those it cannot see. A TV's token
// comes from the pairing actions and lives under /data (src/store.js).
// -----------------------------------------------------------------------------

import { findApp } from './vizio/apps.js';

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['10', '15', '30'];

// Steps of the volume buttons (feature, widget), in volume units.
export const VOLUME_STEPS = ['1', '2', '5'];

export const DEFAULT_CONFIG = {
  hosts: '',
  favorite_apps: 'Netflix, YouTube, Prime Video, Disney+, Hulu, Apple TV+',
  poll_interval: '10',
  volume_step: '2',
  language: 'fr',
};

// At most this many apps in the app list of a TV.
export const MAX_FAVORITE_APPS = 12;

const HOST =
  /^(?:\d{1,3}(?:\.\d{1,3}){3}|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)$/i;

/**
 * One address typed by the user: `192.0.2.30`, `192.0.2.30:9000`,
 * `vizio-tv.local`, or a pasted `https://192.0.2.30:7345/`.
 * @returns {{ host: string, port: number|null }|null} null when unusable
 */
export function parseHost(raw) {
  let entry = String(raw ?? '').trim();
  if (!entry) {
    return null;
  }
  entry = entry.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  // Credentials in an address would end up in the logs.
  if (entry.includes('@')) {
    return null;
  }
  const match = entry.match(/^([^:]+)(?::(\d{1,5}))?$/);
  if (!match || !HOST.test(match[1])) {
    return null;
  }
  if (/^\d+(\.\d+){3}$/.test(match[1]) && match[1].split('.').some((part) => Number(part) > 255)) {
    return null;
  }
  const port = match[2] === undefined ? null : Number(match[2]);
  if (port !== null && (port < 1 || port > 65535)) {
    return null;
  }
  return { host: match[1].toLowerCase(), port };
}

/**
 * The addresses field: commas, semicolons or spaces separate the entries.
 * @returns {{ hosts: Array<{ host: string, port: number|null }>, invalid: string[] }}
 */
export function parseHosts(raw) {
  const hosts = [];
  const invalid = [];
  for (const entry of String(raw ?? '')
    .split(/[\s,;]+/)
    .filter(Boolean)) {
    const parsed = parseHost(entry);
    if (!parsed) {
      invalid.push(entry.slice(0, 60));
    } else if (!hosts.some((known) => known.host === parsed.host)) {
      hosts.push(parsed);
    }
  }
  return { hosts, invalid };
}

/**
 * The favorite apps: names of the catalog, typed loosely ("disney plus"),
 * separated by commas. Unknown names are reported, not kept.
 * @returns {{ apps: string[], unknown: string[] }} catalog names
 */
export function parseFavoriteApps(raw) {
  const apps = [];
  const unknown = [];
  for (const entry of String(raw ?? '')
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)) {
    const app = findApp(entry);
    if (!app) {
      unknown.push(entry.slice(0, 40));
    } else if (!apps.includes(app.name) && apps.length < MAX_FAVORITE_APPS) {
      apps.push(app.name);
    }
  }
  return { apps, unknown };
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };
  const { hosts, invalid } = parseHosts(source.hosts ?? DEFAULT_CONFIG.hosts);
  const favorites = parseFavoriteApps(
    typeof source.favorite_apps === 'string' ? source.favorite_apps : DEFAULT_CONFIG.favorite_apps,
  );
  return {
    hosts,
    invalidHosts: invalid,
    favoriteApps: favorites.apps,
    unknownApps: favorites.unknown,
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    volumeStep: Number(pick('volume_step', VOLUME_STEPS)),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
