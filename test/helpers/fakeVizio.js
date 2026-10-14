// -----------------------------------------------------------------------------
// In-memory SmartCast devices (a TV, a sound bar) and the fake network the
// tests plug into the client. The TV answers with the captures of a real
// VIZIO TV published by vizaio (MIT, test/fixtures/vizio/, anonymized), whose
// values follow the state of the fake: power, input, app, volume, mute.
// What no capture shows (a sound bar, the picture menu, older firmware) is
// built in the same shape, from pyvizio's and vizaio's tests.
//
// Behaviors reproduced from the hardware notes of vizaio: HTTP 403 for a
// missing or forgotten token, URI_NOT_FOUND with an HTTP 200, HASHVAL_ERROR
// for a stale hashval, FAILURE when switching to the input already in front,
// recent firmware switching inputs by cname, older ones by name.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/vizio/${name}.json`, import.meta.url), 'utf8'));

const envelope = (result = 'SUCCESS', extra = {}) => ({
  STATUS: { RESULT: result, DETAIL: result === 'SUCCESS' ? 'Success' : result },
  ...extra,
});

const NETFLIX = { APP_ID: '1', NAME_SPACE: 3, MESSAGE: null };
export const APP_CONFIGS = {
  home: { APP_ID: '1', NAME_SPACE: 4, MESSAGE: '{"app":"home","bundle":"bundles/home"}' },
  netflix: NETFLIX,
  hulu: { APP_ID: '3', NAME_SPACE: 2, MESSAGE: null },
  unknown: { APP_ID: '424242', NAME_SPACE: 2, MESSAGE: null },
};

const SOUNDBAR_INPUTS = [
  { cname: 'hdmi', name: 'HDMI' },
  { cname: 'usb', name: 'USB' },
  { cname: 'bluetooth', name: 'Bluetooth' },
  { cname: 'aux', name: 'AUX' },
];

const PICTURE_MODES = ['Vivid', 'Bright', 'Calibrated', 'Calibrated Dark', 'Game', 'Sports'];
const SOUND_MODES = ['Music', 'Movie', 'Direct', 'Dialogue'];

let hashSeed = 1_000_000;
const nextHash = () => {
  hashSeed += 7919;
  return hashSeed;
};

export class FakeVizio {
  /**
   * @param {object} [options]
   * @param {'tv'|'soundbar'} [options.kind]
   * @param {'modern'|'legacy'} [options.firmware] modern: /state_extended, serial
   *   in the device info, inputs switched by cname; legacy: none of these
   * @param {string} [options.serial]
   * @param {string} [options.name]
   * @param {string} [options.model]
   * @param {number} [options.port]
   * @param {boolean} [options.power]
   * @param {string} [options.powerMode] 'Quick Start' or 'Eco Mode'
   * @param {string} [options.pin] the PIN the TV shows when pairing
   * @param {string[]} [options.tokens] tokens already accepted
   * @param {boolean} [options.picture] whether the TV has a picture menu
   * @param {boolean} [options.volumeInGroup] false: `volume` missing from the audio group
   */
  constructor({
    kind = 'tv',
    firmware = 'modern',
    serial = kind === 'tv' ? 'LTMTEST24A00001' : 'SBTEST3651F0001',
    name = kind === 'tv' ? 'Living Room TV' : 'Living Room Sound Bar',
    model = kind === 'tv' ? 'VHD24M-0810' : 'SB3651-F6',
    port = kind === 'tv' ? 7345 : 9000,
    power = true,
    powerMode = 'Quick Start',
    pin = '1234',
    tokens = [],
    picture = true,
    volumeInGroup = true,
  } = {}) {
    this.kind = kind;
    this.firmware = firmware;
    this.serial = serial;
    this.name = name;
    this.model = model;
    this.port = port;
    this.power = power;
    this.powerMode = powerMode;
    this.online = true;
    this.pin = pin;
    this.tokens = new Set(tokens);
    this.picture = picture && kind === 'tv';
    this.volumeInGroup = volumeInGroup;
    this.root = kind === 'tv' ? 'tv_settings' : 'audio_settings';
    this.maxVolume = kind === 'tv' ? 100 : 31;
    this.inputs =
      kind === 'tv'
        ? fixture('inputs').ITEMS.map((item) => ({
            cname: item.CNAME,
            name: item.NAME,
            meta: item.VALUE.NAME,
            hashval: item.HASHVAL,
          }))
        : SOUNDBAR_INPUTS.map((input) => ({ ...input, meta: input.name, hashval: nextHash() }));
    this.input = kind === 'tv' ? 'cast' : 'hdmi';
    this.app = kind === 'tv' ? { ...APP_CONFIGS.home } : null;
    this.settings = {
      audio: {
        volume: { value: kind === 'tv' ? 23 : 12, hashval: nextHash() },
        mute: { value: 'Off', hashval: nextHash() },
        ...(kind === 'soundbar' ? { eq: { value: 'Music', hashval: nextHash() } } : {}),
      },
      picture: this.picture ? { picture_mode: { value: 'Calibrated', hashval: nextHash() } } : {},
    };
    this.inputHash = nextHash();
    this.pairing = null;
    this.keys = [];
    this.requests = [];
  }

  /** Rename an input on the TV, as its menu allows (`hdmi2` -> `PS5`). */
  rename(cname, meta) {
    this.inputs.find((input) => input.cname === cname).meta = meta;
  }

  /** The user switched the input with the remote. */
  show(cname) {
    this.input = cname;
    this.app = cname === 'cast' ? { ...APP_CONFIGS.home } : null;
    this.inputHash = nextHash();
  }

  /** The user opened an app with the remote. */
  openApp(config) {
    this.input = 'cast';
    this.app = { ...config };
    this.inputHash = nextHash();
  }

  get volume() {
    return this.settings.audio.volume.value;
  }

  set volume(value) {
    this.settings.audio.volume.value = value;
  }

  get muted() {
    return this.settings.audio.mute.value === 'On';
  }

  // --- HTTP ------------------------------------------------------------------------

  /**
   * One request, as the TV's web server sees it.
   * @returns {{ status: number, headers: object, body: string }}
   */
  handle({ method, path, headers = {}, body }) {
    const auth = headers.AUTH ?? headers.auth;
    this.requests.push({ method, path, auth: auth ?? null, body: body ?? null });
    let payload;
    try {
      payload = body ? JSON.parse(body) : null;
    } catch {
      return this.reply(400, envelope('INVALID_PARAMETER'));
    }
    const route = `${method} ${path}`;
    const open = this.openRoute(route, payload);
    if (open) {
      return open;
    }
    // Everything else needs the token on a TV; a sound bar asks for none.
    if (this.kind === 'tv' && !this.tokens.has(auth)) {
      return this.reply(403, '<html><body>403 Forbidden</body></html>');
    }
    return this.reply(200, this.route(route, payload));
  }

  reply(status, json) {
    return {
      status,
      headers: { 'Content-Type': 'application/json' },
      body: typeof json === 'string' ? json : JSON.stringify(json),
    };
  }

  /** The requests that need no token: device info, serial number, pairing. */
  openRoute(route, payload) {
    if (route === 'GET /state/device/deviceinfo') {
      return this.reply(200, this.deviceInfo());
    }
    const serial = route.match(
      /^GET \/menu_native\/dynamic\/\w+\/(admin_and_privacy|system)\/system_information\/\w+\/serial_number$/,
    );
    if (serial) {
      const legacyPath = serial[1] === 'system';
      if (this.firmware === 'legacy' && legacyPath) {
        return this.reply(
          200,
          envelope('SUCCESS', {
            ITEMS: [{ CNAME: 'serial_number', TYPE: 'T_STRING_V1', VALUE: this.serial }],
          }),
        );
      }
      return this.reply(200, envelope('URI_NOT_FOUND'));
    }
    if (route === 'PUT /pairing/start') {
      if (this.kind !== 'tv') {
        return this.reply(200, envelope('URI_NOT_FOUND'));
      }
      this.pairing = { deviceId: payload.DEVICE_ID, token: 40000 + this.requests.length };
      return this.reply(
        200,
        envelope('SUCCESS', {
          ITEM: { CHALLENGE_TYPE: 1, PAIRING_REQ_TOKEN: this.pairing.token },
        }),
      );
    }
    if (route === 'PUT /pairing/pair') {
      if (!this.pairing || payload.PAIRING_REQ_TOKEN !== this.pairing.token) {
        return this.reply(200, envelope('CHALLENGE_INCORRECT'));
      }
      if (String(payload.RESPONSE_VALUE) !== this.pin) {
        return this.reply(200, envelope('PAIRING_DENIED'));
      }
      // Pairing the same client id again replaces its token (vizaio, hardware).
      const token = `Zm9v${payload.DEVICE_ID.length}${this.requests.length}`;
      this.tokens.add(token);
      this.pairing = null;
      return this.reply(200, envelope('SUCCESS', { ITEM: { AUTH_TOKEN: token } }));
    }
    if (route === 'PUT /pairing/cancel') {
      this.pairing = null;
      return this.reply(200, envelope('SUCCESS'));
    }
    return null;
  }

  deviceInfo() {
    if (this.kind === 'soundbar') {
      return envelope('SUCCESS', {
        ITEMS: [
          {
            CNAME: 'deviceinfo',
            NAME: 'VIZIO Device Info',
            TYPE: 'T_VIZIO_DEVICE_INFO_V1',
            VALUE: {
              API_VERSION: '1.0.12.11',
              CAST_NAME: this.name,
              MODEL_NAME: this.model,
              SETTINGS_ROOT: 'audio_settings',
              CAPABILITIES: { type: 'audio', BATTERY: false },
              SYSTEM_INFO: {
                DEVICE_TYPE: 1,
                MODEL_NAME: this.model,
                ...(this.firmware === 'modern' ? { SERIAL_NUMBER: this.serial } : {}),
                VERSION: '3.1.3.1',
              },
            },
          },
        ],
        URI: '/state/device/deviceinfo',
      });
    }
    const info = fixture('device_info');
    const value = info.ITEMS[0].VALUE;
    value.CAST_NAME = this.name;
    value.MODEL_NAME = this.model;
    value.SYSTEM_INFO.MODEL_NAME = this.model;
    value.SYSTEM_INFO.SERIAL_NUMBER = this.serial;
    if (this.firmware === 'legacy') {
      delete value.SYSTEM_INFO.SERIAL_NUMBER;
      delete value.SCPL_CAPABILITIES;
      value.API_VERSION = '1.0.13.25';
    }
    return info;
  }

  /** The value the TV gives for its current input: the meta name of the cast input, the name of the others. */
  currentInputValue() {
    const input = this.inputs.find((item) => item.cname === this.input);
    return input.cname === 'cast' ? input.meta : input.name;
  }

  inputPaths() {
    return this.kind === 'tv'
      ? {
          list: '/menu_native/dynamic/tv_settings/devices/name_input',
          current: '/menu_native/dynamic/tv_settings/devices/current_input',
        }
      : {
          list: '/menu_native/dynamic/audio_settings/input',
          current: '/menu_native/dynamic/audio_settings/input/current_input',
        };
  }

  route(route, payload) {
    const paths = this.inputPaths();
    const dynamic = `/menu_native/dynamic/${this.root}`;
    const staticRoot = `/menu_native/static/${this.root}`;
    switch (route) {
      case 'GET /state/device/power_mode': {
        const json = fixture('power_mode');
        json.ITEMS[0].VALUE = this.power ? 1 : 0;
        return json;
      }
      case 'GET /state_extended': {
        if (this.firmware !== 'modern' || this.kind !== 'tv') {
          return envelope('URI_NOT_FOUND');
        }
        const json = fixture('state_extended');
        json.POWER_STATUS.VALUE = this.power ? 1 : 0;
        json.POWER_MODE.VALUE = this.powerMode;
        json.CURRENT_INPUT = { HASHVAL: this.inputHash, NAME: this.currentInputValue() };
        json.APP_CURRENT = this.app ? { ...this.app } : null;
        json.DEVICE_NAME = this.name;
        return json;
      }
      case `GET ${paths.current}`: {
        const json = fixture('current_input');
        json.ITEMS[0].VALUE = this.currentInputValue();
        json.ITEMS[0].HASHVAL = this.inputHash;
        json.URI = paths.current;
        return json;
      }
      case `PUT ${paths.current}`:
        return this.setInput(payload);
      case `GET ${paths.list}`: {
        const json = fixture('inputs');
        json.ITEMS = this.inputs.map((input) => ({
          CNAME: input.cname,
          ENABLED: 'FALSE',
          HASHVAL: input.hashval,
          NAME: input.name,
          TYPE: 'T_DEVICE_V1',
          VALUE: { METADATA: '', NAME: input.meta },
        }));
        json.URI = paths.list;
        return json;
      }
      case 'GET /app/current': {
        if (this.kind !== 'tv') {
          return envelope('URI_NOT_FOUND');
        }
        const json = fixture('current_app');
        json.ITEM.VALUE = this.input === 'cast' && this.app ? { ...this.app } : null;
        return json;
      }
      case 'PUT /app/launch': {
        if (this.kind !== 'tv') {
          return envelope('URI_NOT_FOUND');
        }
        const value = payload?.VALUE ?? {};
        if (value.APP_ID === undefined || value.NAME_SPACE === undefined) {
          return envelope('INVALID_PARAMETER');
        }
        this.power = true;
        this.openApp({
          APP_ID: value.APP_ID,
          NAME_SPACE: value.NAME_SPACE,
          MESSAGE: value.MESSAGE,
        });
        return envelope('SUCCESS');
      }
      case 'PUT /key_command/':
        return this.pressKeys(payload);
      case `GET ${dynamic}/audio`:
        return this.audioGroup();
      case `GET ${staticRoot}/audio`:
        return this.audioOptions();
      case `GET ${staticRoot}/picture`:
        return this.picture
          ? envelope('SUCCESS', {
              ITEMS: [
                {
                  CNAME: 'picture_mode',
                  ELEMENTS: PICTURE_MODES,
                  HASHVAL: 1,
                  NAME: 'Picture Mode',
                  TYPE: 'T_LIST_V1',
                },
              ],
            })
          : envelope('URI_NOT_FOUND');
      default:
        return this.leaf(route, payload, dynamic);
    }
  }

  setInput(payload) {
    if (Number(payload?.HASHVAL) !== this.inputHash) {
      return envelope('HASHVAL_ERROR');
    }
    // Recent firmware: by cname (hdmi2); older firmware: by meta name (pyvizio).
    const target = this.inputs.find((input) =>
      this.firmware === 'modern' ? input.cname === payload.VALUE : input.meta === payload.VALUE,
    );
    if (!target) {
      return envelope(this.firmware === 'modern' ? 'FAILURE' : 'INVALID_PARAMETER');
    }
    if (target.cname === this.input) {
      return envelope('FAILURE');
    }
    this.show(target.cname);
    return envelope('SUCCESS', { ITEMS: [{ HASHVAL: this.inputHash, NAME: 'Current Input' }] });
  }

  pressKeys(payload) {
    const list = Array.isArray(payload?.KEYLIST) ? payload.KEYLIST : [];
    for (const key of list) {
      if (key.ACTION !== 'KEYPRESS') {
        return envelope('INVALID_PARAMETER');
      }
      const code = `${key.CODESET},${key.CODE}`;
      this.keys.push(code);
      const audio = this.settings.audio;
      if (code === '11,1') {
        this.power = true;
      } else if (code === '11,0') {
        this.power = false;
      } else if (code === '11,2') {
        this.power = !this.power;
      } else if (code === '5,1') {
        audio.volume.value = Math.min(this.maxVolume, audio.volume.value + 1);
      } else if (code === '5,0') {
        audio.volume.value = Math.max(0, audio.volume.value - 1);
      } else if (code === '5,4') {
        audio.mute.value = audio.mute.value === 'On' ? 'Off' : 'On';
      }
    }
    return envelope('SUCCESS');
  }

  audioGroup() {
    if (this.kind === 'tv') {
      const json = fixture('settings_audio');
      json.ITEMS = json.ITEMS.filter((item) => this.volumeInGroup || item.CNAME !== 'volume').map(
        (item) =>
          ['volume', 'mute'].includes(item.CNAME)
            ? {
                ...item,
                VALUE: this.settings.audio[item.CNAME].value,
                HASHVAL: this.settings.audio[item.CNAME].hashval,
              }
            : item,
      );
      return json;
    }
    return envelope('SUCCESS', {
      ITEMS: Object.entries(this.settings.audio)
        .filter(([cname]) => this.volumeInGroup || cname !== 'volume')
        .map(([cname, setting]) => ({
          CNAME: cname,
          HASHVAL: setting.hashval,
          NAME: cname,
          TYPE: cname === 'volume' ? 'T_VALUE_V1' : 'T_LIST_V1',
          VALUE: setting.value,
        })),
    });
  }

  audioOptions() {
    if (this.kind === 'tv') {
      return fixture('static_audio');
    }
    return envelope('SUCCESS', {
      ITEMS: [
        { CNAME: 'volume', TYPE: 'T_VALUE_V1', MINIMUM: 0, MAXIMUM: this.maxVolume, HASHVAL: 1 },
        { CNAME: 'mute', TYPE: 'T_LIST_V1', ELEMENTS: ['Off', 'On'], HASHVAL: 2 },
        { CNAME: 'eq', TYPE: 'T_LIST_V1', ELEMENTS: SOUND_MODES, HASHVAL: 3 },
      ],
    });
  }

  /** One setting: `GET` and `PUT` `{root}/{group}/{cname}`. */
  leaf(route, payload, dynamic) {
    const match = route.match(new RegExp(`^(GET|PUT) ${dynamic}/(audio|picture)/(\\w+)$`));
    const setting = match && this.settings[match[2]][match[3]];
    if (!setting) {
      return envelope('URI_NOT_FOUND');
    }
    const [, method, , cname] = match;
    if (method === 'GET') {
      return envelope('SUCCESS', {
        ITEMS: [
          {
            CNAME: cname,
            HASHVAL: setting.hashval,
            NAME: cname,
            TYPE: cname === 'volume' ? 'T_VALUE_V1' : 'T_LIST_V1',
            VALUE: setting.value,
          },
        ],
      });
    }
    if (payload?.REQUEST !== 'MODIFY') {
      return envelope('INVALID_PARAMETER');
    }
    if (Number(payload.HASHVAL) !== setting.hashval) {
      return envelope('HASHVAL_ERROR');
    }
    setting.value = payload.VALUE;
    setting.hashval = nextHash();
    return envelope('SUCCESS', { ITEMS: [{ HASHVAL: setting.hashval, NAME: cname }] });
  }
}

/**
 * The network of the tests: SmartCast devices by IP address. A device that is
 * not `online` (Eco mode, unplugged) does not answer: EHOSTUNREACH; a wrong
 * port is refused.
 * @param {Record<string, FakeVizio>} devices
 */
export function createNetwork(devices) {
  const network = {
    devices,
    requests: [],
    async request({ host, port, method, path, headers, body }) {
      network.requests.push({ host, port, method, path });
      const device = network.devices[host];
      if (!device || !device.online) {
        throw Object.assign(new Error(`connect EHOSTUNREACH ${host}:${port}`), {
          code: 'EHOSTUNREACH',
        });
      }
      if (port !== device.port) {
        throw Object.assign(new Error(`connect ECONNREFUSED ${host}:${port}`), {
          code: 'ECONNREFUSED',
        });
      }
      const { status, body: answer } = device.handle({ method, path, headers, body });
      return { status, body: answer };
    },
  };
  return network;
}
