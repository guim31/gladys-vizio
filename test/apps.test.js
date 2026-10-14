// -----------------------------------------------------------------------------
// The SmartCast app catalog (pyvizio): names from app configurations, and
// apps from what a user types.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APPS, CAST_APP_NAME, HOME_APP, appNameOf, findApp, slug } from '../src/vizio/apps.js';

test('the catalog: the home screen first, then 150 apps with a config each', () => {
  assert.equal(APPS[0].name, HOME_APP.name);
  assert.equal(APPS.length, 151);
  assert.equal(new Set(APPS.map((app) => app.name)).size, APPS.length);
  for (const app of APPS) {
    assert.ok(app.config.length > 0 && typeof app.config[0].appId === 'string', app.name);
    assert.ok(Number.isInteger(app.config[0].nameSpace), app.name);
  }
});

test('an app config gives its name, with the 2/4 namespaces equivalent and 0 for Cast', () => {
  assert.equal(appNameOf({ appId: '1', nameSpace: 3 }), 'Netflix');
  assert.equal(appNameOf({ appId: '1', nameSpace: 4 }), 'SmartCast Home');
  assert.equal(appNameOf({ appId: '3', nameSpace: 2 }), 'Hulu');
  // Hulu is NAME_SPACE 2 in the catalog; some firmware reports 4.
  assert.equal(appNameOf({ appId: '3', nameSpace: 4 }), 'Hulu');
  assert.equal(appNameOf({ appId: 'AB12', nameSpace: 0 }), CAST_APP_NAME);
  assert.equal(appNameOf({ appId: '424242', nameSpace: 2 }), null);
  assert.equal(appNameOf(null), null);
});

test('a typed name finds its app: case, accents, plus and prefixes ignored', () => {
  assert.equal(slug('Bon Appétit'), 'bonappetit');
  assert.equal(findApp('disney plus').name, 'Disney+');
  assert.equal(findApp('NETFLIX').name, 'Netflix');
  assert.equal(findApp('prime').name, 'Prime Video');
  assert.equal(findApp('accueil').name, HOME_APP.name);
  assert.equal(findApp('nothing like this'), null);
  assert.equal(findApp(''), null);
});
