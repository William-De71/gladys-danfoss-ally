// -----------------------------------------------------------------------------
// Texts of the integration, in English, French, German and Spanish (English
// fallback).
//
// The manifest carries its own labels; these are the texts the code writes at
// runtime: feature names, widget contents, toasts, messages of the
// Configuration screen. Vocabulary of the Gladys interface: appareil / Gerät /
// dispositivo, scène / Szene / escena, consigne / Solltemperatur / consigna.
// -----------------------------------------------------------------------------

const LANGUAGES = ['en', 'fr', 'de', 'es'];

const TEXTS = {
  // feature names (Discovery, device page)
  feature_target_temperature: {
    en: 'Setpoint',
    fr: 'Consigne',
    de: 'Solltemperatur',
    es: 'Consigna',
  },
  feature_mode: { en: 'Heating mode', fr: 'Mode de chauffage', de: 'Heizmodus', es: 'Modo' },
  feature_preset: { en: 'Preset', fr: 'Préréglage', de: 'Voreinstellung', es: 'Preajuste' },
  feature_operating_state: { en: 'Heating', fr: 'Chauffe', de: 'Heizt', es: 'Calentando' },
  feature_temperature: {
    en: 'Room temperature',
    fr: 'Température ambiante',
    de: 'Raumtemperatur',
    es: 'Temperatura ambiente',
  },
  feature_floor_temperature: {
    en: 'Floor temperature',
    fr: 'Température du sol',
    de: 'Bodentemperatur',
    es: 'Temperatura del suelo',
  },
  feature_humidity: { en: 'Humidity', fr: 'Humidité', de: 'Luftfeuchtigkeit', es: 'Humedad' },
  feature_battery: { en: 'Battery', fr: 'Batterie', de: 'Batterie', es: 'Batería' },
  feature_window: {
    en: 'Open window',
    fr: 'Fenêtre ouverte',
    de: 'Fenster offen',
    es: 'Ventana abierta',
  },
  feature_child_lock: {
    en: 'Child lock',
    fr: 'Sécurité enfant',
    de: 'Kindersicherung',
    es: 'Bloqueo infantil',
  },

  // Danfoss modes (names of the Ally app)
  mode_at_home: { en: 'Home', fr: 'Maison', de: 'Zuhause', es: 'En casa' },
  mode_leaving_home: { en: 'Away', fr: 'Absent', de: 'Abwesend', es: 'Ausente' },
  mode_pause: { en: 'Pause', fr: 'Pause', de: 'Pause', es: 'Pausa' },
  mode_manual: { en: 'Manual', fr: 'Manuel', de: 'Manuell', es: 'Manual' },
  mode_holiday: { en: 'Holiday', fr: 'Vacances', de: 'Urlaub', es: 'Vacaciones' },
  mode_holiday_sat: {
    en: 'Holiday (home)',
    fr: 'Vacances (maison)',
    de: 'Urlaub (Zuhause)',
    es: 'Vacaciones (casa)',
  },
  mode_hot: { en: 'Heating', fr: 'Chauffage', de: 'Heizen', es: 'Calefacción' },

  // widget: rooms
  badgeOffline: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Sin conexión' },
  badgeFault: { en: 'Fault', fr: 'Défaut', de: 'Störung', es: 'Fallo' },
  badgeWindow: {
    en: 'Window open',
    fr: 'Fenêtre ouverte',
    de: 'Fenster offen',
    es: 'Ventana abierta',
  },
  badgeBattery: { en: 'Battery {n} %', fr: 'Pile {n} %', de: 'Batterie {n} %', es: 'Pila {n} %' },
  badgeHeating: { en: 'Heating', fr: 'Chauffe', de: 'Heizt', es: 'Calentando' },
  badgeHeatingPercent: {
    en: 'Heating {n} %',
    fr: 'Chauffe {n} %',
    de: 'Heizt {n} %',
    es: 'Calienta {n} %',
  },
  detailModel: { en: 'Model', fr: 'Modèle', de: 'Modell', es: 'Modelo' },
  detailState: { en: 'Connection', fr: 'Connexion', de: 'Verbindung', es: 'Conexión' },
  detailTemperature: {
    en: 'Room temperature',
    fr: 'Température ambiante',
    de: 'Raumtemperatur',
    es: 'Temperatura ambiente',
  },
  detailSetpoint: { en: 'Setpoint', fr: 'Consigne', de: 'Solltemperatur', es: 'Consigna' },
  detailSetpoints: {
    en: 'Setpoints',
    fr: 'Consignes',
    de: 'Solltemperaturen',
    es: 'Consignas',
  },
  detailFloor: {
    en: 'Floor temperature',
    fr: 'Température du sol',
    de: 'Bodentemperatur',
    es: 'Temperatura del suelo',
  },
  detailHumidity: { en: 'Humidity', fr: 'Humidité', de: 'Luftfeuchtigkeit', es: 'Humedad' },
  detailValve: {
    en: 'Valve opening',
    fr: 'Ouverture de vanne',
    de: 'Ventilöffnung',
    es: 'Apertura de válvula',
  },
  detailBattery: { en: 'Battery', fr: 'Batterie', de: 'Batterie', es: 'Batería' },
  detailWindow: { en: 'Window', fr: 'Fenêtre', de: 'Fenster', es: 'Ventana' },
  detailChildLock: {
    en: 'Child lock',
    fr: 'Sécurité enfant',
    de: 'Kindersicherung',
    es: 'Bloqueo infantil',
  },
  detailExternal: {
    en: 'External sensor',
    fr: 'Capteur externe',
    de: 'Externer Sensor',
    es: 'Sensor externo',
  },
  detailFault: { en: 'Fault', fr: 'Défaut', de: 'Störung', es: 'Fallo' },
  detailUpdated: {
    en: 'Changed in Danfoss',
    fr: 'Modifié chez Danfoss',
    de: 'Bei Danfoss geändert',
    es: 'Cambiado en Danfoss',
  },
  online: { en: 'online', fr: 'en ligne', de: 'online', es: 'en línea' },
  offline: { en: 'offline', fr: 'hors ligne', de: 'offline', es: 'sin conexión' },
  windowOpen: { en: 'open', fr: 'ouverte', de: 'offen', es: 'abierta' },
  windowClosed: { en: 'closed', fr: 'fermée', de: 'geschlossen', es: 'cerrada' },
  yes: { en: 'on', fr: 'activée', de: 'an', es: 'activado' },
  no: { en: 'off', fr: 'désactivée', de: 'aus', es: 'desactivado' },
  captionUpdated: {
    en: 'Read {ago}',
    fr: 'Relevé {ago}',
    de: 'Gelesen {ago}',
    es: 'Leído {ago}',
  },
  captionUpdatedHidden: {
    en: 'Read {ago} · {n} more: choose the rooms in the settings',
    fr: 'Relevé {ago} · {n} de plus : choisissez les pièces',
    de: 'Gelesen {ago} · {n} weitere: Räume in den Einstellungen wählen',
    es: 'Leído {ago} · {n} más: elija las estancias en los ajustes',
  },
  noReading: {
    en: 'No reading yet',
    fr: 'Pas encore de relevé',
    de: 'Noch keine Werte',
    es: 'Sin datos aún',
  },
  emptyRooms: {
    en: 'No Danfoss Ally device in this account. The account of the developer portal must use the same e-mail address as the Danfoss Ally app.',
    fr: 'Aucun appareil Danfoss Ally sur ce compte. Le compte du portail développeur doit utiliser la même adresse e-mail que l’application Danfoss Ally.',
    de: 'Kein Danfoss-Ally-Gerät in diesem Konto. Das Konto im Entwicklerportal muss dieselbe E-Mail-Adresse wie die Danfoss-Ally-App verwenden.',
    es: 'Ningún dispositivo Danfoss Ally en esta cuenta. La cuenta del portal de desarrolladores debe usar el mismo correo electrónico que la app Danfoss Ally.',
  },
  buttonAllHome: {
    en: 'Home mode',
    fr: 'Mode maison',
    de: 'Modus Zuhause',
    es: 'Modo en casa',
  },
  buttonAllAway: {
    en: 'Away mode',
    fr: 'Mode absent',
    de: 'Modus Abwesend',
    es: 'Modo ausente',
  },
  buttonRefresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },

  // widget: status
  tileOnline: { en: 'Devices online', fr: 'En ligne', de: 'Geräte online', es: 'En línea' },
  tileRequests: {
    en: 'Requests (1 h)',
    fr: 'Requêtes (1 h)',
    de: 'Anfragen (1 h)',
    es: 'Peticiones (1 h)',
  },
  rowConnection: {
    en: 'Danfoss Ally API',
    fr: 'API Danfoss Ally',
    de: 'Danfoss-Ally-API',
    es: 'API Danfoss Ally',
  },
  rowLastReading: {
    en: 'Last reading',
    fr: 'Dernier relevé',
    de: 'Letzte Abfrage',
    es: 'Última lectura',
  },
  rowInterval: { en: 'Reading', fr: 'Relevé', de: 'Abfrage', es: 'Lectura' },
  rowPaused: {
    en: 'Slowed down, next try',
    fr: 'Ralenti, prochain essai',
    de: 'Gedrosselt, nächster Versuch',
    es: 'Ralentizado, próximo intento',
  },
  everyMinutes: {
    en: 'every {n} min',
    fr: 'toutes les {n} min',
    de: 'alle {n} Min.',
    es: 'cada {n} min',
  },
  inMinutes: { en: 'in {n} min', fr: 'dans {n} min', de: 'in {n} Min.', es: 'en {n} min' },
  connection_ok: { en: 'Connected', fr: 'Connectée', de: 'Verbunden', es: 'Conectada' },
  connection_unknown: { en: 'Starting', fr: 'Démarrage', de: 'Startet', es: 'Iniciando' },
  connection_unconfigured: {
    en: 'Not configured',
    fr: 'Non configurée',
    de: 'Nicht eingerichtet',
    es: 'Sin configurar',
  },
  connection_refused: {
    en: 'Credentials refused',
    fr: 'Identifiants refusés',
    de: 'Zugangsdaten abgelehnt',
    es: 'Credenciales rechazadas',
  },
  connection_rate_limited: {
    en: 'Too many requests',
    fr: 'Trop de requêtes',
    de: 'Zu viele Anfragen',
    es: 'Demasiadas peticiones',
  },
  connection_error: {
    en: 'Unreachable',
    fr: 'Injoignable',
    de: 'Nicht erreichbar',
    es: 'Inaccesible',
  },
  connection_ok_hint: {
    en: 'Connected to the Danfoss Ally API.',
    fr: 'Connectée à l’API Danfoss Ally.',
    de: 'Mit der Danfoss-Ally-API verbunden.',
    es: 'Conectada a la API Danfoss Ally.',
  },
  connection_unknown_hint: {
    en: 'Waiting for the first reading of Danfoss Ally.',
    fr: 'En attente du premier relevé Danfoss Ally.',
    de: 'Warten auf die erste Abfrage von Danfoss Ally.',
    es: 'Esperando la primera lectura de Danfoss Ally.',
  },
  connection_unconfigured_hint: {
    en: 'Enter the Consumer Key and Consumer Secret of your Danfoss developer app in the configuration of the integration.',
    fr: 'Saisissez la Consumer Key et le Consumer Secret de votre application du portail développeur Danfoss dans la configuration de l’intégration.',
    de: 'Geben Sie Consumer Key und Consumer Secret Ihrer App des Danfoss-Entwicklerportals in der Konfiguration der Integration ein.',
    es: 'Introduzca la Consumer Key y el Consumer Secret de su aplicación del portal de desarrolladores de Danfoss en la configuración de la integración.',
  },
  connection_refused_hint: {
    en: 'Danfoss refuses the Consumer Key / Secret. Copy them again from developer.danfoss.com (Apps → your app), and check that the Danfoss Ally API is enabled for this app.',
    fr: 'Danfoss refuse la Consumer Key / le Consumer Secret. Recopiez-les depuis developer.danfoss.com (Apps → votre application) et vérifiez que l’API Danfoss Ally est activée pour cette application.',
    de: 'Danfoss lehnt Consumer Key / Secret ab. Kopieren Sie beide erneut von developer.danfoss.com (Apps → Ihre App) und prüfen Sie, ob die Danfoss-Ally-API für diese App aktiviert ist.',
    es: 'Danfoss rechaza la Consumer Key / el Consumer Secret. Cópielos de nuevo desde developer.danfoss.com (Apps → su aplicación) y compruebe que la API Danfoss Ally está activada para ella.',
  },
  connection_rate_limited_hint: {
    en: 'Danfoss asks to slow down: the integration waits longer between two readings, then goes back to normal by itself.',
    fr: 'Danfoss demande de ralentir : l’intégration espace ses relevés, puis revient d’elle-même au rythme normal.',
    de: 'Danfoss bittet um weniger Anfragen: Die Integration fragt seltener ab und kehrt dann von selbst zum normalen Takt zurück.',
    es: 'Danfoss pide reducir el ritmo: la integración espacia sus lecturas y vuelve sola al ritmo normal.',
  },
  connection_error_hint: {
    en: 'The Danfoss Ally API does not answer. Check the Internet connection of Gladys; the integration tries again at every reading.',
    fr: 'L’API Danfoss Ally ne répond pas. Vérifiez la connexion Internet de Gladys ; l’intégration réessaie à chaque relevé.',
    de: 'Die Danfoss-Ally-API antwortet nicht. Prüfen Sie die Internetverbindung von Gladys; die Integration versucht es bei jeder Abfrage erneut.',
    es: 'La API Danfoss Ally no responde. Compruebe la conexión a Internet de Gladys; la integración lo reintenta en cada lectura.',
  },

  // relative times
  never: { en: 'never', fr: 'jamais', de: 'nie', es: 'nunca' },
  justNow: { en: 'just now', fr: 'à l’instant', de: 'gerade eben', es: 'ahora mismo' },
  minutesAgo: { en: '{n} min ago', fr: 'il y a {n} min', de: 'vor {n} Min.', es: 'hace {n} min' },
  hoursAgo: { en: '{n} h ago', fr: 'il y a {n} h', de: 'vor {n} Std.', es: 'hace {n} h' },
  daysAgo: { en: '{n} days ago', fr: 'il y a {n} jours', de: 'vor {n} Tagen', es: 'hace {n} días' },

  // Configuration screen (setConnectionStatus)
  statusUnconfigured: {
    en: 'Enter the Consumer Key and Consumer Secret of your app of the Danfoss developer portal.',
    fr: 'Saisissez la Consumer Key et le Consumer Secret de votre application du portail développeur Danfoss.',
    de: 'Geben Sie Consumer Key und Consumer Secret Ihrer App des Danfoss-Entwicklerportals ein.',
    es: 'Introduzca la Consumer Key y el Consumer Secret de su aplicación del portal de desarrolladores de Danfoss.',
  },
  statusRefused: {
    en: 'Danfoss refuses the credentials ({reason}): copy the Consumer Key and Secret again, and enable the Danfoss Ally API for the app.',
    fr: 'Danfoss refuse les identifiants ({reason}) : recopiez la Consumer Key et le Secret, et activez l’API Danfoss Ally pour l’application.',
    de: 'Danfoss lehnt die Zugangsdaten ab ({reason}): Consumer Key und Secret erneut kopieren und die Danfoss-Ally-API für die App aktivieren.',
    es: 'Danfoss rechaza las credenciales ({reason}): copie de nuevo la Consumer Key y el Secret, y active la API Danfoss Ally para la aplicación.',
  },
  statusRateLimited: {
    en: 'Danfoss asks to slow down: next reading in {n} min.',
    fr: 'Danfoss demande de ralentir : prochain relevé dans {n} min.',
    de: 'Danfoss bittet um weniger Anfragen: nächste Abfrage in {n} Min.',
    es: 'Danfoss pide reducir el ritmo: próxima lectura en {n} min.',
  },
  statusError: {
    en: 'The Danfoss Ally API does not answer ({error}); next try at the next reading.',
    fr: 'L’API Danfoss Ally ne répond pas ({error}) ; nouvel essai au prochain relevé.',
    de: 'Die Danfoss-Ally-API antwortet nicht ({error}); neuer Versuch bei der nächsten Abfrage.',
    es: 'La API Danfoss Ally no responde ({error}); nuevo intento en la próxima lectura.',
  },
  statusOk: {
    en: '{count} Danfoss Ally device(s), {online} online, read every {minutes} min.',
    fr: '{count} appareil(s) Danfoss Ally, {online} en ligne, relevé toutes les {minutes} min.',
    de: '{count} Danfoss-Ally-Gerät(e), {online} online, Abfrage alle {minutes} Min.',
    es: '{count} dispositivo(s) Danfoss Ally, {online} en línea, lectura cada {minutes} min.',
  },
  statusNoDevice: {
    en: 'Connected, but Danfoss lists no device: the developer portal account must use the same e-mail address as the Danfoss Ally app (case matters).',
    fr: 'Connectée, mais Danfoss ne liste aucun appareil : le compte du portail développeur doit utiliser la même adresse e-mail que l’application Danfoss Ally (majuscules comprises).',
    de: 'Verbunden, aber Danfoss listet kein Gerät: Das Konto im Entwicklerportal muss dieselbe E-Mail-Adresse wie die Danfoss-Ally-App nutzen (Groß-/Kleinschreibung beachten).',
    es: 'Conectada, pero Danfoss no lista ningún dispositivo: la cuenta del portal de desarrolladores debe usar el mismo correo que la app Danfoss Ally (mayúsculas incluidas).',
  },

  // toasts and action results
  toastModeAll: {
    en: '{mode} sent to {n} thermostat(s).',
    fr: '{mode} envoyé à {n} thermostat(s).',
    de: '{mode} an {n} Thermostat(e) gesendet.',
    es: '{mode} enviado a {n} termostato(s).',
  },
  toastModePartial: {
    en: '{mode} sent to {n} thermostat(s), {failed} failed or offline.',
    fr: '{mode} envoyé à {n} thermostat(s), {failed} en échec ou hors ligne.',
    de: '{mode} an {n} Thermostat(e) gesendet, {failed} fehlgeschlagen oder offline.',
    es: '{mode} enviado a {n} termostato(s), {failed} con error o sin conexión.',
  },
  toastNoThermostat: {
    en: 'No thermostat takes the Danfoss modes.',
    fr: 'Aucun thermostat ne prend les modes Danfoss.',
    de: 'Kein Thermostat unterstützt die Danfoss-Modi.',
    es: 'Ningún termostato admite los modos de Danfoss.',
  },
  toastRefreshed: {
    en: '{n} device(s) read.',
    fr: '{n} appareil(s) relevé(s).',
    de: '{n} Gerät(e) abgefragt.',
    es: '{n} dispositivo(s) leído(s).',
  },
  toastFailed: {
    en: 'Danfoss Ally: {error}',
    fr: 'Danfoss Ally : {error}',
    de: 'Danfoss Ally: {error}',
    es: 'Danfoss Ally: {error}',
  },

  // "Test the connection" button
  testOk: {
    en: 'Connected. {count} device(s): {list}',
    fr: 'Connexion réussie. {count} appareil(s) : {list}',
    de: 'Verbunden. {count} Gerät(e): {list}',
    es: 'Conexión correcta. {count} dispositivo(s): {list}',
  },
  testDevice: {
    en: '{name} ({model}, {state}, {features} features)',
    fr: '{name} ({model}, {state}, {features} fonctionnalités)',
    de: '{name} ({model}, {state}, {features} Funktionen)',
    es: '{name} ({model}, {state}, {features} funciones)',
  },
  testInfrastructure: {
    en: '{name} ({model}, {state}, not offered: nothing to show)',
    fr: '{name} ({model}, {state}, non proposé : rien à afficher)',
    de: '{name} ({model}, {state}, nicht angeboten: nichts anzuzeigen)',
    es: '{name} ({model}, {state}, no ofrecido: nada que mostrar)',
  },
};

/**
 * @description Whether a value is one of the languages of the integration.
 * @param {unknown} language - The value.
 * @returns {boolean} A language.
 */
const isLanguage = (language) => LANGUAGES.includes(language);

/**
 * @description A text in a language (English fallback), with its
 * substitutions.
 * @param {string} key - The TEXTS key.
 * @param {string} language - The language.
 * @param {object} [values] - The substitutions.
 * @returns {string} The text.
 * @example
 * t('minutesAgo', 'fr', { n: 3 }); // -> 'il y a 3 min'
 */
function t(key, language, values = {}) {
  const entry = TEXTS[key];
  if (!entry) return key;
  const template = entry[language] ?? entry.en;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
}

/**
 * @description The text in every language, for a multi-language message.
 * @param {string|Function} key - The TEXTS key, or `(language) => string`.
 * @param {object} [values] - The substitutions.
 * @returns {{ en: string, fr: string, de: string, es: string }} The message.
 */
function all(key, values = {}) {
  return Object.fromEntries(
    LANGUAGES.map((language) => [
      language,
      typeof key === 'function' ? key(language) : t(key, language, values),
    ]),
  );
}

const locale = (language) => (isLanguage(language) ? language : 'en');

/**
 * @description A number written in a language ("20,5", "20.5").
 * @param {number} n - The number.
 * @param {string} language - The language.
 * @returns {string} The text.
 */
const formatNumber = (n, language) =>
  new Intl.NumberFormat(locale(language), { maximumFractionDigits: 1 }).format(n);

/**
 * @description How long ago an instant was: "just now", "12 min ago".
 * @param {number} at - The instant, in ms (0: never).
 * @param {number} now - Now, in ms.
 * @param {string} language - The language.
 * @returns {string} The text.
 */
function ago(at, now, language) {
  if (!at) return t('never', language);
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) return t('justNow', language);
  if (minutes < 60) return t('minutesAgo', language, { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return t('hoursAgo', language, { n: hours });
  return t('daysAgo', language, { n: Math.floor(hours / 24) });
}

export { LANGUAGES, TEXTS, isLanguage, t, all, formatNumber, ago };
