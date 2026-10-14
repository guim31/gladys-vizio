// -----------------------------------------------------------------------------
// One Gladys device per SmartCast TV or sound bar.
//
// Identity: the serial number the device gives without authentication
// (`/state/device/deviceinfo`), never its address, which DHCP can change. A
// sound bar is published as soon as it answered once; a TV once it is paired
// (without a token it says nothing but its name). What was learned is kept
// under /data for the next starts.
//
// Features (category/type couples of the core table, see
// test/gladys-rules.test.js):
//   - power: television/binary, writable;
//   - volume: television/volume, writable, 0 to the device's maximum (100 on
//     a TV, 31 on a sound bar, read from the device);
//   - volume down / up, mute, channel down / up: television push buttons
//     (write-only: SmartCast mutes with a toggle key, the mute state is shown
//     by the widget and the "Now playing" text);
//   - input: text/select, options = the device's inputs, with the names the
//     user gave them on the TV;
//   - app (TVs): text/select, options = SmartCast Home, the favorite apps of
//     the configuration, and "Other" for an input or an app not in the list;
//   - now playing: text/text, read-only (the app, or the input, or "Off");
//   - picture mode (TVs) and sound mode (sound bars' EQ): text/select, only
//     when the device has the setting.
//
// The devices are published with should_poll: true and 30 s, but the
// integration reads them on its own timer (Gladys#3198): onPoll is a fallback.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { CAST_APP_NAME, HOME_APP } from './vizio/apps.js';
import { DEVICE_KINDS, isAppInput, matchInput } from './vizio/model.js';

export const DEVICE_TYPE = 'smartcast';
export const ADDRESS_PARAM = 'VIZIO_ADDRESS';
export const MODEL_PARAM = 'VIZIO_MODEL';

/** The core's poll cadence, a fallback of the integration's own timer. */
export const POLL_FREQUENCY_MS = DEVICE_POLL_FREQUENCIES.EVERY_30_SECONDS;

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  POWER: 'power',
  VOLUME: 'volume',
  VOLUME_DOWN: 'volume_down',
  VOLUME_UP: 'volume_up',
  MUTE: 'mute',
  INPUT: 'input',
  APP: 'app',
  PLAYING: 'playing',
  PICTURE_MODE: 'picture_mode',
  SOUND_MODE: 'sound_mode',
  CHANNEL_DOWN: 'channel_down',
  CHANNEL_UP: 'channel_up',
});

// Option values of the app select that are not an app of the catalog.
export const HOME_OPTION = 'home';
export const OTHER_OPTION = 'other';

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.POWER]: 'Power',
    [FEATURE_KEYS.VOLUME]: 'Volume',
    [FEATURE_KEYS.VOLUME_DOWN]: 'Volume down',
    [FEATURE_KEYS.VOLUME_UP]: 'Volume up',
    [FEATURE_KEYS.MUTE]: 'Mute',
    [FEATURE_KEYS.INPUT]: 'Input',
    [FEATURE_KEYS.APP]: 'App',
    [FEATURE_KEYS.PLAYING]: 'Now playing',
    [FEATURE_KEYS.PICTURE_MODE]: 'Picture mode',
    [FEATURE_KEYS.SOUND_MODE]: 'Sound mode',
    [FEATURE_KEYS.CHANNEL_DOWN]: 'Channel down',
    [FEATURE_KEYS.CHANNEL_UP]: 'Channel up',
  },
  fr: {
    [FEATURE_KEYS.POWER]: 'Marche / arrêt',
    [FEATURE_KEYS.VOLUME]: 'Volume',
    [FEATURE_KEYS.VOLUME_DOWN]: 'Diminuer le volume',
    [FEATURE_KEYS.VOLUME_UP]: 'Augmenter le volume',
    [FEATURE_KEYS.MUTE]: 'Muet',
    [FEATURE_KEYS.INPUT]: 'Entrée',
    [FEATURE_KEYS.APP]: 'Application',
    [FEATURE_KEYS.PLAYING]: 'En cours',
    [FEATURE_KEYS.PICTURE_MODE]: "Mode d'image",
    [FEATURE_KEYS.SOUND_MODE]: 'Mode sonore',
    [FEATURE_KEYS.CHANNEL_DOWN]: 'Chaîne précédente',
    [FEATURE_KEYS.CHANNEL_UP]: 'Chaîne suivante',
  },
  de: {
    [FEATURE_KEYS.POWER]: 'Ein / Aus',
    [FEATURE_KEYS.VOLUME]: 'Lautstärke',
    [FEATURE_KEYS.VOLUME_DOWN]: 'Lautstärke niedriger',
    [FEATURE_KEYS.VOLUME_UP]: 'Lautstärke höher',
    [FEATURE_KEYS.MUTE]: 'Stumm',
    [FEATURE_KEYS.INPUT]: 'Eingang',
    [FEATURE_KEYS.APP]: 'App',
    [FEATURE_KEYS.PLAYING]: 'Aktuelle Wiedergabe',
    [FEATURE_KEYS.PICTURE_MODE]: 'Bildmodus',
    [FEATURE_KEYS.SOUND_MODE]: 'Klangmodus',
    [FEATURE_KEYS.CHANNEL_DOWN]: 'Voriger Kanal',
    [FEATURE_KEYS.CHANNEL_UP]: 'Nächster Kanal',
  },
  es: {
    [FEATURE_KEYS.POWER]: 'Encendido',
    [FEATURE_KEYS.VOLUME]: 'Volumen',
    [FEATURE_KEYS.VOLUME_DOWN]: 'Bajar volumen',
    [FEATURE_KEYS.VOLUME_UP]: 'Subir volumen',
    [FEATURE_KEYS.MUTE]: 'Silenciar',
    [FEATURE_KEYS.INPUT]: 'Entrada',
    [FEATURE_KEYS.APP]: 'Aplicación',
    [FEATURE_KEYS.PLAYING]: 'En reproducción',
    [FEATURE_KEYS.PICTURE_MODE]: 'Modo de imagen',
    [FEATURE_KEYS.SOUND_MODE]: 'Modo de sonido',
    [FEATURE_KEYS.CHANNEL_DOWN]: 'Bajar canal',
    [FEATURE_KEYS.CHANNEL_UP]: 'Subir canal',
  },
};

// Labels of the extra options, and texts of the "Now playing" feature.
export const DEVICE_TEXT = {
  homeApp: {
    en: 'SmartCast Home',
    fr: 'Accueil SmartCast',
    de: 'SmartCast-Startseite',
    es: 'Inicio de SmartCast',
  },
  otherApp: {
    en: 'Other (input, app)',
    fr: 'Autre (entrée, appli)',
    de: 'Andere (Eingang, App)',
    es: 'Otra (entrada, aplicación)',
  },
  unknownApp: {
    en: 'Unknown app',
    fr: 'Application inconnue',
    de: 'Unbekannte App',
    es: 'Aplicación desconocida',
  },
  cast: {
    en: 'Cast',
    fr: 'Cast',
    de: 'Cast',
    es: 'Cast',
  },
  off: { en: 'Off', fr: 'Éteint', de: 'Aus', es: 'Apagado' },
};

const text = (table, language) => table[language] ?? table.en;

/** Default volume scales, until the device tells its own (pyvizio, vizaio). */
export const DEFAULT_MAX_VOLUME = { [DEVICE_KINDS.TV]: 100, [DEVICE_KINDS.SOUNDBAR]: 31 };

const push = (key, type) => ({
  key,
  definition: {
    category: DEVICE_FEATURE_CATEGORIES.TELEVISION,
    type,
    read_only: false,
    has_feedback: false,
    keep_history: false,
    min: 0,
    max: 1,
  },
});

const select = (key) => ({
  key,
  definition: {
    category: DEVICE_FEATURE_CATEGORIES.TEXT,
    type: DEVICE_FEATURE_TYPES.TEXT.SELECT,
    read_only: false,
    has_feedback: true,
    keep_history: false,
    min: 0,
    max: 0,
  },
});

// Order = display order in Gladys. `when` says which devices have it.
const FEATURES = [
  {
    key: FEATURE_KEYS.POWER,
    definition: {
      category: DEVICE_FEATURE_CATEGORIES.TELEVISION,
      type: DEVICE_FEATURE_TYPES.TELEVISION.BINARY,
      read_only: false,
      has_feedback: true,
      keep_history: true,
      min: 0,
      max: 1,
    },
  },
  {
    key: FEATURE_KEYS.VOLUME,
    definition: {
      category: DEVICE_FEATURE_CATEGORIES.TELEVISION,
      type: DEVICE_FEATURE_TYPES.TELEVISION.VOLUME,
      read_only: false,
      has_feedback: true,
      keep_history: false,
      min: 0,
      max: 100,
    },
  },
  push(FEATURE_KEYS.VOLUME_DOWN, DEVICE_FEATURE_TYPES.TELEVISION.VOLUME_DOWN),
  push(FEATURE_KEYS.VOLUME_UP, DEVICE_FEATURE_TYPES.TELEVISION.VOLUME_UP),
  push(FEATURE_KEYS.MUTE, DEVICE_FEATURE_TYPES.TELEVISION.VOLUME_MUTE),
  { ...select(FEATURE_KEYS.INPUT), when: (record) => record.inputs.length > 0 },
  { ...select(FEATURE_KEYS.APP), when: (record) => record.kind === DEVICE_KINDS.TV },
  {
    key: FEATURE_KEYS.PLAYING,
    definition: {
      category: DEVICE_FEATURE_CATEGORIES.TEXT,
      type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
      read_only: true,
      has_feedback: false,
      keep_history: false,
      min: 0,
      max: 0,
    },
  },
  { ...select(FEATURE_KEYS.PICTURE_MODE), when: (record) => record.pictureModes.length > 0 },
  { ...select(FEATURE_KEYS.SOUND_MODE), when: (record) => record.soundModes.length > 0 },
  {
    ...push(FEATURE_KEYS.CHANNEL_DOWN, DEVICE_FEATURE_TYPES.TELEVISION.CHANNEL_DOWN),
    when: (record) => record.kind === DEVICE_KINDS.TV && record.identity?.tuner !== false,
  },
  {
    ...push(FEATURE_KEYS.CHANNEL_UP, DEVICE_FEATURE_TYPES.TELEVISION.CHANNEL_UP),
    when: (record) => record.kind === DEVICE_KINDS.TV && record.identity?.tuner !== false,
  },
];

/** Keys of the write-only buttons: no state to publish. */
export const PUSH_KEYS = new Set(
  FEATURES.filter(({ definition }) => definition.category === DEVICE_FEATURE_CATEGORIES.TELEVISION)
    .filter(({ definition }) => !definition.has_feedback)
    .map(({ key }) => key),
);

/** External ids of a device and its features. */
export const deviceIds = (gladys, serial) => gladys.externalIds(DEVICE_TYPE, serial);

/** The serial number of a device external id of ours, null otherwise. */
export function serialOf(gladys, externalId) {
  const prefix = gladys.externalId(`${DEVICE_TYPE}:`);
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const rest = externalId.slice(prefix.length);
  return rest && !rest.includes(':') ? rest : null;
}

const fit = (value, max) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);

/** The name of a device: the one set on it, else VIZIO and the model. */
export function deviceName(record) {
  return fit(
    record.identity?.name || `VIZIO ${record.identity?.model ?? record.serial}`.trim(),
    60,
  );
}

/** The options of the input select: value = cname, label = the TV's name for it. */
export function inputOptions(record) {
  return record.inputs.map((input, index) => ({
    value: input.cname,
    label: fit(isAppInput(input.cname) ? 'SmartCast' : input.label, 60),
    sort_order: index,
  }));
}

/** The options of the app select: SmartCast Home, the favorites, Other. */
export function appOptions(favorites, language) {
  const apps = favorites.filter((name) => name !== HOME_APP.name);
  return [
    { value: HOME_OPTION, label: text(DEVICE_TEXT.homeApp, language) },
    ...apps.map((name) => ({ value: name, label: fit(name, 60) })),
    { value: OTHER_OPTION, label: text(DEVICE_TEXT.otherApp, language) },
  ].map((option, index) => ({ ...option, sort_order: index }));
}

const modeOptions = (modes) =>
  modes.map((mode, index) => ({ value: mode, label: fit(mode, 60), sort_order: index }));

/**
 * The discovery payload of a device.
 * @param {object} gladys SDK client
 * @param {object} record hub record
 * @param {{ language: string, favoriteApps: string[] }} config
 */
export function buildDevice(gladys, record, config) {
  const ids = deviceIds(gladys, record.serial);
  const names = NAMES[config.language] ?? NAMES.en;
  const params = [
    { name: ADDRESS_PARAM, value: `${record.host}:${record.port ?? ''}`.replace(/:$/, '') },
  ];
  if (record.identity?.model) {
    params.push({ name: MODEL_PARAM, value: record.identity.model });
  }
  return {
    name: deviceName(record),
    external_id: ids.device,
    model: record.identity?.model ? `VIZIO ${record.identity.model}` : 'VIZIO SmartCast',
    should_poll: true,
    poll_frequency: POLL_FREQUENCY_MS,
    params,
    features: FEATURES.filter(({ when }) => !when || when(record)).map(({ key, definition }) => {
      const feature = { ...definition, name: names[key], external_id: ids.feature(key) };
      if (key === FEATURE_KEYS.VOLUME) {
        feature.max = record.maxVolume;
      } else if (key === FEATURE_KEYS.INPUT) {
        feature.supported_options = inputOptions(record);
      } else if (key === FEATURE_KEYS.APP) {
        feature.supported_options = appOptions(config.favoriteApps, config.language);
      } else if (key === FEATURE_KEYS.PICTURE_MODE) {
        feature.supported_options = modeOptions(record.pictureModes);
      } else if (key === FEATURE_KEYS.SOUND_MODE) {
        feature.supported_options = modeOptions(record.soundModes);
      }
      return feature;
    }),
  };
}

/** The keys of the features a device has. */
export function featureKeysOf(record) {
  return FEATURES.filter(({ when }) => !when || when(record)).map(({ key }) => key);
}

/** What is in front: `{ kind: 'app'|'input', name }`, null when unknown or off. */
export function onScreen(record, language) {
  const { power, input, app } = record.snapshot;
  if (power !== true || !input) {
    return null;
  }
  if (record.kind === DEVICE_KINDS.TV && isAppInput(input)) {
    if (!app) {
      return { kind: 'app', name: text(DEVICE_TEXT.homeApp, language), app: HOME_APP.name };
    }
    if (app.name === CAST_APP_NAME) {
      return { kind: 'app', name: text(DEVICE_TEXT.cast, language), app: CAST_APP_NAME };
    }
    if (app.name) {
      const name = app.name === HOME_APP.name ? text(DEVICE_TEXT.homeApp, language) : app.name;
      return { kind: 'app', name, app: app.name };
    }
    return { kind: 'app', name: text(DEVICE_TEXT.unknownApp, language), app: null };
  }
  const known = matchInput(record.inputs, input);
  return { kind: 'input', name: known ? known.label : input, input: known?.cname ?? null };
}

/** The "Now playing" text, null when nothing is known yet. */
export function playingText(record, language) {
  if (record.snapshot.power === false) {
    return text(DEVICE_TEXT.off, language);
  }
  const screen = onScreen(record, language);
  return screen ? fit(screen.name, 100) : null;
}

/** The value of the app select. */
function appValue(record, config) {
  const screen = onScreen(record, config.language);
  if (!screen) {
    return null;
  }
  if (screen.kind === 'app' && screen.app === HOME_APP.name) {
    return HOME_OPTION;
  }
  if (screen.kind === 'app' && screen.app && config.favoriteApps.includes(screen.app)) {
    return screen.app;
  }
  return OTHER_OPTION;
}

/**
 * The state of every feature of a device (null: nothing to publish). Text
 * values are strings, published as `{ text }`.
 * @returns {Array<{ key: string, externalId: string, value: number|string|null }>}
 */
export function featureValues(gladys, record, config) {
  const ids = deviceIds(gladys, record.serial);
  const { power, volume, input, pictureMode, soundMode } = record.snapshot;
  const on = power === true;
  const known = on && input ? matchInput(record.inputs, input) : null;
  const values = {
    [FEATURE_KEYS.POWER]: power === true ? 1 : power === false ? 0 : null,
    [FEATURE_KEYS.VOLUME]:
      on && Number.isFinite(volume) ? Math.max(0, Math.min(record.maxVolume, volume)) : null,
    [FEATURE_KEYS.INPUT]: known ? known.cname : null,
    [FEATURE_KEYS.APP]: on ? appValue(record, config) : null,
    [FEATURE_KEYS.PLAYING]: playingText(record, config.language),
    [FEATURE_KEYS.PICTURE_MODE]:
      on && record.pictureModes.includes(pictureMode) ? pictureMode : null,
    [FEATURE_KEYS.SOUND_MODE]: on && record.soundModes.includes(soundMode) ? soundMode : null,
  };
  return featureKeysOf(record)
    .filter((key) => !PUSH_KEYS.has(key))
    .map((key) => ({ key, externalId: ids.feature(key), value: values[key] ?? null }));
}
