// -----------------------------------------------------------------------------
// The VIZIO hub: one record per SmartCast device (TV or sound bar), keyed by
// serial number, found by the core's mDNS discovery and by the addresses of
// the configuration. It reads the devices on a timer of the container (the
// interval chosen in the configuration), publishes their states when they
// change, fires the "app or input changed" scene event, runs every command
// (features, widgets, scene actions) and the PIN pairing of the TVs.
//
// A TV in standby answers in Quick Start mode (its power state only is read);
// in Eco mode its network sleeps: it does not answer, and is shown off.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { parseHost } from './config.js';
import {
  DEFAULT_MAX_VOLUME,
  FEATURE_KEYS,
  HOME_OPTION,
  OTHER_OPTION,
  buildDevice,
  deviceIds,
  deviceName,
  featureValues,
  onScreen,
  serialOf,
} from './devices.js';
import { APPS, appNameOf, findApp, slug } from './vizio/apps.js';
import { ERROR_KINDS, SmartCastClient } from './vizio/client.js';
import { CODES, KEYS, hasKey } from './vizio/keys.js';
import { DEVICE_KINDS, isAppInput, matchInput } from './vizio/model.js';
import {
  CONNECTION_TEXT,
  ERROR_TEXT,
  PAIR_TEXT,
  REPORT_TEXT,
  allLanguages,
  failure,
  labelled,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'vizio-hub' });

// Widget keys (manifest `widgets`): permanent once published.
export const WIDGET_KEYS = Object.freeze({
  REMOTE: 'remote',
  SHORTCUTS: 'shortcuts',
  KEYS: 'keys',
});

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  CONTENT_CHANGED: 'content_changed',
});

// What is now in front (`kind` filter and variable of the trigger).
export const CONTENT_KINDS = Object.freeze({ APP: 'app', INPUT: 'input' });

// The name this Gladys shows in the TV's list of paired devices.
export const PAIRING_NAME = 'Gladys';

export const HUB_TIMINGS = {
  // The input list, read again while the device is on.
  inputsMs: 30 * 60_000,
  // The bounds and choices of the settings (volume scale, modes).
  optionsMs: 24 * 60 * 60_000,
  // An address that did not answer yet is tried again this often.
  unidentifiedMs: 60_000,
  // A device that stopped answering is looked for by mDNS at most this often.
  relocateMs: 30 * 60_000,
  // Read again this long after a command, to show its effect.
  afterCommandMs: [1_500, 5_000],
  // After a power on: read at these delays (a TV takes a few seconds).
  afterPowerOnMs: [2_000, 5_000, 10_000],
  // A command that needs the screen on waits this long for it.
  powerOnWaitMs: 15_000,
  powerOnCheckMs: 1_000,
  // A feature command still running after this is acknowledged to Gladys.
  featureAckMs: 4_000,
  // A PIN not entered by then: the pairing is closed on the TV.
  pairingMs: 5 * 60_000,
  // An unchanged state is published again this often ("no recent value").
  heartbeatMs: 6 * 60 * 60_000,
  // Length of an mDNS scan by the core.
  mdnsSeconds: 4,
};

// Failed reads in a row before the device is looked for elsewhere (DHCP).
const FAILURES_BEFORE_RELOCATE = 3;
// Failures of a read that do not mean "this device is misconfigured".
const TRANSIENT = new Set([ERROR_KINDS.UNREACHABLE, ERROR_KINDS.BUSY]);
const MAX_KEY_PRESSES = 50;
const MAX_KEY_REPEAT = 10;

const emptySnapshot = () => ({
  reachable: null,
  power: null,
  powerMode: null,
  volume: null,
  muted: null,
  input: null,
  app: null,
  pictureMode: null,
  soundMode: null,
});

const isOn = (record) => record.snapshot.power === true;

export class VizioHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTPS seam (src/vizio/http.js)
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   * @param {(ms: number) => Promise<void>} [options.sleep]
   */
  constructor({ gladys, store, request, timers = true, timings, now, sleep }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.sleep = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.config = null;
    /** @type {Map<string, object>} device records, by serial number */
    this.records = new Map();
    /** Addresses that did not answer as a SmartCast device: host -> { host, port, error, at }. */
    this.unidentified = new Map();
    /** Pairings waiting for their PIN, by serial number. */
    this.pairings = new Map();
    this.transports = new Map();
    this.connection = null;
    this.devicesKey = null;
    this.saved = { clientId: null, devices: {} };
    this.pollTimer = null;
    this.stopped = false;
    this.lastRelocateAt = -Infinity;
    /** Whether the core's mDNS scan failed (one warning, not one per scan). */
    this.mdnsUnavailable = false;
    /** What keeps failing (a Gladys call, the poll): logged once, not each time. */
    this.failing = new Set();
  }

  get language() {
    return this.config?.language ?? 'fr';
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.saved = {
      // The identity this Gladys pairs under: one token per (TV, client id).
      clientId:
        typeof saved.clientId === 'string' && saved.clientId
          ? saved.clientId
          : `gladys-${randomBytes(4).toString('hex')}`,
      devices: saved.devices && typeof saved.devices === 'object' ? saved.devices : {},
    };
    for (const [serial, data] of Object.entries(this.saved.devices)) {
      if (data && typeof data.host === 'string' && data.host) {
        this.records.set(serial, this.newRecord(serial, data));
      }
    }
    if (saved.clientId !== this.saved.clientId) {
      this.store.save(this.saved);
    }
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.transports.clear();
    this.connection = null;
    this.devicesKey = null;
    await this.reconfigure(config, { scan: false });
  }

  async reconfigure(config, { scan = true } = {}) {
    this.config = config;
    if (config.invalidHosts.length > 0) {
      logger.warn(`Addresses not understood: ${config.invalidHosts.join(', ')}`);
    }
    if (config.unknownApps.length > 0) {
      logger.warn(`Favorite apps not in the catalog: ${config.unknownApps.join(', ')}`);
    }
    // The language of the names and the favorite apps may have changed.
    this.devicesKey = null;
    await this.discover({ scan });
    await this.pollAll({ full: true });
    this.schedulePoll();
  }

  newRecord(serial, data = {}) {
    const kind = data.kind === DEVICE_KINDS.SOUNDBAR ? DEVICE_KINDS.SOUNDBAR : DEVICE_KINDS.TV;
    const token = typeof data.token === 'string' && data.token ? data.token : null;
    const port = Number.isInteger(data.port) ? data.port : null;
    return {
      serial,
      host: data.host,
      port,
      kind,
      token,
      identity: data.identity && typeof data.identity === 'object' ? data.identity : {},
      inputs: Array.isArray(data.inputs) ? data.inputs : [],
      maxVolume: Number.isInteger(data.maxVolume) ? data.maxVolume : DEFAULT_MAX_VOLUME[kind],
      pictureModes: Array.isArray(data.pictureModes) ? data.pictureModes : [],
      soundModes: Array.isArray(data.soundModes) ? data.soundModes : [],
      client: this.newClient({ host: data.host, port, token, kind }),
      snapshot: emptySnapshot(),
      error: null,
      warned: null,
      failures: 0,
      readAt: 0,
      inputsAt: 0,
      optionsAt: 0,
      commandSeq: 0,
      polling: null,
      timers: new Set(),
    };
  }

  newClient(options) {
    return new SmartCastClient({ ...options, request: this.request });
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    for (const record of this.records.values()) {
      for (const timer of record.timers) {
        clearTimeout(timer);
      }
      record.timers.clear();
    }
    // A pairing left open keeps the TV in pairing mode: close it.
    await Promise.allSettled(
      [...this.pairings.keys()].map((serial) => this.closePairing(this.records.get(serial))),
    );
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        // While the SDK reconnects, nothing could be published.
        if (this.gladys.connected !== false) {
          await this.pollAll();
        }
        this.recovered('Poll');
      } catch (err) {
        this.failedOnce('Poll', 'error', 'Poll failed', err);
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  /** Read one device again after these delays (a command's effect, a power on). */
  readLater(record, delays) {
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    for (const delay of delays) {
      const timer = setTimeout(() => {
        record.timers.delete(timer);
        this.poll(record)
          .then((changed) => this.afterChanges(changed))
          .catch((err) => this.failedOnce('Poll', 'error', 'Read failed', err));
      }, delay);
      timer.unref?.();
      record.timers.add(timer);
    }
  }

  // --- Discovery -------------------------------------------------------------

  /** The SmartCast services the core sees on the LAN: [{ host, port }]. */
  async scanMdns({ quiet = false } = {}) {
    try {
      const services = await this.gladys.scanNetwork('mdns', {
        timeoutSeconds: this.timings.mdnsSeconds,
      });
      const found = [];
      for (const service of services ?? []) {
        const addresses = Array.isArray(service.addresses) ? service.addresses : [];
        const host = addresses.find((address) => /^\d+(\.\d+){3}$/.test(address)) ?? addresses[0];
        if (host && !found.some((item) => item.host === host)) {
          found.push({ host, port: Number.isInteger(service.port) ? service.port : null });
        }
      }
      if (this.mdnsUnavailable) {
        logger.info('mDNS discovery works again');
      }
      this.mdnsUnavailable = false;
      logger.debug(`mDNS: ${found.length} SmartCast service(s)`);
      return found;
    } catch (err) {
      // 403: a core without mediated discovery; said once.
      logger[this.mdnsUnavailable || quiet ? 'debug' : 'warn'](
        `mDNS discovery unavailable (${err.status ?? ''} ${err.message}): typed addresses only`,
      );
      this.mdnsUnavailable = true;
      return [];
    }
  }

  /**
   * Find the devices: the core's mDNS scan and the typed addresses. Each
   * address is asked who it is (no token needed); the serial number makes
   * the record.
   */
  async discover({ scan = true, quiet = false } = {}) {
    const candidates = new Map();
    const add = (host, port, source) => {
      if (host && !candidates.has(host)) {
        candidates.set(host, { host, port, source });
      }
    };
    // Typed addresses first: their problems are reported, mDNS ones are not.
    for (const typed of this.config.hosts) {
      add(typed.host, typed.port, 'config');
    }
    if (scan) {
      for (const service of await this.scanMdns({ quiet })) {
        add(service.host, service.port, 'mdns');
      }
    }
    // Addresses typed earlier and removed since are forgotten.
    for (const host of [...this.unidentified.keys()]) {
      if (!candidates.has(host) || candidates.get(host).source !== 'config') {
        this.unidentified.delete(host);
      }
    }
    await Promise.all([...candidates.values()].map((candidate) => this.probe(candidate)));
  }

  /** Ask an address who it is; returns the record, null when it is not identified. */
  async probe({ host, port, source }) {
    const client = this.newClient({ host, port });
    let info;
    try {
      info = await client.deviceInfo();
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      this.markUnidentified({ host, port, source }, err.kind, err.message);
      return null;
    }
    if (!info.serial) {
      this.markUnidentified({ host, port, source }, 'noSerial', 'no serial number');
      return null;
    }
    if (this.unidentified.delete(host)) {
      logger.info(`${host}: answers now`);
    }
    return this.upsertRecord(info, host, client.port);
  }

  markUnidentified({ host, port, source }, kind, message) {
    const known = this.unidentified.get(host);
    // A typed address said once (warning), an mDNS one quietly: it may be
    // another SmartCast service the core sees (a Cast speaker...).
    if (source === 'config' && known?.error !== kind) {
      logger.warn(`${host}: ${message}`);
    } else {
      logger.debug(`${host} (${source}): ${message}`);
    }
    if (source === 'config') {
      this.unidentified.set(host, { host, port, error: kind, at: this.now() });
    }
  }

  /** Create or update the record of an identified device. */
  upsertRecord(info, host, port) {
    const identity = {
      model: info.model,
      name: info.name,
      apiVersion: info.apiVersion,
      firmware: info.firmware,
      stateExtended: info.stateExtended,
      tuner: info.tuner,
      pictureModes: info.pictureModes,
    };
    let record = this.records.get(info.serial);
    if (!record) {
      record = this.newRecord(info.serial, { host, port, kind: info.kind, identity });
      this.records.set(info.serial, record);
      const what = info.kind === DEVICE_KINDS.SOUNDBAR ? 'sound bar' : 'TV';
      logger.info(
        `Found VIZIO ${what} ${info.model ?? ''} "${deviceName(record)}" at ${host}:${port}`,
      );
      this.saveRecord(record);
      return record;
    }
    if (record.host !== host || record.port !== port) {
      logger.info(`${this.label(record)}: address changed to ${host}:${port}`);
      record.host = host;
      record.port = port;
      record.client = this.newClient({ host, port, token: record.token, kind: record.kind });
      record.failures = 0;
    }
    // A firmware update can change the capabilities; keep what was learned.
    const merged = {
      ...identity,
      stateExtended: info.stateExtended ?? record.identity.stateExtended ?? null,
    };
    if (JSON.stringify(record.identity) !== JSON.stringify(merged)) {
      record.identity = merged;
    }
    this.saveRecord(record);
    return record;
  }

  /** "Search" in the Discovery tab: scan, read the devices and their lists again, publish. */
  async rediscover() {
    this.devicesKey = null;
    await this.discover({ scan: true });
    await this.pollAll({ full: true });
  }

  // --- Devices -----------------------------------------------------------------

  /** A sound bar needs no token; a TV is published once paired. */
  isPublished(record) {
    return Boolean(record) && (record.kind === DEVICE_KINDS.SOUNDBAR || Boolean(record.token));
  }

  /** Publish the devices; only when something changed. */
  async publishDevices() {
    const devices = [...this.records.values()]
      .filter((record) => this.isPublished(record))
      .map((record) => buildDevice(this.gladys, record, this.config));
    const key = JSON.stringify(devices);
    if (key === this.devicesKey) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.devicesKey = key;
      this.recovered('Devices');
    } catch (err) {
      this.failedOnce('Devices', 'warn', `Devices refused: ${err.message}`);
    }
  }

  /** The user added a device: send its states now (the SDK forgot them). */
  async onDeviceCreated(device) {
    const record = this.recordOfDevice(device.external_id);
    if (!record) {
      return;
    }
    await this.publishStates(record);
    this.refreshWidgets();
  }

  refreshWidgets() {
    for (const key of Object.values(WIDGET_KEYS)) {
      this.gladys.requestWidgetRefresh(key);
    }
  }

  recordOfDevice(externalId) {
    const serial = serialOf(this.gladys, externalId);
    return serial ? (this.records.get(serial) ?? null) : null;
  }

  saveRecord(record) {
    this.saved.devices[record.serial] = {
      host: record.host,
      port: record.port,
      kind: record.kind,
      token: record.token,
      identity: record.identity,
      inputs: record.inputs,
      maxVolume: record.maxVolume,
      pictureModes: record.pictureModes,
      soundModes: record.soundModes,
    };
    this.store.save(this.saved);
  }

  label(record) {
    return `${deviceName(record)} (${record.host})`;
  }

  // --- Reading the devices ---------------------------------------------------------

  async pollAll({ full = false } = {}) {
    await this.retryUnidentified();
    const changes = await Promise.all(
      [...this.records.values()].map((record) => this.poll(record, { full })),
    );
    await this.relocate();
    await this.publishDevices();
    await this.afterChanges(changes.some(Boolean));
  }

  /** Typed addresses that did not answer yet are tried again, not at every poll. */
  async retryUnidentified() {
    const due = [...this.unidentified.values()].filter(
      (entry) => this.now() - entry.at >= this.timings.unidentifiedMs,
    );
    await Promise.all(due.map((entry) => this.probe({ ...entry, source: 'config' })));
  }

  /**
   * A device found by mDNS that stopped answering may have another address
   * (DHCP): one quiet mDNS scan finds it by its serial number. A TV in Eco
   * mode does not answer every night: at most one scan every relocateMs.
   */
  async relocate() {
    const lost = [...this.records.values()].some(
      (record) =>
        record.failures >= FAILURES_BEFORE_RELOCATE &&
        !this.config.hosts.some((typed) => typed.host === record.host),
    );
    if (!lost || this.now() - this.lastRelocateAt < this.timings.relocateMs) {
      return;
    }
    this.lastRelocateAt = this.now();
    const known = new Set([...this.records.values()].map((record) => record.host));
    const services = (await this.scanMdns({ quiet: true })).filter(
      (service) => !known.has(service.host),
    );
    await Promise.all(services.map((service) => this.probe({ ...service, source: 'mdns' })));
  }

  /**
   * Read one device and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widgets show something new
   */
  poll(record, { full = false } = {}) {
    const current = record.polling;
    // A read in flight answers for this one, unless a command ran since it
    // started (its states are stale) or it does not read what `full` asks.
    if (current && current.seq === record.commandSeq && (current.full || !full)) {
      return current.promise;
    }
    const entry = { seq: record.commandSeq, full, promise: null };
    const previous = current ? current.promise.catch(() => {}) : Promise.resolve();
    entry.promise = previous
      .then(() => {
        entry.seq = record.commandSeq;
        return this.read(record, { full });
      })
      .finally(() => {
        if (record.polling === entry) {
          record.polling = null;
        }
      });
    record.polling = entry;
    return entry.promise;
  }

  /** The core polled a device (should_poll fallback): read it unless the timer just did. */
  async corePoll(device) {
    const record = this.recordOfDevice(device.external_id);
    if (!record) {
      return;
    }
    if (this.now() - record.readAt < this.config.pollIntervalMs * 0.9) {
      logger.debug(
        `${this.label(record)}: read ${this.now() - record.readAt} ms ago, core poll skipped`,
      );
      return;
    }
    await this.afterChanges(await this.poll(record));
  }

  /** A command starts or ends: the reads in flight are stale. */
  markCommand(record) {
    record.commandSeq += 1;
  }

  /**
   * Something that fails at every try (Gladys restarting, a bug in a read):
   * one line at the first failure, debug while it lasts, one line once it
   * works again (`recovered`).
   */
  failedOnce(key, level, ...args) {
    if (this.failing.has(key)) {
      logger.debug(...args);
      return;
    }
    this.failing.add(key);
    logger[level](...args);
  }

  recovered(key) {
    if (this.failing.delete(key)) {
      logger.info(`${key}: working again`);
    }
  }

  /**
   * The problem of a device, shown in the connection status. A warning when a
   * real problem appears (a token refused...), one line when it is gone; a
   * device asleep or busy is no problem: debug only.
   */
  setError(record, error) {
    const previous = record.error;
    record.error = error ? { kind: error.kind, message: error.message } : null;
    if (previous?.kind === record.error?.kind) {
      return;
    }
    if (!record.error) {
      if (record.warned) {
        record.warned = null;
        logger.info(`${this.label(record)}: answers normally again`);
      }
    } else if (TRANSIENT.has(record.error.kind)) {
      logger.debug(`${this.label(record)}: ${record.error.message}`);
    } else {
      record.warned = record.error.kind;
      logger.warn(`${this.label(record)}: ${record.error.message}`);
    }
  }

  /** Power, input and app: one request on recent TV firmware, two or three otherwise. */
  async readPower(record) {
    const { client } = record;
    if (record.kind === DEVICE_KINDS.TV && record.identity.stateExtended !== false) {
      try {
        const extended = await client.stateExtended();
        if (record.identity.stateExtended !== true) {
          record.identity.stateExtended = true;
          this.saveRecord(record);
        }
        return extended;
      } catch (err) {
        if (
          ![ERROR_KINDS.NOT_FOUND, ERROR_KINDS.API, ERROR_KINDS.NOT_SMARTCAST].includes(err.kind)
        ) {
          throw err;
        }
        logger.debug(`${this.label(record)}: no /state_extended (${err.message})`);
        record.identity.stateExtended = false;
        this.saveRecord(record);
      }
    }
    return { power: await client.powerState(), powerMode: null, input: undefined, app: undefined };
  }

  async read(record, { full }) {
    // A TV says nothing without its token: it waits for the pairing.
    if (!this.isPublished(record)) {
      return false;
    }
    const seq = record.commandSeq;
    const stale = () => record.commandSeq !== seq;
    const { client } = record;
    record.readAt = this.now();
    let power;
    try {
      power = await this.readPower(record);
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      return stale() ? false : this.applyFailure(record, err);
    }
    let error = null;
    // Keep the first configuration problem of this read, ignore the passing ones.
    const attempt = async (what, fn) => {
      try {
        return await fn();
      } catch (err) {
        if (!err.kind) {
          throw err;
        }
        if (!TRANSIENT.has(err.kind) && err.kind !== ERROR_KINDS.NOT_FOUND) {
          error ??= err;
        }
        logger.debug(`${this.label(record)}: ${what} failed: ${err.message}`);
        return undefined;
      }
    };

    const next = { reachable: true, power: power.power, powerMode: power.powerMode ?? null };
    let structureChanged = false;
    if (power.power) {
      structureChanged = await this.readOptions(record, { full, attempt });
      const audio = (await attempt('audio settings', () => client.settingValues('audio'))) ?? {};
      let volume = audio.volume;
      if (volume === undefined) {
        volume = (await attempt('volume', () => client.setting('audio', 'volume')))?.value;
      }
      let mute = audio.mute;
      if (mute === undefined) {
        mute = (await attempt('mute', () => client.setting('audio', 'mute')))?.value;
      }
      next.volume = Number.isFinite(Number(volume)) && volume !== null ? Number(volume) : null;
      next.muted = typeof mute === 'string' ? mute.toLowerCase() === 'on' : null;
      next.soundMode =
        record.soundModes.length > 0 && typeof audio.eq === 'string' ? audio.eq : null;

      let input = power.input;
      if (input === undefined) {
        input = (await attempt('current input', () => client.currentInput()))?.value ?? null;
      }
      next.input = input ?? record.snapshot.input;
      structureChanged =
        (await this.readInputs(record, next.input, { full, attempt })) || structureChanged;

      if (record.kind === DEVICE_KINDS.TV && isAppInput(next.input)) {
        let app = power.app;
        if (app === undefined) {
          app = await attempt('current app', () => client.currentApp());
          app = app === undefined ? (record.snapshot.app ?? null) : app;
        }
        next.app = app ? { ...app, name: app.name ?? appNameOf(app) } : null;
      } else {
        next.app = null;
      }
      if (record.pictureModes.length > 0) {
        const mode = await attempt('picture mode', () => client.setting('picture', 'picture_mode'));
        next.pictureMode = typeof mode?.value === 'string' ? mode.value : null;
      }
    }
    if (stale()) {
      // A command ran meanwhile: what was read may predate it.
      return false;
    }
    if (structureChanged) {
      this.saveRecord(record);
      // The options of the selects first, then the states that use them.
      await this.publishDevices();
    }
    this.setError(record, error);
    return this.applySuccess(record, next);
  }

  /** The input list, when stale or when the input in front is not in it. */
  async readInputs(record, input, { full, attempt }) {
    const now = this.now();
    const unknown = input && !matchInput(record.inputs, input);
    const due =
      full ||
      record.inputs.length === 0 ||
      now - record.inputsAt >= this.timings.inputsMs ||
      (unknown && now - record.inputsAt >= this.timings.unidentifiedMs);
    if (!due) {
      return false;
    }
    const inputs = await attempt('inputs', () => record.client.inputs());
    if (inputs === undefined) {
      return false;
    }
    record.inputsAt = now;
    if (inputs.length > 0 && JSON.stringify(inputs) !== JSON.stringify(record.inputs)) {
      record.inputs = inputs;
      return true;
    }
    return false;
  }

  /** The volume scale and the mode lists, from the device's static settings. */
  async readOptions(record, { full, attempt }) {
    const now = this.now();
    if (!full && record.optionsAt > 0 && now - record.optionsAt < this.timings.optionsMs) {
      return false;
    }
    const before = JSON.stringify([record.maxVolume, record.pictureModes, record.soundModes]);
    const audio = await attempt('audio options', () => record.client.settingOptions('audio'));
    if (audio !== undefined) {
      record.optionsAt = now;
      if (Number.isInteger(audio.volume?.max) && audio.volume.max > 0) {
        record.maxVolume = audio.volume.max;
      }
      record.soundModes = audio.eq?.choices ?? [];
    }
    if (record.kind === DEVICE_KINDS.TV) {
      const picture = await attempt('picture options', () =>
        record.client.settingOptions('picture'),
      );
      if (picture !== undefined) {
        record.pictureModes = picture.picture_mode?.choices ?? [];
      }
    }
    return JSON.stringify([record.maxVolume, record.pictureModes, record.soundModes]) !== before;
  }

  async applySuccess(record, next) {
    const previous = record.snapshot;
    const snapshot = { ...emptySnapshot(), ...next };
    record.failures = 0;
    const widgetChanged =
      previous.reachable !== true ||
      ['power', 'volume', 'muted', 'input', 'pictureMode', 'soundMode'].some(
        (key) => previous[key] !== snapshot[key],
      ) ||
      previous.app?.appId !== snapshot.app?.appId;
    record.snapshot = snapshot;
    await this.contentTransition(record, previous);
    await this.publishStates(record);
    return widgetChanged;
  }

  async applyFailure(record, err) {
    const wasError = record.error?.kind;
    const previous = record.snapshot;
    if (err.kind === ERROR_KINDS.UNREACHABLE) {
      // A TV in Eco mode does not answer at all when off: normal every night,
      // so not an error, and only a debug line. A refused token stays
      // reported until a read proves otherwise.
      record.failures += 1;
      this.setError(record, wasError === ERROR_KINDS.AUTH ? record.error : null);
      record.snapshot = { ...emptySnapshot(), reachable: false, power: false };
      if (previous.reachable !== false) {
        logger.debug(`${this.label(record)}: no answer (${err.message})`);
      }
    } else {
      // Something answered, but not as expected: keep the last known states.
      this.setError(record, err);
    }
    await this.publishStates(record);
    return previous.reachable !== record.snapshot.reachable || wasError !== record.error?.kind;
  }

  /** "App or input changed": something new in front, turning on included. */
  async contentTransition(record, previous) {
    // The first read since the start says nothing about a change.
    if (previous.power === null || !isOn(record)) {
      return;
    }
    const now = onScreen(record, this.language);
    if (!now) {
      return;
    }
    const before =
      previous.power === true ? onScreen({ ...record, snapshot: previous }, this.language) : null;
    if (before && before.kind === now.kind && before.name === now.name) {
      return;
    }
    await this.fire(TRIGGERS.CONTENT_CHANGED, record, { kind: now.kind, name: now.name });
  }

  async fire(key, record, data) {
    try {
      await this.gladys.publishSceneEvent(key, {
        device: deviceIds(this.gladys, record.serial).device,
        tv: deviceName(record),
        ...data,
      });
    } catch (err) {
      this.failedOnce('Scene events', 'warn', `Scene event ${key} refused: ${err.message}`);
      return;
    }
    this.recovered('Scene events');
  }

  // --- Publishing to Gladys ----------------------------------------------------------

  /** The states that changed (the SDK remembers what it sent), and a heartbeat. */
  async publishStates(record) {
    if (!this.isPublished(record)) {
      return;
    }
    const states = featureValues(this.gladys, record, this.config)
      .filter(({ value }) => value !== null)
      .map(({ externalId, value }) =>
        typeof value === 'string'
          ? { device_feature_external_id: externalId, text: value }
          : { device_feature_external_id: externalId, state: value },
      );
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.recovered('States');
    } catch (err) {
      this.failedOnce('States', 'warn', `States of ${this.label(record)} refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged) {
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.refreshWidgets();
    }
  }

  async publishTransports() {
    const entries = [];
    for (const record of this.records.values()) {
      if (!this.isPublished(record) || record.snapshot.reachable === null) {
        continue;
      }
      const externalId = deviceIds(this.gladys, record.serial).device;
      const transport = record.snapshot.reachable
        ? DEVICE_TRANSPORTS.LOCAL
        : DEVICE_TRANSPORTS.UNREACHABLE;
      if (this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
      this.recovered('Transports');
    } catch (err) {
      this.failedOnce('Transports', 'warn', `Transports refused: ${err.message}`);
    }
  }

  /** The problems to show, per language: one entry per device or address. */
  problems(language) {
    const parts = [];
    for (const record of this.records.values()) {
      if (!this.isPublished(record)) {
        parts.push(
          labelled(deviceName(record), pick(ERROR_TEXT.pairingNeeded, language), language),
        );
      } else if (record.error) {
        const text = ERROR_TEXT[record.error.kind] ?? ERROR_TEXT[ERROR_KINDS.API];
        parts.push(labelled(deviceName(record), pick(text, language), language));
      }
    }
    for (const entry of this.unidentified.values()) {
      const text = ERROR_TEXT[entry.error] ?? ERROR_TEXT[ERROR_KINDS.UNREACHABLE];
      parts.push(labelled(entry.host, pick(text, language), language));
    }
    if (this.config.invalidHosts.length > 0) {
      parts.push(pick(CONNECTION_TEXT.invalidHosts, language));
    }
    if (this.config.unknownApps.length > 0) {
      parts.push(
        labelled(
          pick(CONNECTION_TEXT.unknownApps, language),
          this.config.unknownApps.join(', '),
          language,
        ),
      );
    }
    return parts;
  }

  /** The status under the integration name: connected when every device is set up right. */
  connectionStatus() {
    if (this.records.size === 0 && this.unidentified.size === 0) {
      return { connected: false, message: CONNECTION_TEXT.noDevice };
    }
    if (this.problems('en').length === 0) {
      return { connected: true };
    }
    const message = {};
    for (const language of Object.keys(CONNECTION_TEXT.noDevice)) {
      message[language] = this.problems(language).join(' · ').slice(0, 200);
    }
    const working = [...this.records.values()].some(
      (record) => this.isPublished(record) && !record.error,
    );
    return { connected: working, message };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.recovered('Connection status');
    } catch (err) {
      this.failedOnce('Connection status', 'warn', `Connection status refused: ${err.message}`);
    }
  }

  // --- Commands --------------------------------------------------------------------------

  /** The published devices, the ones commands and widgets can act on. */
  published() {
    return [...this.records.values()].filter((record) => this.isPublished(record));
  }

  /**
   * The device a command targets: a device, or the only one when none is chosen.
   * @param {string|null|undefined} deviceExternalId
   */
  target(deviceExternalId) {
    const published = this.published();
    if (!deviceExternalId) {
      if (published.length === 0) {
        throw failure(this.language, this.records.size ? 'notPaired' : 'noDevice');
      }
      if (published.length > 1) {
        throw failure(this.language, 'chooseDevice');
      }
      return published[0];
    }
    const record = this.recordOfDevice(deviceExternalId);
    if (!record) {
      throw failure(this.language, 'unknownDevice');
    }
    if (!this.isPublished(record)) {
      throw failure(this.language, 'notPaired');
    }
    return record;
  }

  /** Run a command on a device; the API errors become a sentence for the user. */
  async command(record, fn) {
    this.markCommand(record);
    try {
      return await fn(record.client);
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      logger.warn(`${this.label(record)}: command failed: ${err.message}`);
      if (err.kind === ERROR_KINDS.AUTH) {
        this.setError(record, err);
      }
      const text = ERROR_TEXT[err.kind] ?? ERROR_TEXT[ERROR_KINDS.API];
      const error = new Error(
        labelled(deviceName(record), pick(text, this.language), this.language),
      );
      error.userFacing = true;
      error.kind = err.kind;
      throw error;
    } finally {
      // The reads that overlapped the command are stale too.
      this.markCommand(record);
    }
  }

  /** The commands ran: publish the optimistic states, read the device soon. */
  async afterCommand(record) {
    await this.publishStates(record);
    this.refreshWidgets();
    this.readLater(record, this.timings.afterCommandMs);
  }

  /** The power feature, the widget button, and the first step of the commands below. */
  async setPower(record, on) {
    if (on && record.snapshot.reachable === false) {
      // Maybe asleep in Eco mode: try, and say why it fails.
      try {
        await this.command(record, (client) => client.pressKeys([CODES.POWER_ON]));
      } catch (err) {
        if (err.kind === ERROR_KINDS.UNREACHABLE) {
          throw failure(this.language, 'asleep');
        }
        throw err;
      }
    } else {
      await this.command(record, (client) =>
        client.pressKeys([on ? CODES.POWER_ON : CODES.POWER_OFF]),
      );
    }
    logger.info(`${this.label(record)}: turned ${on ? 'on' : 'off'} by Gladys`);
    record.snapshot = on
      ? { ...record.snapshot, reachable: true, power: true }
      : { ...emptySnapshot(), reachable: record.snapshot.reachable, power: false };
    await this.afterCommand(record);
    if (on) {
      this.readLater(record, this.timings.afterPowerOnMs);
    }
  }

  /** Commands that need the screen on turn the device on first, and wait for it. */
  async ensureOn(record) {
    if (isOn(record)) {
      return;
    }
    await this.setPower(record, true);
    const deadline = this.now() + this.timings.powerOnWaitMs;
    for (;;) {
      try {
        if (await record.client.powerState()) {
          return;
        }
      } catch {
        // still waking up
      }
      if (this.now() >= deadline) {
        throw failure(this.language, 'notOn');
      }
      await this.sleep(this.timings.powerOnCheckMs);
    }
  }

  async setVolume(record, raw) {
    const volume = Math.max(0, Math.min(record.maxVolume, Math.round(Number(raw) || 0)));
    const known = record.snapshot.volume;
    await this.command(record, async (client) => {
      try {
        await client.writeSetting('audio', 'volume', volume);
      } catch (err) {
        // No writable volume setting: the keys get there from a known level.
        if (
          !Number.isFinite(known) ||
          ![ERROR_KINDS.NOT_FOUND, ERROR_KINDS.INVALID].includes(err.kind)
        ) {
          throw err;
        }
        const delta = volume - known;
        const code = delta > 0 ? CODES.VOLUME_UP : CODES.VOLUME_DOWN;
        await client.pressKeys(Array(Math.min(Math.abs(delta), MAX_KEY_PRESSES)).fill(code));
      }
    });
    record.snapshot = { ...record.snapshot, volume, muted: false };
    await this.afterCommand(record);
    return volume;
  }

  /** Volume up or down by `steps` key presses, in one request. */
  async stepVolume(record, steps) {
    const delta = Math.trunc(steps);
    if (delta === 0) {
      return;
    }
    const code = delta > 0 ? CODES.VOLUME_UP : CODES.VOLUME_DOWN;
    await this.command(record, (client) =>
      client.pressKeys(Array(Math.min(Math.abs(delta), MAX_KEY_PRESSES)).fill(code)),
    );
    const known = record.snapshot.volume;
    if (Number.isFinite(known)) {
      const volume = Math.max(0, Math.min(record.maxVolume, known + delta));
      record.snapshot = { ...record.snapshot, volume };
    }
    await this.afterCommand(record);
  }

  /** SmartCast TVs treat every mute key as a toggle (vizaio): the toggle key. */
  async toggleMute(record) {
    await this.command(record, (client) => client.pressKeys([CODES.MUTE_TOGGLE]));
    if (record.snapshot.muted !== null) {
      record.snapshot = { ...record.snapshot, muted: !record.snapshot.muted };
    }
    await this.afterCommand(record);
  }

  /** An input of a device, by cname or by name ("HDMI 2", "PS5"). */
  findInput(record, query) {
    const wanted = slug(query);
    if (!wanted) {
      return null;
    }
    return (
      matchInput(record.inputs, String(query).trim()) ??
      record.inputs.find((input) =>
        [input.cname, input.name, input.label].some((name) => slug(name) === wanted),
      ) ??
      null
    );
  }

  /** Switch to an input. @returns {Promise<object>} the input */
  async selectInput(record, query) {
    let input = this.findInput(record, query);
    if (!input && isOn(record)) {
      record.inputs = (await this.command(record, (client) => client.inputs())) || record.inputs;
      record.inputsAt = this.now();
      input = this.findInput(record, query);
    }
    if (!input) {
      throw failure(this.language, 'unknownInput', String(query).slice(0, 60));
    }
    await this.ensureOn(record);
    await this.command(record, (client) => client.setInput(input));
    logger.info(`${this.label(record)}: input ${input.label} by Gladys`);
    record.snapshot = {
      ...record.snapshot,
      input: input.cname,
      app: isAppInput(input.cname) ? record.snapshot.app : null,
    };
    await this.afterCommand(record);
    return input;
  }

  /**
   * Open an app by name ("Netflix", "home"), on a TV. "Other" (the option of
   * the select for anything not in the list) does nothing.
   * @returns {Promise<object|null>} the app of the catalog
   */
  async openApp(record, query) {
    if (record.kind !== DEVICE_KINDS.TV) {
      throw failure(this.language, 'tvOnly');
    }
    if (query === OTHER_OPTION) {
      return null;
    }
    const app = query === HOME_OPTION ? APPS[0] : findApp(query);
    if (!app) {
      throw failure(this.language, 'unknownApp', String(query).slice(0, 60));
    }
    await this.ensureOn(record);
    await this.command(record, (client) => client.launchApp(app.config[0]));
    logger.info(`${this.label(record)}: app ${app.name} by Gladys`);
    const cast = record.inputs.find((input) => isAppInput(input.cname));
    record.snapshot = {
      ...record.snapshot,
      input: cast?.cname ?? 'SMARTCAST',
      app: { ...app.config[0], name: app.name },
    };
    await this.afterCommand(record);
    return app;
  }

  /** The picture mode (TVs) or the sound mode (EQ). */
  async setMode(record, key, value) {
    const isPicture = key === FEATURE_KEYS.PICTURE_MODE;
    const modes = isPicture ? record.pictureModes : record.soundModes;
    const mode =
      modes.find((item) => item === value) ?? modes.find((item) => slug(item) === slug(value));
    if (!mode) {
      throw failure(this.language, 'unknownMode', String(value).slice(0, 60));
    }
    await this.command(record, (client) =>
      isPicture
        ? client.writeSetting('picture', 'picture_mode', mode)
        : client.writeSetting('audio', 'eq', mode),
    );
    record.snapshot = { ...record.snapshot, [isPicture ? 'pictureMode' : 'soundMode']: mode };
    await this.afterCommand(record);
  }

  /** A remote control key, `repeat` times, in one request. */
  async sendKey(record, key, repeat = 1) {
    if (!hasKey(record.kind, key)) {
      throw failure(this.language, 'unknownKey', String(key).slice(0, 30));
    }
    const times = Math.max(1, Math.min(MAX_KEY_REPEAT, Math.round(Number(repeat) || 1)));
    await this.command(record, (client) => client.pressKeys(Array(times).fill(KEYS[key].code)));
    await this.afterCommand(record);
    return times;
  }

  /**
   * A feature of a device. Gladys waits 5 s for the answer of a device
   * command (COMMAND_TIMEOUT_MS of the core), while turning a TV on and
   * switching it to an input can take 15: past `featureAckMs`, the command
   * is acknowledged and goes on, its failure logged.
   */
  async setValue(device, feature, value) {
    const work = this.featureCommand(device, feature, value);
    let timer;
    const late = new Promise((resolve) => {
      timer = setTimeout(() => resolve('late'), this.timings.featureAckMs);
      timer.unref?.();
    });
    try {
      const outcome = await Promise.race([work.then(() => 'done'), late]);
      if (outcome === 'late') {
        logger.debug(`${feature.external_id}: still running, acknowledged`);
        work.catch((err) => logger.warn(`${feature.external_id}: ${err.message}`));
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async featureCommand(device, feature, value) {
    const record = this.target(device.external_id);
    const ids = deviceIds(this.gladys, record.serial);
    const key = Object.values(FEATURE_KEYS).find(
      (item) => ids.feature(item) === feature.external_id,
    );
    switch (key) {
      case FEATURE_KEYS.POWER:
        return this.setPower(record, Number(value) === 1);
      case FEATURE_KEYS.VOLUME:
        return this.setVolume(record, value);
      case FEATURE_KEYS.VOLUME_UP:
        return this.stepVolume(record, this.config.volumeStep);
      case FEATURE_KEYS.VOLUME_DOWN:
        return this.stepVolume(record, -this.config.volumeStep);
      case FEATURE_KEYS.MUTE:
        return this.toggleMute(record);
      case FEATURE_KEYS.INPUT:
        return this.selectInput(record, String(value));
      case FEATURE_KEYS.APP:
        return this.openApp(record, String(value));
      case FEATURE_KEYS.PICTURE_MODE:
      case FEATURE_KEYS.SOUND_MODE:
        return this.setMode(record, key, String(value));
      case FEATURE_KEYS.CHANNEL_UP:
        return this.sendKey(record, 'channel_up');
      case FEATURE_KEYS.CHANNEL_DOWN:
        return this.sendKey(record, 'channel_down');
      default:
        throw new Error(`Feature ${feature.external_id} cannot be controlled`);
    }
  }

  // --- Pairing ---------------------------------------------------------------------

  /**
   * The TV a pairing action is about: the typed address, else the only TV
   * waiting for it (or with a PIN pending, for the second action).
   */
  async pairingTarget(address, { pending = false } = {}) {
    const typed = String(address ?? '').trim();
    if (typed) {
      const parsed = parseHost(typed);
      if (!parsed) {
        throw failure(this.language, 'unknownAddress', typed.slice(0, 60));
      }
      const known = [...this.records.values()].find((record) => record.host === parsed.host);
      const record = known ?? (await this.probe({ ...parsed, source: 'action' }));
      if (!record) {
        throw failure(this.language, 'unknownAddress', typed.slice(0, 60));
      }
      return record;
    }
    const tvs = [...this.records.values()].filter((record) => record.kind === DEVICE_KINDS.TV);
    const candidates = pending
      ? tvs.filter((record) => this.pairings.has(record.serial))
      : tvs.filter((record) => !record.token);
    if (candidates.length === 1) {
      return candidates[0];
    }
    if (candidates.length > 1) {
      throw failure(this.language, 'chooseTv');
    }
    if (pending) {
      throw Object.assign(new Error(pick(PAIR_TEXT, this.language).noPairing), {
        userFacing: true,
      });
    }
    // Every TV is paired: pairing the only one again is allowed.
    if (tvs.length === 1) {
      return tvs[0];
    }
    throw failure(this.language, tvs.length ? 'chooseTv' : 'noDevice');
  }

  /** "Start pairing": the TV shows a PIN. */
  async startPairing({ address } = {}) {
    const record = await this.pairingTarget(address);
    const name = deviceName(record);
    if (record.kind === DEVICE_KINDS.SOUNDBAR) {
      return allLanguages(PAIR_TEXT, (text) => text.soundbar(name));
    }
    await this.closePairing(record);
    const client = this.newClient({ host: record.host, port: record.port, kind: record.kind });
    const challenge = await this.command(record, () =>
      client.startPairing(this.saved.clientId, PAIRING_NAME),
    );
    const timer = setTimeout(() => {
      this.closePairing(record).catch(() => {});
    }, this.timings.pairingMs);
    timer.unref?.();
    this.pairings.set(record.serial, { challenge, timer, client });
    logger.info(`${this.label(record)}: pairing started, PIN shown on the TV`);
    return allLanguages(PAIR_TEXT, (text) => text.shown(name));
  }

  /** Close the pairing of a TV left without PIN (the TV stays in pairing mode otherwise). */
  async closePairing(record) {
    const pairing = record ? this.pairings.get(record.serial) : null;
    if (!pairing) {
      return;
    }
    clearTimeout(pairing.timer);
    this.pairings.delete(record.serial);
    try {
      await pairing.client.cancelPairing(this.saved.clientId, PAIRING_NAME);
      logger.debug(`${this.label(record)}: pairing closed`);
    } catch (err) {
      logger.debug(`${this.label(record)}: pairing not closed (${err.message})`);
    }
  }

  /** "Enter the PIN": the TV gives its token, kept under /data. */
  async finishPairing({ pin, address } = {}) {
    const digits = String(pin ?? '').replace(/\s+/g, '');
    if (!/^\d{4}$/.test(digits)) {
      throw Object.assign(new Error(pick(PAIR_TEXT, this.language).noPin), { userFacing: true });
    }
    const record = await this.pairingTarget(address, { pending: true });
    const pairing = this.pairings.get(record.serial);
    if (!pairing) {
      throw Object.assign(new Error(pick(PAIR_TEXT, this.language).noPairing), {
        userFacing: true,
      });
    }
    let token;
    try {
      token = await this.command(record, () =>
        pairing.client.finishPairing(this.saved.clientId, pairing.challenge, digits),
      );
    } catch (err) {
      if (err.kind === ERROR_KINDS.PIN) {
        // The PIN is still shown: another try is allowed.
        throw Object.assign(new Error(pick(PAIR_TEXT, this.language).wrongPin), {
          userFacing: true,
        });
      }
      throw err;
    }
    clearTimeout(pairing.timer);
    this.pairings.delete(record.serial);
    record.token = token;
    record.client = this.newClient({
      host: record.host,
      port: record.port,
      token,
      kind: record.kind,
    });
    record.error = null;
    record.warned = null;
    this.saveRecord(record);
    logger.info(`${this.label(record)}: paired`);
    const changed = await this.poll(record, { full: true });
    await this.publishDevices();
    await this.afterChanges(changed);
    return allLanguages(PAIR_TEXT, (text) => text.paired(deviceName(record)));
  }

  // --- Configuration actions -----------------------------------------------------------

  /** "Test the connection": look for the devices, read them now, one line each. */
  async testConnection() {
    await this.rediscover();
    const message = {};
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      const lines = [];
      for (const record of this.records.values()) {
        const name = deviceName(record);
        if (!this.isPublished(record)) {
          lines.push(labelled(name, pick(ERROR_TEXT.pairingNeeded, language), language));
        } else if (record.error) {
          const problem = ERROR_TEXT[record.error.kind] ?? ERROR_TEXT[ERROR_KINDS.API];
          lines.push(labelled(name, pick(problem, language), language));
        } else if (record.snapshot.reachable === false) {
          lines.push(labelled(name, pick(ERROR_TEXT[ERROR_KINDS.UNREACHABLE], language), language));
        } else {
          const model = record.identity.model ?? 'VIZIO';
          const parts = [isOn(record) ? text.on(model) : text.standby(model)];
          if (/eco/i.test(record.snapshot.powerMode ?? '')) {
            parts.push(text.eco);
          }
          lines.push(labelled(name, parts.join(', '), language));
        }
      }
      for (const entry of this.unidentified.values()) {
        const problem = ERROR_TEXT[entry.error] ?? ERROR_TEXT[ERROR_KINDS.UNREACHABLE];
        lines.push(labelled(entry.host, pick(problem, language), language));
      }
      if (this.config.invalidHosts.length > 0) {
        lines.push(pick(CONNECTION_TEXT.invalidHosts, language));
      }
      message[language] = lines.length ? lines.join('\n') : text.noDevice;
    }
    return message;
  }

  /** What the widgets show: one device, or the first one. */
  view(deviceExternalId) {
    if (deviceExternalId) {
      const record = this.recordOfDevice(deviceExternalId);
      return this.isPublished(record) ? record : null;
    }
    return this.published()[0] ?? null;
  }
}
