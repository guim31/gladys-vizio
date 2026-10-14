// -----------------------------------------------------------------------------
// Dashboard widgets (manifest `widgets`, Gladys 5.1+). The core allows four
// buttons per widget, so the remote is split in three widgets a user places
// side by side, each bound to one device (the first one when none is chosen):
//
//   - `remote`: what the device does (state, app or input, volume) and
//     Power, Volume −, Volume +, Mute;
//   - `shortcuts`: four favorite apps or inputs, typed by name in the
//     settings ("Netflix", "HDMI-1", "PS5"); the favorite apps of the
//     configuration by default (the inputs on a sound bar);
//   - `keys`: four remote keys chosen in the widget settings (arrows by
//     default; a second instance for OK, Back, Home, Menu...).
//
// The current choice is shown by the check-circle icon, never by the style
// (`primary` is invisible in dark mode, GladysAssistant/Gladys#3153).
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { deviceName, onScreen, playingText } from './devices.js';
import { CONTENT_KINDS, WIDGET_KEYS } from './hub.js';
import { failure, labelled, pick } from './texts.js';
import { findApp } from './vizio/apps.js';
import { KEY_ICONS, KEY_LABELS, hasKey } from './vizio/keys.js';
import { DEVICE_KINDS } from './vizio/model.js';

// Action keys of the buttons: permanent once published (unique within a
// content, the core drops a button whose key is taken).
export const ACTIONS = Object.freeze({
  POWER: 'power',
  VOLUME_DOWN: 'volume_down',
  VOLUME_UP: 'volume_up',
  MUTE: 'mute',
});
export const SLOT_COUNT = 4;
export const KEY_ACTION = (index) => `key_${index}`;
export const SHORTCUT_ACTION = (index) => `shortcut_${index}`;

// Defaults of the `keys` widget settings (mirror the manifest defaults).
export const DEFAULT_KEYS = ['up', 'down', 'left', 'right'];

const ACTIVE_ICON = 'check-circle';

export const TEXT = {
  pick: {
    en: 'Search for your VIZIO device in the Discovery tab; pair a TV in the configuration.',
    fr: "Cherchez votre appareil VIZIO dans l'onglet Découverte ; appairez un téléviseur dans la configuration.",
    de: 'Suche dein VIZIO-Gerät im Tab Erkennung; kopple einen Fernseher in der Konfiguration.',
    es: 'Busque su dispositivo VIZIO en la pestaña Detección; empareje un televisor en la configuración.',
  },
  unknown: {
    en: 'This device is no longer known: choose another one in the widget settings.',
    fr: "Cet appareil n'est plus connu : choisissez-en un autre dans les réglages du widget.",
    de: 'Dieses Gerät ist nicht mehr bekannt: Wähle ein anderes in den Widget-Einstellungen.',
    es: 'Este dispositivo ya no se conoce: elija otro en la configuración del widget.',
  },
  noShortcut: {
    en: 'Type the names of apps or inputs in the widget settings.',
    fr: "Saisissez des noms d'applications ou d'entrées dans les réglages du widget.",
    de: 'Gib Namen von Apps oder Eingängen in den Widget-Einstellungen ein.',
    es: 'Escriba nombres de aplicaciones o entradas en la configuración del widget.',
  },
  notFound: { en: 'Not found', fr: 'Introuvable', de: 'Nicht gefunden', es: 'No encontrado' },
  on: { en: 'On', fr: 'Allumé', de: 'Ein', es: 'Encendido' },
  standby: { en: 'Standby', fr: 'En veille', de: 'Standby', es: 'En espera' },
  asleep: { en: 'Off (Eco)', fr: 'Éteint (Éco)', de: 'Aus (Eco)', es: 'Apagado (Eco)' },
  error: { en: 'Error', fr: 'Erreur', de: 'Fehler', es: 'Error' },
  waiting: { en: 'Waiting…', fr: 'En attente…', de: 'Warte…', es: 'Esperando…' },
  screen: { en: 'Now playing', fr: 'En cours', de: 'Aktuell', es: 'En curso' },
  volume: { en: 'Volume', fr: 'Volume', de: 'Lautstärke', es: 'Volumen' },
  muted: { en: 'Muted', fr: 'Coupé', de: 'Stumm', es: 'Silenciado' },
  turnOn: { en: 'Turn on', fr: 'Allumer', de: 'Einschalten', es: 'Encender' },
  turnOff: { en: 'Turn off', fr: 'Éteindre', de: 'Ausschalten', es: 'Apagar' },
  volumeDown: { en: 'Volume −', fr: 'Volume −', de: 'Leiser', es: 'Volumen −' },
  volumeUp: { en: 'Volume +', fr: 'Volume +', de: 'Lauter', es: 'Volumen +' },
  mute: { en: 'Mute', fr: 'Muet', de: 'Stumm', es: 'Silenciar' },
};

// Toasts after a tap (≤ 200 characters).
export const DONE_TEXT = {
  en: {
    turningOn: (name) => `Turning ${name} on…`,
    turnedOff: (name) => `${name} turned off.`,
    opened: (name) => `${name} on screen.`,
  },
  fr: {
    turningOn: (name) => `Allumage de ${name}…`,
    turnedOff: (name) => `${name} éteint.`,
    opened: (name) => `${name} à l'écran.`,
  },
  de: {
    turningOn: (name) => `${name} wird eingeschaltet…`,
    turnedOff: (name) => `${name} ausgeschaltet.`,
    opened: (name) => `${name} auf dem Bildschirm.`,
  },
  es: {
    turningOn: (name) => `Encendiendo ${name}…`,
    turnedOff: (name) => `${name} apagado.`,
    opened: (name) => `${name} en pantalla.`,
  },
};

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const done = (render) =>
  Object.fromEntries(Object.entries(DONE_TEXT).map(([lang, text]) => [lang, render(text)]));

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

/** The record a widget shows, or the content to show instead. */
function recordFor(hub, settings, language) {
  if (hub.published().length === 0) {
    return { content: message(TEXT.pick, language) };
  }
  const record = hub.view(settings?.device);
  return record ? { record } : { content: message(TEXT.unknown, language) };
}

/** The record a widget button acts on. */
function actionRecord(hub, settings) {
  const record = hub.view(settings?.device);
  if (!record) {
    throw failure(hub.language, hub.published().length === 0 ? 'noDevice' : 'unknownDevice');
  }
  return record;
}

const isOn = (record) => record.snapshot.power === true;

/** The first status row: the device and its state. */
function deviceRow(record, language) {
  const label = fit(deviceName(record), 40);
  if (record.error) {
    return {
      label,
      icon: 'alert-triangle',
      value: t(TEXT.error, language),
      color: WIDGET_COLORS.DANGER,
    };
  }
  if (record.snapshot.reachable === false) {
    return { label, icon: 'tv', value: t(TEXT.asleep, language), color: WIDGET_COLORS.NEUTRAL };
  }
  if (record.snapshot.power === true) {
    return { label, icon: 'tv', value: t(TEXT.on, language), color: WIDGET_COLORS.SUCCESS };
  }
  if (record.snapshot.power === false) {
    return { label, icon: 'tv', value: t(TEXT.standby, language), color: WIDGET_COLORS.NEUTRAL };
  }
  return { label, icon: 'clock', value: t(TEXT.waiting, language), color: WIDGET_COLORS.NEUTRAL };
}

// --- remote ------------------------------------------------------------------

function remoteContent(record, language) {
  const items = [deviceRow(record, language)];
  const { volume, muted } = record.snapshot;
  const on = isOn(record);
  if (on) {
    const playing = playingText(record, language);
    if (playing) {
      items.push({
        label: t(TEXT.screen, language),
        icon: 'airplay',
        value: fit(playing, 40),
        color: WIDGET_COLORS.INFO,
      });
    }
    if (Number.isFinite(volume)) {
      items.push({
        label: t(TEXT.volume, language),
        icon: muted ? 'volume-x' : 'volume-2',
        value: muted ? t(TEXT.muted, language) : volume,
        color: muted ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
      });
    }
  }
  return {
    ttl_seconds: on ? 30 : 120,
    components: [
      { type: 'status', items },
      {
        type: 'button',
        label: t(on ? TEXT.turnOff : TEXT.turnOn, language),
        icon: 'power',
        style: 'secondary',
        action: { key: ACTIONS.POWER, params: { on: !on } },
      },
      {
        type: 'button',
        label: t(TEXT.volumeDown, language),
        icon: 'volume-1',
        style: 'secondary',
        action: { key: ACTIONS.VOLUME_DOWN },
      },
      {
        type: 'button',
        label: t(TEXT.volumeUp, language),
        icon: 'volume-2',
        style: 'secondary',
        action: { key: ACTIONS.VOLUME_UP },
      },
      {
        type: 'button',
        label: t(TEXT.mute, language),
        icon: muted ? ACTIVE_ICON : 'volume-x',
        style: 'secondary',
        action: { key: ACTIONS.MUTE },
      },
    ],
  };
}

const remote = {
  async get(hub, { settings, language = 'en' }) {
    const { record, content } = recordFor(hub, settings, language);
    return content ?? remoteContent(record, language);
  },

  async action(hub, { actionKey, params = {}, settings }) {
    const record = actionRecord(hub, settings);
    const name = deviceName(record);
    switch (actionKey) {
      case ACTIONS.POWER: {
        const on = params.on === true;
        await hub.setPower(record, on);
        return { message: done((text) => (on ? text.turningOn(name) : text.turnedOff(name))) };
      }
      case ACTIONS.VOLUME_DOWN:
        await hub.stepVolume(record, -hub.config.volumeStep);
        return undefined;
      case ACTIONS.VOLUME_UP:
        await hub.stepVolume(record, hub.config.volumeStep);
        return undefined;
      case ACTIONS.MUTE:
        await hub.toggleMute(record);
        return undefined;
      default:
        throw new Error(`Unknown action ${actionKey}`);
    }
  },
};

// --- shortcuts -------------------------------------------------------------------

/**
 * The shortcuts of a widget: the names typed in its settings, resolved to an
 * input (first) or an app of the catalog (TVs); by default the favorite apps
 * of the configuration on a TV, the inputs on a sound bar.
 * @returns {{ shortcuts: Array<{ kind: string, value: string, name: string }>, missing: string[] }}
 */
export function resolveShortcuts(hub, record, settings = {}) {
  const typed = Array.from({ length: SLOT_COUNT }, (_, index) =>
    typeof settings?.[`shortcut_${index + 1}`] === 'string'
      ? settings[`shortcut_${index + 1}`].trim()
      : '',
  ).filter(Boolean);
  const tv = record.kind === DEVICE_KINDS.TV;
  if (typed.length === 0) {
    const shortcuts = tv
      ? hub.config.favoriteApps.map((name) => ({ kind: CONTENT_KINDS.APP, value: name, name }))
      : record.inputs.map((input) => ({
          kind: CONTENT_KINDS.INPUT,
          value: input.cname,
          name: input.label,
        }));
    return { shortcuts: shortcuts.slice(0, SLOT_COUNT), missing: [] };
  }
  const shortcuts = [];
  const missing = [];
  for (const query of typed) {
    const input = hub.findInput(record, query);
    const app = input || !tv ? null : findApp(query);
    if (input) {
      shortcuts.push({ kind: CONTENT_KINDS.INPUT, value: input.cname, name: input.label });
    } else if (app) {
      shortcuts.push({ kind: CONTENT_KINDS.APP, value: app.name, name: app.name });
    } else {
      missing.push(query);
    }
  }
  return { shortcuts, missing };
}

function isCurrent(record, shortcut) {
  const screen = onScreen(record, 'en');
  if (!screen || screen.kind !== shortcut.kind) {
    return false;
  }
  return shortcut.kind === CONTENT_KINDS.APP
    ? screen.app === shortcut.value
    : screen.input === shortcut.value;
}

const shortcutsWidget = {
  async get(hub, { settings, language = 'en' }) {
    const { record, content } = recordFor(hub, settings, language);
    if (content) {
      return content;
    }
    const { shortcuts, missing } = resolveShortcuts(hub, record, settings);
    const components = [{ type: 'status', items: [deviceRow(record, language)] }];
    if (shortcuts.length === 0 && missing.length === 0) {
      components.push({ type: 'text', variant: 'caption', text: t(TEXT.noShortcut, language) });
    }
    if (missing.length > 0) {
      components.push({
        type: 'text',
        variant: 'caption',
        text: fit(labelled(t(TEXT.notFound, language), missing.join(', '), language), 80),
      });
    }
    shortcuts.forEach((shortcut, index) => {
      components.push({
        type: 'button',
        label: fit(shortcut.name, 24),
        icon: isCurrent(record, shortcut)
          ? ACTIVE_ICON
          : shortcut.kind === CONTENT_KINDS.INPUT
            ? 'log-in'
            : 'grid',
        style: 'secondary',
        action: {
          key: SHORTCUT_ACTION(index + 1),
          params: { kind: shortcut.kind, value: shortcut.value },
        },
      });
    });
    return { ttl_seconds: isOn(record) ? 30 : 300, components };
  },

  async action(hub, { params = {}, settings }) {
    const record = actionRecord(hub, settings);
    const value = String(params.value ?? '');
    if (params.kind === CONTENT_KINDS.APP) {
      const app = await hub.openApp(record, value);
      return app ? { message: done((text) => text.opened(app.name)) } : undefined;
    }
    const input = await hub.selectInput(record, value);
    return { message: done((text) => text.opened(input.label)) };
  },
};

// --- keys ----------------------------------------------------------------------

/** The four keys of a `keys` widget, from its settings. */
export function chosenKeys(settings = {}) {
  return Array.from({ length: SLOT_COUNT }, (_, index) => {
    const value = settings?.[`key_${index + 1}`];
    return KEY_LABELS[value] ? value : DEFAULT_KEYS[index];
  });
}

const keys = {
  async get(hub, { settings, language = 'en' }) {
    const { record, content } = recordFor(hub, settings, language);
    if (content) {
      return content;
    }
    return {
      ttl_seconds: isOn(record) ? 60 : 300,
      components: [
        { type: 'status', items: [deviceRow(record, language)] },
        // A sound bar has a few keys only: the others are not shown.
        ...chosenKeys(settings)
          .map((key, index) => ({ key, index }))
          .filter(({ key }) => hasKey(record.kind, key))
          .map(({ key, index }) => ({
            type: 'button',
            label: t(KEY_LABELS[key], language),
            icon: KEY_ICONS[key] ?? 'circle',
            style: 'secondary',
            action: { key: KEY_ACTION(index + 1), params: { key } },
          })),
      ],
    };
  },

  async action(hub, { params = {}, settings }) {
    const record = actionRecord(hub, settings);
    await hub.sendKey(record, String(params.key ?? ''));
    return undefined;
  },
};

export const WIDGETS = {
  [WIDGET_KEYS.REMOTE]: remote,
  [WIDGET_KEYS.SHORTCUTS]: shortcutsWidget,
  [WIDGET_KEYS.KEYS]: keys,
};
