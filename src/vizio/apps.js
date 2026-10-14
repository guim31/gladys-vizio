// -----------------------------------------------------------------------------
// The SmartCast apps. A SmartCast TV has no "list of installed apps" request:
// an app is launched by its configuration (APP_ID, NAME_SPACE, MESSAGE) and
// the app in front is reported the same way. Both directions go through the
// catalog of known apps of pyvizio (src/vizio/apps.json, MIT, Copyright (c)
// 2017 Vlad Korniev), the list Home Assistant offers too.
//
// Matching rules (pyvizio, confirmed by vizaio on hardware):
//   - an exact APP_ID + NAME_SPACE match;
//   - NAME_SPACE 2 and 4 are the same namespace on different firmware;
//   - NAME_SPACE 0 is a Google Cast session ("Cast"), whatever the APP_ID;
//   - APP_ID "1" in NAME_SPACE 4 is the SmartCast home screen.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const CATALOG = JSON.parse(readFileSync(new URL('./apps.json', import.meta.url), 'utf8'));

export const HOME_APP = Object.freeze({
  name: 'SmartCast Home',
  config: { appId: '1', nameSpace: 4, message: 'http://127.0.0.1:12345/scfs/sctv/main.html' },
});

/** The name reported for a Google Cast session (NAME_SPACE 0). */
export const CAST_APP_NAME = 'Cast';

const EQUIVALENT_NAME_SPACES = [2, 4];

/** Every app of the catalog: `{ name, config: [{ appId, nameSpace, message }] }`, home first. */
export const APPS = [
  { name: HOME_APP.name, config: [HOME_APP.config] },
  ...CATALOG.map((app) => ({
    name: String(app.name),
    config: (Array.isArray(app.config) ? app.config : [app.config]).map((config) => ({
      appId: String(config.APP_ID),
      nameSpace: Number(config.NAME_SPACE),
      message: config.MESSAGE ?? null,
    })),
  })),
];

const sameId = (a, b) => String(a.appId) === String(b.appId);

/**
 * The name of the app a device reports in front.
 * @param {{ appId: string, nameSpace: number }|null} config
 * @returns {string|null} the catalog name, `Cast`, or null (unknown app / no app)
 */
export function appNameOf(config) {
  if (!config || config.appId === null) {
    return null;
  }
  for (const app of APPS) {
    if (
      app.config.some(
        (candidate) => sameId(candidate, config) && candidate.nameSpace === config.nameSpace,
      )
    ) {
      return app.name;
    }
  }
  if (EQUIVALENT_NAME_SPACES.includes(config.nameSpace)) {
    for (const app of APPS) {
      if (
        app.config.some(
          (candidate) =>
            sameId(candidate, config) && EQUIVALENT_NAME_SPACES.includes(candidate.nameSpace),
        )
      ) {
        return app.name;
      }
    }
  }
  if (config.nameSpace === 0) {
    return CAST_APP_NAME;
  }
  return null;
}

/**
 * Lowercase, accent-free, alphanumeric form of a name, so "disney plus",
 * "Disney+" and "DISNEY +" are the same app. (From guim31/gladys-roku.)
 */
export function slug(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\+/g, 'plus')
    .replace(/[^a-z0-9]/g, '');
}

const HOME_WORDS = new Set([
  'home',
  'accueil',
  'smartcasthome',
  'smartcast',
  'inicio',
  'startseite',
]);

/**
 * The app a user typed, by name: exact (slug) match first, then a name that
 * starts with it ("prime" finds "Prime Video").
 * @returns {{ name: string, config: object[] }|null}
 */
export function findApp(query) {
  const wanted = slug(query);
  if (!wanted) {
    return null;
  }
  if (HOME_WORDS.has(wanted)) {
    return APPS[0];
  }
  return (
    APPS.find((app) => slug(app.name) === wanted) ??
    APPS.find((app) => slug(app.name).startsWith(wanted)) ??
    null
  );
}
