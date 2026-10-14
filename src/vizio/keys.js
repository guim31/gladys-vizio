// -----------------------------------------------------------------------------
// Remote control keys. Our key names are permanent (scene actions and widget
// settings store them); the codes are the (CODESET, CODE) pairs of the
// SmartCast `PUT /key_command/` request, from pyvizio and vizaio (MIT), where
// both agree. Keys the two libraries disagree on (Exit, SmartCast, closed
// captions) are left out rather than guessed.
//
// `soundbar: true`: the key exists on a sound bar too (its key table is a
// subset of the TV's).
// -----------------------------------------------------------------------------

export const KEYS = Object.freeze({
  up: { code: [3, 8] },
  down: { code: [3, 0] },
  left: { code: [3, 1] },
  right: { code: [3, 7] },
  ok: { code: [3, 2] },
  back: { code: [4, 0] },
  home: { code: [4, 15] },
  menu: { code: [4, 8] },
  info: { code: [4, 6] },
  play: { code: [2, 3], soundbar: true },
  pause: { code: [2, 2], soundbar: true },
  rewind: { code: [2, 1] },
  forward: { code: [2, 0] },
  volume_up: { code: [5, 1], soundbar: true },
  volume_down: { code: [5, 0], soundbar: true },
  mute: { code: [5, 4], soundbar: true },
  channel_up: { code: [8, 1] },
  channel_down: { code: [8, 0] },
  channel_previous: { code: [8, 2] },
  input_next: { code: [7, 1], soundbar: true },
});

/** Codes used by the integration itself (not offered as remote keys). */
export const CODES = Object.freeze({
  POWER_ON: [11, 1],
  POWER_OFF: [11, 0],
  VOLUME_UP: KEYS.volume_up.code,
  VOLUME_DOWN: KEYS.volume_down.code,
  MUTE_TOGGLE: KEYS.mute.code,
});

export const KEY_NAMES = Object.keys(KEYS);

/** Whether a device kind has a key. */
export const hasKey = (kind, key) =>
  Boolean(KEYS[key]) && (kind === 'tv' || KEYS[key].soundbar === true);

export const KEY_LABELS = Object.freeze({
  up: { en: 'Up', fr: 'Haut', de: 'Hoch', es: 'Arriba' },
  down: { en: 'Down', fr: 'Bas', de: 'Runter', es: 'Abajo' },
  left: { en: 'Left', fr: 'Gauche', de: 'Links', es: 'Izquierda' },
  right: { en: 'Right', fr: 'Droite', de: 'Rechts', es: 'Derecha' },
  ok: { en: 'OK', fr: 'OK', de: 'OK', es: 'OK' },
  back: { en: 'Back', fr: 'Retour', de: 'Zurück', es: 'Volver' },
  home: { en: 'Home', fr: 'Accueil', de: 'Home', es: 'Inicio' },
  menu: { en: 'Menu', fr: 'Menu', de: 'Menü', es: 'Menú' },
  info: { en: 'Info', fr: 'Info', de: 'Info', es: 'Info' },
  play: { en: 'Play', fr: 'Lecture', de: 'Abspielen', es: 'Reproducir' },
  pause: { en: 'Pause', fr: 'Pause', de: 'Pause', es: 'Pausa' },
  rewind: { en: 'Rewind', fr: 'Retour rapide', de: 'Zurückspulen', es: 'Retroceder' },
  forward: { en: 'Fast forward', fr: 'Avance rapide', de: 'Vorspulen', es: 'Avanzar' },
  volume_up: { en: 'Volume +', fr: 'Volume +', de: 'Lauter', es: 'Volumen +' },
  volume_down: { en: 'Volume −', fr: 'Volume −', de: 'Leiser', es: 'Volumen −' },
  mute: { en: 'Mute', fr: 'Muet', de: 'Stumm', es: 'Silenciar' },
  channel_up: { en: 'Channel +', fr: 'Chaîne +', de: 'Kanal +', es: 'Canal +' },
  channel_down: { en: 'Channel −', fr: 'Chaîne −', de: 'Kanal −', es: 'Canal −' },
  channel_previous: {
    en: 'Last channel',
    fr: 'Chaîne précédente',
    de: 'Letzter Kanal',
    es: 'Canal anterior',
  },
  input_next: {
    en: 'Next input',
    fr: 'Entrée suivante',
    de: 'Nächster Eingang',
    es: 'Entrada siguiente',
  },
});

/** Feather icons of the widget buttons. */
export const KEY_ICONS = Object.freeze({
  up: 'chevron-up',
  down: 'chevron-down',
  left: 'chevron-left',
  right: 'chevron-right',
  ok: 'check-square',
  back: 'corner-up-left',
  home: 'home',
  menu: 'menu',
  info: 'info',
  play: 'play',
  pause: 'pause',
  rewind: 'rewind',
  forward: 'fast-forward',
  volume_up: 'volume-2',
  volume_down: 'volume-1',
  mute: 'volume-x',
  channel_up: 'chevrons-up',
  channel_down: 'chevrons-down',
  channel_previous: 'rotate-ccw',
  input_next: 'log-in',
});
