// -----------------------------------------------------------------------------
// Readers of the SmartCast answers. Pure functions, no network: the client
// (src/vizio/client.js) feeds them the JSON the device returned.
//
// Facts taken from pyvizio (MIT) and vizaio (MIT), whose captures of real
// devices are the fixtures of test/fixtures/vizio/:
//   - the keys of an answer come in any case (`STATUS`, `status`, `ITEMS`...),
//     on every firmware: they are lowercased once, here;
//   - `STATUS.RESULT` says how the request went, with an HTTP 200; a refused
//     token is a bare HTTP 401/403;
//   - `/state_extended` has no envelope at all: flat keys.
// -----------------------------------------------------------------------------

/** Lowercase every key, recursively. Values are kept as they are. */
export function lowerKeys(value) {
  if (Array.isArray(value)) {
    return value.map(lowerKeys);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key.toLowerCase(), lowerKeys(item)]),
    );
  }
  return value;
}

/**
 * The envelope of an answer: `{ result, detail, items, item }`, keys lowercased.
 * @param {unknown} json parsed JSON
 * @returns {{ result: string, detail: string, items: object[], item: object|null, raw: object }|null}
 *   null when it is not a SmartCast envelope
 */
export function parseEnvelope(json) {
  const raw = lowerKeys(json);
  if (!raw || typeof raw !== 'object' || !raw.status || typeof raw.status !== 'object') {
    return null;
  }
  return {
    result: String(raw.status.result ?? '').toLowerCase(),
    detail: String(raw.status.detail ?? ''),
    items: Array.isArray(raw.items)
      ? raw.items.filter((item) => item && typeof item === 'object')
      : [],
    item: raw.item && typeof raw.item === 'object' ? raw.item : null,
    raw,
  };
}

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** The first item of an envelope whose CNAME is `cname`. */
export function findItem(envelope, cname) {
  return envelope.items.find((item) => String(item.cname ?? '').toLowerCase() === cname) ?? null;
}

export const DEVICE_KINDS = Object.freeze({ TV: 'tv', SOUNDBAR: 'soundbar' });

export const SETTINGS_ROOTS = Object.freeze({
  [DEVICE_KINDS.TV]: 'tv_settings',
  [DEVICE_KINDS.SOUNDBAR]: 'audio_settings',
});

/**
 * `/state/device/deviceinfo`, served without authentication: who the device
 * is. The serial number is the identity of the Gladys device.
 * @returns {{ serial: string|null, model: string|null, name: string|null, kind: string,
 *   apiVersion: string|null, firmware: string|null, stateExtended: boolean|null,
 *   tuner: boolean|null, pictureModes: string[] }}
 */
export function parseDeviceInfo(envelope) {
  const item = findItem(envelope, 'deviceinfo') ?? envelope.items[0] ?? {};
  const value = item.value && typeof item.value === 'object' ? item.value : {};
  const system =
    value.system_info && typeof value.system_info === 'object' ? value.system_info : {};
  const root = text(value.settings_root);
  let kind = DEVICE_KINDS.TV;
  if (root === SETTINGS_ROOTS.soundbar) {
    kind = DEVICE_KINDS.SOUNDBAR;
  } else if (!root && /audio|speaker|sound/i.test(String(value.capabilities?.type ?? ''))) {
    kind = DEVICE_KINDS.SOUNDBAR;
  }
  // An explicit capability map without state_extended means "not supported";
  // no map at all (older firmware) means "unknown, try once".
  let stateExtended = null;
  if (value.scpl_capabilities && typeof value.scpl_capabilities === 'object') {
    const flag = value.scpl_capabilities.state_extended;
    stateExtended =
      typeof flag === 'string' ? !['', '0', 'false'].includes(flag.toLowerCase()) : Boolean(flag);
  }
  return {
    serial: text(system.serial_number),
    model: text(value.model_name) ?? text(system.model_name) ?? text(value.name),
    name: text(value.cast_name) ?? text(value.name),
    kind,
    apiVersion: text(value.api_version),
    firmware: text(system.version),
    stateExtended,
    tuner: typeof value.capabilities?.tuner === 'boolean' ? value.capabilities.tuner : null,
    pictureModes: Array.isArray(value.system_picture_modes)
      ? value.system_picture_modes.map(text).filter(Boolean)
      : [],
  };
}

/** A serial number read from the settings tree (older firmware): the value of the item. */
export function parseSerialItem(envelope) {
  const item = findItem(envelope, 'serial_number') ?? envelope.items[0];
  return text(item?.value);
}

/** `/state/device/power_mode`: 1 on, 0 standby. */
export function parsePowerMode(envelope) {
  const item = findItem(envelope, 'power_mode') ?? envelope.items[0];
  return Number(item?.value) === 1;
}

/**
 * An app as the device reports it: `{ appId, nameSpace, message }`, or null
 * (no app: an HDMI input, or nothing at all).
 */
export function parseAppConfig(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const appId = value.app_id ?? null;
  const nameSpace = value.name_space ?? null;
  if (appId === null && nameSpace === null) {
    return null;
  }
  return {
    appId: appId === null ? null : String(appId),
    nameSpace: nameSpace === null ? null : Number(nameSpace),
    message: typeof value.message === 'string' ? value.message : null,
  };
}

/** `/app/current`: the app in front, or null. */
export function parseCurrentApp(envelope) {
  return parseAppConfig(envelope.item?.value);
}

/** The value of the current_input item: `SMARTCAST`, `HDMI-2`... and its hashval. */
export function parseCurrentInput(envelope) {
  const item = findItem(envelope, 'current_input') ?? envelope.items[0];
  if (!item) {
    return null;
  }
  const value =
    typeof item.value === 'string' ? item.value : text(item.value?.name) ? item.value.name : null;
  return { value: text(value), hashval: item.hashval ?? null };
}

const truthy = (value, fallback) => {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return ['true', 'yes', 'on', '1'].includes(String(value).toLowerCase());
};

/**
 * The inputs of `{root}/devices/name_input` (TV) or `audio_settings/input`
 * (sound bar): `{ cname, name, meta, label }`. `cname` is what recent
 * firmware wants to switch (`hdmi1`), `name` what the device says on screen
 * (`HDMI-1`), `meta` its own name for it (`SMARTCAST`, or the name the user
 * gave it: `PS5`), what older firmware wants (pyvizio); `label` is what to
 * show: the user's name, else `name`.
 */
export function parseInputs(envelope) {
  const inputs = [];
  for (const item of envelope.items) {
    const cname = text(item.cname)?.toLowerCase();
    if (!cname || cname === 'current_input') {
      continue;
    }
    // The official app lists the inputs enabled OR visible; older firmware
    // sends neither flag (shown). Captured TVs send ENABLED "FALSE" and no
    // VISIBLE: shown.
    if (!truthy(item.enabled, true) && !truthy(item.visible, true)) {
      continue;
    }
    const name = text(item.name) ?? cname.toUpperCase();
    const meta = typeof item.value === 'string' ? text(item.value) : text(item.value?.name);
    inputs.push({
      cname,
      name,
      meta: meta ?? name,
      label: meta && meta !== 'SMARTCAST' ? meta : name,
    });
  }
  return inputs;
}

/** Whether an input value or cname is the SmartCast (apps) input. */
export function isAppInput(value) {
  return ['smartcast', 'cast'].includes(String(value ?? '').toLowerCase());
}

/**
 * The input of a list that a current_input value designates: the device
 * answers `SMARTCAST` for the cast input (its meta name) and `HDMI-2` for an
 * HDMI one (its display name, even once renamed).
 */
export function matchInput(inputs, value) {
  const wanted = String(value ?? '').toLowerCase();
  if (!wanted) {
    return null;
  }
  return (
    inputs.find((input) => input.cname === wanted) ??
    inputs.find((input) => input.name.toLowerCase() === wanted) ??
    inputs.find((input) => input.label.toLowerCase() === wanted) ??
    (isAppInput(wanted) ? (inputs.find((input) => isAppInput(input.cname)) ?? null) : null)
  );
}

/**
 * `/state_extended` (recent firmware, one request for power, input and app).
 * No envelope: flat keys.
 * @returns {{ power: boolean, powerMode: string|null, input: string|null, app: object|null }}
 */
export function parseStateExtended(json) {
  const raw = lowerKeys(json) ?? {};
  return {
    power: Number(raw.power_status?.value ?? 0) === 1,
    powerMode: text(raw.power_mode?.value),
    input: text(raw.current_input?.name) ?? text(raw.current_input?.value),
    app: parseAppConfig(raw.app_current),
  };
}

/** A setting item (`{root}/audio/volume`...): `{ value, hashval, type }`. */
export function parseSetting(envelope, cname) {
  const item =
    findItem(envelope, cname) ?? (envelope.items.length === 1 ? envelope.items[0] : null);
  if (!item || item.value === undefined || item.value === null) {
    return null;
  }
  return { value: item.value, hashval: item.hashval ?? null, type: String(item.type ?? '') };
}

/**
 * The static options of a settings group (`/menu_native/static/{root}/audio`):
 * per cname, `{ min, max }` for a slider, `{ choices }` for a list.
 */
export function parseSettingOptions(envelope) {
  const options = {};
  for (const item of envelope.items) {
    const cname = text(item.cname)?.toLowerCase();
    if (!cname) {
      continue;
    }
    if (Array.isArray(item.elements) && item.elements.length > 0) {
      options[cname] = { choices: item.elements.map(text).filter(Boolean) };
    } else if (item.minimum !== undefined && item.maximum !== undefined) {
      options[cname] = { min: Number(item.minimum), max: Number(item.maximum) };
    }
  }
  return options;
}

/** The cnames of a dynamic settings group that carry a value (`eq`, `picture_mode`...). */
export function settingNames(envelope) {
  return envelope.items
    .filter((item) => item.value !== undefined && item.value !== null)
    .map((item) => String(item.cname ?? '').toLowerCase())
    .filter(Boolean);
}

/** The pairing challenge of `/pairing/start`. */
export function parseChallenge(envelope) {
  const item = envelope.item ?? {};
  const type = item.challenge_type;
  const token = item.pairing_req_token;
  if (type === undefined || token === undefined) {
    return null;
  }
  return { type: Number(type), token: Number(token) };
}

/** The auth token of `/pairing/pair`. */
export function parseAuthToken(envelope) {
  return text(envelope.item?.auth_token);
}
