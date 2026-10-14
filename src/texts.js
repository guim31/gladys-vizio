// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widgets (src/widgets.js):
// connection status, the reports of the configuration actions, the errors of
// the commands and scene actions. Four languages, the four of the Gladys
// interface; German says "du", Spanish "usted". test/i18n.test.js checks
// every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './vizio/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noDevice: {
    en: 'No VIZIO device found: turn it on, then search in Discovery or type its address.',
    fr: 'Aucun appareil VIZIO trouvé : allumez-le, puis cherchez dans Découverte ou saisissez son adresse.',
    de: 'Kein VIZIO-Gerät gefunden: Schalte es ein und suche unter Erkennung oder gib seine Adresse ein.',
    es: 'Ningún dispositivo VIZIO encontrado: enciéndalo y busque en Detección o escriba su dirección.',
  },
  invalidHosts: {
    en: 'Address not understood, e.g. 192.168.1.30',
    fr: 'Adresse incomprise, ex. 192.168.1.30',
    de: 'Adresse nicht verstanden, z. B. 192.168.1.30',
    es: 'Dirección no válida, p. ej. 192.168.1.30',
  },
  unknownApps: {
    en: 'Unknown favorite app',
    fr: 'Application favorite inconnue',
    de: 'Unbekannte Lieblings-App',
    es: 'Aplicación favorita desconocida',
  },
};

// One short explanation per problem of a device (error kinds of
// src/vizio/client.js, plus the states of the hub).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'does not answer (off in Eco mode, or wrong address)',
    fr: 'ne répond pas (éteint en mode Éco, ou mauvaise adresse)',
    de: 'antwortet nicht (im Eco-Modus aus, oder falsche Adresse)',
    es: 'no responde (apagado en modo Eco, o dirección incorrecta)',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'the TV no longer accepts Gladys: pair it again',
    fr: "le téléviseur n'accepte plus Gladys : appairez-le à nouveau",
    de: 'der Fernseher akzeptiert Gladys nicht mehr: Kopple ihn erneut',
    es: 'el televisor ya no acepta Gladys: vuelva a emparejarlo',
  },
  [ERROR_KINDS.NOT_SMARTCAST]: {
    en: 'no SmartCast device at this address',
    fr: "pas d'appareil SmartCast à cette adresse",
    de: 'kein SmartCast-Gerät unter dieser Adresse',
    es: 'no hay ningún dispositivo SmartCast en esta dirección',
  },
  [ERROR_KINDS.NOT_FOUND]: {
    en: 'this firmware does not offer this command',
    fr: 'ce micrologiciel ne propose pas cette commande',
    de: 'diese Firmware bietet diesen Befehl nicht an',
    es: 'este firmware no ofrece este comando',
  },
  [ERROR_KINDS.INVALID]: {
    en: 'the device refused the value',
    fr: "l'appareil a refusé la valeur",
    de: 'das Gerät hat den Wert abgelehnt',
    es: 'el dispositivo ha rechazado el valor',
  },
  [ERROR_KINDS.PIN]: {
    en: 'wrong PIN',
    fr: 'code PIN erroné',
    de: 'falsche PIN',
    es: 'PIN incorrecto',
  },
  [ERROR_KINDS.PAIRING_BLOCKED]: {
    en: 'the TV refuses pairing for now (too many tries or paired devices)',
    fr: "le téléviseur refuse l'appairage pour l'instant (trop d'essais ou d'appareils appairés)",
    de: 'der Fernseher lehnt die Kopplung vorerst ab (zu viele Versuche oder gekoppelte Geräte)',
    es: 'el televisor rechaza el emparejamiento por ahora (demasiados intentos o dispositivos)',
  },
  [ERROR_KINDS.BUSY]: {
    en: 'the device is busy, try again',
    fr: "l'appareil est occupé, réessayez",
    de: 'das Gerät ist beschäftigt, versuche es erneut',
    es: 'el dispositivo está ocupado, vuelva a intentarlo',
  },
  [ERROR_KINDS.API]: {
    en: 'the device refused the request, see the logs',
    fr: "l'appareil a refusé la demande, voir les logs",
    de: 'das Gerät hat die Anfrage abgelehnt, sieh in den Protokollen nach',
    es: 'el dispositivo ha rechazado la solicitud, consulte los registros',
  },
  pairingNeeded: {
    en: 'pairing needed: run "Start pairing"',
    fr: "appairage nécessaire : lancez « Démarrer l'appairage »",
    de: 'Kopplung nötig: Starte „Kopplung starten“',
    es: 'emparejamiento necesario: ejecute «Iniciar el emparejamiento»',
  },
  noSerial: {
    en: 'no serial number: this device cannot be added',
    fr: 'pas de numéro de série : cet appareil ne peut pas être ajouté',
    de: 'keine Seriennummer: Dieses Gerät kann nicht hinzugefügt werden',
    es: 'sin número de serie: este dispositivo no se puede añadir',
  },
};

// The "Test the connection" report, one line per device.
export const REPORT_TEXT = {
  en: {
    on: (model) => `OK, ${model}, on`,
    standby: (model) => `OK, ${model}, in standby`,
    eco: 'Eco mode: Gladys cannot turn it on, choose Quick Start',
    noDevice: 'No VIZIO device found.',
  },
  fr: {
    on: (model) => `OK, ${model}, allumé`,
    standby: (model) => `OK, ${model}, en veille`,
    eco: 'mode Éco : Gladys ne peut pas l’allumer, choisissez Démarrage rapide',
    noDevice: 'Aucun appareil VIZIO trouvé.',
  },
  de: {
    on: (model) => `OK, ${model}, eingeschaltet`,
    standby: (model) => `OK, ${model}, im Standby`,
    eco: 'Eco-Modus: Gladys kann es nicht einschalten, wähle Schnellstart',
    noDevice: 'Kein VIZIO-Gerät gefunden.',
  },
  es: {
    on: (model) => `OK, ${model}, encendido`,
    standby: (model) => `OK, ${model}, en espera`,
    eco: 'modo Eco: Gladys no puede encenderlo, elija Inicio rápido',
    noDevice: 'Ningún dispositivo VIZIO encontrado.',
  },
};

// The pairing actions.
export const PAIR_TEXT = {
  en: {
    shown: (name) =>
      `A PIN is shown on ${name}: type it in "Enter the PIN", then run it (within 5 minutes).`,
    paired: (name) => `${name} is paired. Add it to Gladys in the Discovery tab.`,
    soundbar: (name) => `${name} is a sound bar: it needs no pairing.`,
    alreadyPaired: (name) => `${name} is already paired. Pairing it again replaces its token.`,
    noPin: 'Type the 4 digits shown on the TV.',
    noPairing: 'No pairing in progress: run "Start pairing" first.',
    wrongPin: 'Wrong PIN: type the PIN shown on the TV again, or start the pairing again.',
  },
  fr: {
    shown: (name) =>
      `Un code PIN s'affiche sur ${name} : saisissez-le dans « Saisir le code PIN », puis lancez l'action (dans les 5 minutes).`,
    paired: (name) => `${name} est appairé. Ajoutez-le à Gladys dans l'onglet Découverte.`,
    soundbar: (name) => `${name} est une barre de son : pas besoin d'appairage.`,
    alreadyPaired: (name) => `${name} est déjà appairé. L'appairer à nouveau remplace son jeton.`,
    noPin: 'Saisissez les 4 chiffres affichés sur le téléviseur.',
    noPairing: "Aucun appairage en cours : lancez d'abord « Démarrer l'appairage ».",
    wrongPin:
      "Code PIN erroné : saisissez à nouveau le code affiché sur le téléviseur, ou recommencez l'appairage.",
  },
  de: {
    shown: (name) =>
      `${name} zeigt eine PIN: Gib sie bei „PIN eingeben“ ein und starte die Aktion (innerhalb von 5 Minuten).`,
    paired: (name) => `${name} ist gekoppelt. Füge das Gerät im Tab Erkennung zu Gladys hinzu.`,
    soundbar: (name) => `${name} ist eine Soundbar und braucht keine Kopplung.`,
    alreadyPaired: (name) =>
      `${name} ist bereits gekoppelt. Eine neue Kopplung ersetzt sein Token.`,
    noPin: 'Gib die 4 Ziffern ein, die der Fernseher anzeigt.',
    noPairing: 'Keine Kopplung läuft: Starte zuerst „Kopplung starten“.',
    wrongPin:
      'Falsche PIN: Gib die am Fernseher angezeigte PIN erneut ein oder starte die Kopplung neu.',
  },
  es: {
    shown: (name) =>
      `${name} muestra un PIN: introdúzcalo en «Introducir el PIN» y ejecute la acción (en 5 minutos).`,
    paired: (name) => `${name} está emparejado. Añádalo a Gladys en la pestaña Detección.`,
    soundbar: (name) => `${name} es una barra de sonido: no necesita emparejamiento.`,
    alreadyPaired: (name) => `${name} ya está emparejado. Emparejarlo de nuevo sustituye su token.`,
    noPin: 'Introduzca los 4 dígitos que muestra el televisor.',
    noPairing:
      'No hay ningún emparejamiento en curso: ejecute primero «Iniciar el emparejamiento».',
    wrongPin:
      'PIN incorrecto: introduzca de nuevo el PIN que muestra el televisor o reinicie el emparejamiento.',
  },
};

// Errors of the commands, actions and widget buttons (shown in Gladys).
export const ACTION_TEXT = {
  en: {
    noDevice: 'No VIZIO device is known yet.',
    unknownDevice: 'This device is no longer known: search again in Discovery.',
    chooseDevice: 'Several devices are known: choose one.',
    chooseTv: 'Several TVs are waiting for pairing: type the address of one.',
    unknownAddress: (address) => `No VIZIO device answers at ${address}.`,
    notPaired: 'This TV is not paired yet: run "Start pairing" in the configuration.',
    unknownApp: (name) => `Unknown app "${name}".`,
    tvOnly: 'Apps are on VIZIO TVs only.',
    unknownInput: (name) => `No input "${name}" on this device.`,
    unknownKey: (key) => `Unknown key "${key}" for this device.`,
    unknownMode: (name) => `Unknown mode "${name}".`,
    notOn: 'The device did not turn on: check its power mode (Quick Start).',
    asleep: 'The device does not answer: in Eco mode it cannot be turned on from the network.',
  },
  fr: {
    noDevice: "Aucun appareil VIZIO n'est encore connu.",
    unknownDevice: "Cet appareil n'est plus connu : cherchez à nouveau dans Découverte.",
    chooseDevice: 'Plusieurs appareils sont connus : choisissez-en un.',
    chooseTv: "Plusieurs téléviseurs attendent l'appairage : saisissez l'adresse de l'un d'eux.",
    unknownAddress: (address) => `Aucun appareil VIZIO ne répond à l'adresse ${address}.`,
    notPaired:
      "Ce téléviseur n'est pas encore appairé : lancez « Démarrer l'appairage » dans la configuration.",
    unknownApp: (name) => `Application inconnue « ${name} ».`,
    tvOnly: 'Les applications existent seulement sur les téléviseurs VIZIO.',
    unknownInput: (name) => `Aucune entrée « ${name} » sur cet appareil.`,
    unknownKey: (key) => `Touche inconnue « ${key} » pour cet appareil.`,
    unknownMode: (name) => `Mode inconnu « ${name} ».`,
    notOn: "L'appareil ne s'est pas allumé : vérifiez son mode d'alimentation (Démarrage rapide).",
    asleep: "L'appareil ne répond pas : en mode Éco, il ne peut pas être allumé par le réseau.",
  },
  de: {
    noDevice: 'Noch ist kein VIZIO-Gerät bekannt.',
    unknownDevice: 'Dieses Gerät ist nicht mehr bekannt: Suche erneut unter Erkennung.',
    chooseDevice: 'Mehrere Geräte sind bekannt: Wähle eines aus.',
    chooseTv: 'Mehrere Fernseher warten auf die Kopplung: Gib die Adresse von einem ein.',
    unknownAddress: (address) => `Unter ${address} antwortet kein VIZIO-Gerät.`,
    notPaired:
      'Dieser Fernseher ist noch nicht gekoppelt: Starte „Kopplung starten“ in der Konfiguration.',
    unknownApp: (name) => `Unbekannte App „${name}“.`,
    tvOnly: 'Apps gibt es nur auf VIZIO-Fernsehern.',
    unknownInput: (name) => `Kein Eingang „${name}“ auf diesem Gerät.`,
    unknownKey: (key) => `Unbekannte Taste „${key}“ für dieses Gerät.`,
    unknownMode: (name) => `Unbekannter Modus „${name}“.`,
    notOn: 'Das Gerät hat sich nicht eingeschaltet: Prüfe seinen Energiemodus (Schnellstart).',
    asleep:
      'Das Gerät antwortet nicht: Im Eco-Modus kann es nicht über das Netzwerk eingeschaltet werden.',
  },
  es: {
    noDevice: 'Aún no se conoce ningún dispositivo VIZIO.',
    unknownDevice: 'Este dispositivo ya no se conoce: busque de nuevo en Detección.',
    chooseDevice: 'Se conocen varios dispositivos: elija uno.',
    chooseTv: 'Varios televisores esperan el emparejamiento: escriba la dirección de uno de ellos.',
    unknownAddress: (address) => `Ningún dispositivo VIZIO responde en ${address}.`,
    notPaired:
      'Este televisor aún no está emparejado: ejecute «Iniciar el emparejamiento» en la configuración.',
    unknownApp: (name) => `Aplicación desconocida «${name}».`,
    tvOnly: 'Las aplicaciones solo existen en los televisores VIZIO.',
    unknownInput: (name) => `No hay ninguna entrada «${name}» en este dispositivo.`,
    unknownKey: (key) => `Tecla desconocida «${key}» para este dispositivo.`,
    unknownMode: (name) => `Modo desconocido «${name}».`,
    notOn: 'El dispositivo no se ha encendido: compruebe su modo de energía (Inicio rápido).',
    asleep: 'El dispositivo no responde: en modo Eco no se puede encender desde la red.',
  },
};

export const LANGUAGE_FALLBACK = 'en';

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** The same message in the four languages, from a renderer of each table. */
export const allLanguages = (table, render) =>
  Object.fromEntries(Object.entries(table).map(([language, text]) => [language, render(text)]));

/** An Error whose message is in the configured language (Gladys shows it). */
export function failure(language, key, ...args) {
  const table = pick(ACTION_TEXT, language);
  const entry = table[key];
  const error = new Error(typeof entry === 'function' ? entry(...args) : entry);
  error.userFacing = true;
  return error;
}
