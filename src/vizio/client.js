// -----------------------------------------------------------------------------
// SmartCast API client: one instance per device address. HTTPS on port 7345
// (TVs) or 9000 (sound bars, older TVs), JSON both ways. TVs want the token
// obtained by PIN pairing in an `AUTH` header (not `Authorization`); sound bars
// want none. Endpoints and payloads from pyvizio and vizaio (MIT), checked
// against the captures of vizaio (test/fixtures/vizio/).
//
// Every failure is a VizioApiError with a `kind` (ERROR_KINDS): the hub turns
// the kinds into states, log lines and messages. A message never holds the
// token.
// -----------------------------------------------------------------------------

import { httpsRequest } from './http.js';
import {
  DEVICE_KINDS,
  SETTINGS_ROOTS,
  matchInput,
  parseAuthToken,
  parseChallenge,
  parseCurrentApp,
  parseCurrentInput,
  parseDeviceInfo,
  parseEnvelope,
  parseInputs,
  parsePowerMode,
  parseSerialItem,
  parseSetting,
  parseSettingOptions,
  parseStateExtended,
  settingNames,
} from './model.js';

export const DEFAULT_PORTS = [7345, 9000];

export const ERROR_KINDS = Object.freeze({
  // Nothing answers: off in Eco mode, unplugged, wrong address.
  UNREACHABLE: 'unreachable',
  // HTTP 401/403 or REQUIRES_PAIRING: no token, or a token the TV forgot.
  AUTH: 'auth',
  // Something answers, but not the SmartCast API.
  NOT_SMARTCAST: 'notSmartcast',
  // URI_NOT_FOUND: this firmware has no such endpoint.
  NOT_FOUND: 'notFound',
  // INVALID_PARAMETER, HASHVAL_ERROR: a write the device refused.
  INVALID: 'invalid',
  // The PIN typed is not the one shown (PAIRING_DENIED, CHALLENGE_INCORRECT).
  PIN: 'pin',
  // Too many tries, too many paired devices: the TV decides when to accept again.
  PAIRING_BLOCKED: 'pairingBlocked',
  // BUSY, ABORTED: try again.
  BUSY: 'busy',
  // Any other refusal (FAILURE, HTTP 500...).
  API: 'api',
});

const RESULT_KINDS = {
  uri_not_found: ERROR_KINDS.NOT_FOUND,
  invalid_parameter: ERROR_KINDS.INVALID,
  hashval_error: ERROR_KINDS.INVALID,
  value_out_of_range: ERROR_KINDS.INVALID,
  requires_pairing: ERROR_KINDS.AUTH,
  requires_system_pin: ERROR_KINDS.AUTH,
  requires_new_system_pin: ERROR_KINDS.AUTH,
  pairing_denied: ERROR_KINDS.PIN,
  challenge_incorrect: ERROR_KINDS.PIN,
  blocked: ERROR_KINDS.PAIRING_BLOCKED,
  max_challenges_exceeded: ERROR_KINDS.PAIRING_BLOCKED,
  too_many_paired_devices: ERROR_KINDS.PAIRING_BLOCKED,
  busy: ERROR_KINDS.BUSY,
  aborted: ERROR_KINDS.BUSY,
};

export class VizioApiError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message
   * @param {{ result?: string, status?: number }} [details]
   */
  constructor(kind, message, { result, status } = {}) {
    super(message);
    this.name = 'VizioApiError';
    this.kind = kind;
    this.result = result ?? null;
    this.status = status ?? null;
  }
}

/** Throw the error a non-success envelope stands for. */
function check(envelope, path) {
  if (envelope.result === 'success') {
    return envelope;
  }
  const kind = RESULT_KINDS[envelope.result] ?? ERROR_KINDS.API;
  throw new VizioApiError(kind, `${path}: ${envelope.result.toUpperCase() || 'no result'}`, {
    result: envelope.result,
  });
}

const keyList = (codes) => ({
  KEYLIST: codes.map(([codeset, code]) => ({ CODESET: codeset, CODE: code, ACTION: 'KEYPRESS' })),
});

export class SmartCastClient {
  /**
   * @param {object} options
   * @param {string} options.host
   * @param {number|null} [options.port] null: found by trying DEFAULT_PORTS
   * @param {string|null} [options.token] TV auth token
   * @param {string} [options.kind] DEVICE_KINDS (from the device info)
   * @param {Function} [options.request] HTTPS seam (src/vizio/http.js)
   */
  constructor({ host, port = null, token = null, kind = DEVICE_KINDS.TV, request = httpsRequest }) {
    this.host = host;
    this.port = port;
    this.token = token;
    this.kind = kind;
    this.request = request;
  }

  get root() {
    return SETTINGS_ROOTS[this.kind] ?? SETTINGS_ROOTS.tv;
  }

  get address() {
    return this.port ? `${this.host}:${this.port}` : this.host;
  }

  /** One request on a given port: the parsed JSON, or a VizioApiError. */
  async exchange(port, method, path, { body, auth = true } = {}) {
    const headers = {};
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (auth && this.token) {
      headers.AUTH = this.token;
    }
    let response;
    try {
      response = await this.request({
        host: this.host,
        port,
        method,
        path,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new VizioApiError(
        ERROR_KINDS.UNREACHABLE,
        `${this.host}:${port} does not answer (${err.code ?? err.message})`,
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new VizioApiError(ERROR_KINDS.AUTH, `${path}: HTTP ${response.status}`, {
        status: response.status,
      });
    }
    let json;
    try {
      json = JSON.parse(response.body);
    } catch {
      json = undefined;
    }
    if (response.status !== 200) {
      // A SmartCast refusal sometimes comes with its envelope.
      const envelope = json === undefined ? null : parseEnvelope(json);
      if (envelope && envelope.result && envelope.result !== 'success') {
        check(envelope, path);
      }
      throw new VizioApiError(ERROR_KINDS.API, `${path}: HTTP ${response.status}`, {
        status: response.status,
      });
    }
    if (json === undefined || json === null || typeof json !== 'object') {
      throw new VizioApiError(ERROR_KINDS.NOT_SMARTCAST, `${path}: not a SmartCast answer`);
    }
    return json;
  }

  /**
   * Find the port when it is not known: the device info answers without a
   * token on the port of the API.
   * @returns {Promise<object>} the parsed device info
   */
  async locate() {
    const ports = this.port ? [this.port] : DEFAULT_PORTS;
    let lastError;
    for (const port of ports) {
      try {
        const info = await this.readDeviceInfo(port);
        this.port = port;
        return info;
      } catch (err) {
        if (!(err instanceof VizioApiError)) {
          throw err;
        }
        lastError = err;
      }
    }
    throw lastError;
  }

  /** A request on the known port (found first when needed), envelope checked. */
  async call(method, path, options = {}) {
    if (!this.port) {
      await this.locate();
    }
    const json = await this.exchange(this.port, method, path, options);
    const envelope = parseEnvelope(json);
    if (!envelope) {
      throw new VizioApiError(ERROR_KINDS.NOT_SMARTCAST, `${path}: not a SmartCast answer`);
    }
    return check(envelope, path);
  }

  async readDeviceInfo(port) {
    const path = '/state/device/deviceinfo';
    const envelope = parseEnvelope(await this.exchange(port, 'GET', path, { auth: false }));
    if (!envelope) {
      throw new VizioApiError(ERROR_KINDS.NOT_SMARTCAST, `${path}: not a SmartCast answer`);
    }
    return parseDeviceInfo(check(envelope, path));
  }

  /**
   * Who the device is (no token needed): serial number, model, name, kind.
   * Older firmware has no serial number in the device info: it is read in
   * the settings tree, at the path of its generation.
   */
  async deviceInfo() {
    const info = this.port ? await this.readDeviceInfo(this.port) : await this.locate();
    this.kind = info.kind;
    if (!info.serial) {
      const branch = info.kind === DEVICE_KINDS.SOUNDBAR ? 'speaker_information' : 'tv_information';
      for (const parent of ['admin_and_privacy/system_information', 'system/system_information']) {
        try {
          const envelope = await this.call(
            'GET',
            `/menu_native/dynamic/${this.root}/${parent}/${branch}/serial_number`,
            { auth: false },
          );
          info.serial = parseSerialItem(envelope);
          if (info.serial) {
            break;
          }
        } catch (err) {
          if (![ERROR_KINDS.NOT_FOUND, ERROR_KINDS.AUTH, ERROR_KINDS.API].includes(err.kind)) {
            throw err;
          }
        }
      }
    }
    return info;
  }

  /** On (true) or in standby (false). */
  async powerState() {
    return parsePowerMode(await this.call('GET', '/state/device/power_mode'));
  }

  /** Power, input and app in one request (recent TV firmware). */
  async stateExtended() {
    if (!this.port) {
      await this.locate();
    }
    const json = await this.exchange(this.port, 'GET', '/state_extended');
    // No envelope on success; an envelope when refused (URI_NOT_FOUND...).
    const envelope = parseEnvelope(json);
    if (envelope) {
      check(envelope, '/state_extended');
    }
    return parseStateExtended(json);
  }

  inputPaths() {
    return this.kind === DEVICE_KINDS.SOUNDBAR
      ? {
          list: '/menu_native/dynamic/audio_settings/input',
          current: '/menu_native/dynamic/audio_settings/input/current_input',
        }
      : {
          list: `/menu_native/dynamic/${this.root}/devices/name_input`,
          current: `/menu_native/dynamic/${this.root}/devices/current_input`,
        };
  }

  /** The input in front: `{ value, hashval }` (`SMARTCAST`, `HDMI-1`...). */
  async currentInput() {
    return parseCurrentInput(await this.call('GET', this.inputPaths().current));
  }

  async inputs() {
    return parseInputs(await this.call('GET', this.inputPaths().list));
  }

  /**
   * Switch to an input. Recent firmware wants its cname (`hdmi2`, vizaio on
   * hardware), older firmware its meta name (pyvizio): the cname first, then
   * the meta name. Asking for the input already in front is a FAILURE on the
   * device: skipped.
   * @param {{ cname: string, name: string, meta: string }} input
   */
  async setInput(input) {
    const { current } = this.inputPaths();
    const before = await this.currentInput();
    if (before && matchInput([input], before.value)) {
      return;
    }
    const put = async (value) => {
      const state = await this.currentInput();
      await this.call('PUT', current, {
        body: { REQUEST: 'MODIFY', VALUE: value, HASHVAL: Number(state?.hashval ?? 0) },
      });
    };
    try {
      await put(input.cname);
    } catch (err) {
      if (![ERROR_KINDS.INVALID, ERROR_KINDS.API].includes(err.kind)) {
        throw err;
      }
      await put(input.meta);
    }
  }

  /** The app in front (TVs): `{ appId, nameSpace, message }`, or null. */
  async currentApp() {
    return parseCurrentApp(await this.call('GET', '/app/current'));
  }

  /** @param {{ appId: string, nameSpace: number, message: string|null }} config */
  async launchApp(config) {
    await this.call('PUT', '/app/launch', {
      body: {
        VALUE: { APP_ID: config.appId, NAME_SPACE: config.nameSpace, MESSAGE: config.message },
      },
    });
  }

  /** The cnames of a settings group that carry a value (`audio`, `picture`). */
  async settingNames(group) {
    return settingNames(await this.call('GET', `/menu_native/dynamic/${this.root}/${group}`));
  }

  /**
   * The values of a settings group in one request (`audio`: volume, mute,
   * eq...), by cname. Some firmware leaves `volume` out of the group while
   * its own path answers (vizaio, home-assistant/core#179254): read it there.
   */
  async settingValues(group) {
    const envelope = await this.call('GET', `/menu_native/dynamic/${this.root}/${group}`);
    const values = {};
    for (const cname of settingNames(envelope)) {
      values[cname] = parseSetting(envelope, cname)?.value;
    }
    return values;
  }

  /** One setting: `{ value, hashval, type }`, null when absent. */
  async setting(group, cname) {
    return parseSetting(
      await this.call('GET', `/menu_native/dynamic/${this.root}/${group}/${cname}`),
      cname,
    );
  }

  /** The bounds and choices of a settings group. */
  async settingOptions(group) {
    return parseSettingOptions(await this.call('GET', `/menu_native/static/${this.root}/${group}`));
  }

  /**
   * Write a setting: its HASHVAL is read first (it changes between reads),
   * and read again once if the device says it is stale.
   */
  async writeSetting(group, cname, value) {
    const path = `/menu_native/dynamic/${this.root}/${group}/${cname}`;
    const put = async () => {
      const current = parseSetting(await this.call('GET', path), cname);
      if (!current) {
        throw new VizioApiError(ERROR_KINDS.NOT_FOUND, `${path}: no ${cname} setting`);
      }
      await this.call('PUT', path, {
        body: { REQUEST: 'MODIFY', VALUE: value, HASHVAL: Number(current.hashval ?? 0) },
      });
    };
    try {
      await put();
    } catch (err) {
      if (err.kind !== ERROR_KINDS.INVALID) {
        throw err;
      }
      await put();
    }
  }

  /** Remote key presses, in order, in one request. @param {Array<[number, number]>} codes */
  async pressKeys(codes) {
    if (codes.length > 0) {
      await this.call('PUT', '/key_command/', { body: keyList(codes) });
    }
  }

  /** Ask the TV to show a PIN: the challenge to send back with it. */
  async startPairing(deviceId, deviceName) {
    const envelope = await this.call('PUT', '/pairing/start', {
      auth: false,
      body: { DEVICE_ID: deviceId, DEVICE_NAME: deviceName },
    });
    const challenge = parseChallenge(envelope);
    if (!challenge) {
      throw new VizioApiError(ERROR_KINDS.API, '/pairing/start: no challenge in the answer');
    }
    return challenge;
  }

  /** Send the PIN back: the auth token of this client on this TV. */
  async finishPairing(deviceId, challenge, pin) {
    const envelope = await this.call('PUT', '/pairing/pair', {
      auth: false,
      body: {
        DEVICE_ID: deviceId,
        CHALLENGE_TYPE: challenge.type,
        PAIRING_REQ_TOKEN: challenge.token,
        RESPONSE_VALUE: String(pin),
      },
    });
    const token = parseAuthToken(envelope);
    if (!token) {
      throw new VizioApiError(ERROR_KINDS.API, '/pairing/pair: no token in the answer');
    }
    return token;
  }

  /** Close a pairing left open: the TV stays in pairing mode otherwise. */
  async cancelPairing(deviceId, deviceName) {
    await this.call('PUT', '/pairing/cancel', {
      auth: false,
      body: { DEVICE_ID: deviceId, DEVICE_NAME: deviceName },
    });
  }
}
