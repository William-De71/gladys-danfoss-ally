// -----------------------------------------------------------------------------
// Client of the official Danfoss Ally API (https://developer.danfoss.com,
// "Danfoss Ally API" 2.4.0), with the Consumer Key and Consumer Secret of an
// app the user registers on the Danfoss developer portal.
//
//   POST https://api.danfoss.com/oauth2/token     client credentials, Basic auth
//   GET  https://api.danfoss.com/ally/devices     every device and its status
//   GET  .../ally/devices/{id}                    one device
//   GET  .../ally/devices/{id}/status             its status only (500 on some
//                                                 models: the caller falls back)
//   POST .../ally/devices/{id}/commands           { commands: [{ code, value }] }
//
// - The access token lives 60 minutes; it is renewed 30 s before it expires,
//   and once more when the API answers 401.
// - Danfoss publishes no quota but throttles the free API (429; 5 calls per
//   second on /oauth2/token): requests go one at a time, at most about three
//   per second, and a 429 is retried after an exponential wait, then reported
//   as a RateLimitError for the caller to slow down.
// - The secret and the tokens are never logged nor put in an error message.
// -----------------------------------------------------------------------------

const API_HOST = 'https://api.danfoss.com';
const TOKEN_PATH = '/oauth2/token';
const ALLY_PREFIX = '/ally';
// About three requests per second at most.
const MIN_INTERVAL_MS = 350;
const TIMEOUT_MS = 20 * 1000;
// Renew the token this long before it expires.
const TOKEN_MARGIN_MS = 30 * 1000;
// A 429 is retried this many times (1 s, 2 s, then 4 s… capped), Retry-After
// first when Danfoss sends one.
const RATE_LIMIT_RETRIES = 2;
const MAX_RETRY_WAIT_MS = 30 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** The Consumer Key / Secret pair is refused, or the Ally API is not enabled. */
class CredentialsError extends Error {
  /**
   * @param {string} reason - API_KEY_INVALID, FORBIDDEN, MISSING…
   * @param {number|null} status - HTTP status.
   */
  constructor(reason, status = null) {
    super(`Danfoss refused the credentials (${reason})`);
    this.name = 'CredentialsError';
    this.reason = reason;
    this.status = status;
  }
}

/** Danfoss asks to slow down (429) even after the retries. */
class RateLimitError extends Error {
  /** @param {number} retryAfterMs - The wait Danfoss asked for, or ours. */
  constructor(retryAfterMs) {
    super('Danfoss limits the requests (429)');
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

/** Any other HTTP error of the API. */
class ApiError extends Error {
  /**
   * @param {number} status - HTTP status.
   * @param {string} title - The short title of the problem.
   */
  constructor(status, title) {
    super(`Danfoss Ally API error ${status}${title ? ` (${title})` : ''}`);
    this.name = 'ApiError';
    this.status = status;
    this.title = title;
  }
}

/** The API cannot be reached (DNS, timeout, connection refused). */
class NetworkError extends Error {
  /** @param {string} message - What failed (never a URL with a secret). */
  constructor(message) {
    super(`Danfoss Ally API unreachable: ${message}`);
    this.name = 'NetworkError';
  }
}

/**
 * @description The short title of a Danfoss problem answer, free of any
 * secret (the API never echoes the credentials, but the text is bounded).
 * @param {object|null} body - The parsed JSON answer.
 * @returns {string} The title.
 */
function problemTitle(body) {
  const parts = [body?.title, body?.detail]
    .filter((part) => typeof part === 'string' && part.trim())
    .map((part) => part.trim());
  return parts.join(': ').replace(/\s+/g, ' ').slice(0, 120);
}

/**
 * @description The reason of a refused token request.
 * @param {object|null} body - The parsed JSON answer.
 * @returns {string} API_KEY_INVALID or CREDENTIALS_REFUSED.
 */
function credentialsReason(body) {
  const text = `${body?.type ?? ''} ${body?.title ?? ''} ${body?.detail ?? ''}`.toLowerCase();
  return /api-key-invalid|api key invalid|invalidclientidentifier|invalid_client/.test(text)
    ? 'API_KEY_INVALID'
    : 'CREDENTIALS_REFUSED';
}

/**
 * @description Create a Danfoss Ally API client.
 * @param {object} [options] - Options.
 * @param {Function} [options.fetchImpl] - `fetch` (tests).
 * @param {Function} [options.now] - `() => ms` (tests).
 * @param {Function} [options.sleep] - `(ms) => Promise` (tests).
 * @param {number} [options.minIntervalMs] - Spacing of two requests.
 * @param {number} [options.timeoutMs] - Timeout of a request.
 * @param {string} [options.userAgent] - User-Agent header.
 * @returns {object} The client.
 * @example
 * const api = createDanfossApi();
 * api.setCredentials(key, secret);
 * const { result } = await api.getDevices();
 */
function createDanfossApi({
  fetchImpl = (...args) => fetch(...args),
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  minIntervalMs = MIN_INTERVAL_MS,
  timeoutMs = TIMEOUT_MS,
  userAgent = 'gladys-danfoss-ally',
} = {}) {
  let key = '';
  let secret = '';
  let token = null;
  let tokenRefreshAt = 0;
  let tokenRequest = null;
  // The request queue: one at a time, spaced.
  let queue = Promise.resolve();
  let nextSlot = 0;
  const sentAt = [];

  /** @description Forget the requests older than an hour. */
  function prune() {
    const limit = now() - HOUR_MS;
    while (sentAt.length && sentAt[0] < limit) sentAt.shift();
  }

  /**
   * @description Run one HTTP exchange in the queue, spaced from the
   * previous one.
   * @param {string} url - The URL.
   * @param {object} init - The fetch options.
   * @returns {Promise<{status: number, body: object|null, headers: object}>} The answer.
   */
  function exchange(url, init) {
    const run = async () => {
      const wait = nextSlot - now();
      if (wait > 0) await sleep(wait);
      nextSlot = now() + minIntervalMs;
      sentAt.push(now());
      prune();
      let response;
      try {
        response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      } catch (err) {
        const reason = err?.name === 'TimeoutError' ? 'timeout' : (err?.cause?.code ?? 'network');
        throw new NetworkError(reason);
      }
      const text = await response.text().catch(() => '');
      let body = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = null;
        }
      }
      return { status: response.status, body, headers: response.headers };
    };
    const result = queue.then(run, run);
    queue = result.catch(() => {});
    return result;
  }

  /**
   * @description The wait before retrying a 429.
   * @param {object} headers - The answer headers.
   * @param {number} attempt - 0 for the first retry.
   * @returns {number} Milliseconds.
   */
  function retryWait(headers, attempt) {
    const header = Number(headers?.get?.('retry-after'));
    if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, MAX_RETRY_WAIT_MS);
    return Math.min(1000 * 2 ** attempt, MAX_RETRY_WAIT_MS);
  }

  /** @description Request a new access token (client credentials). */
  async function fetchToken() {
    if (!key || !secret) throw new CredentialsError('MISSING');
    const basic = Buffer.from(`${key}:${secret}`, 'utf8').toString('base64');
    for (let attempt = 0; ; attempt += 1) {
      const answer = await exchange(`${API_HOST}${TOKEN_PATH}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basic}`,
          'User-Agent': userAgent,
        },
        body: 'grant_type=client_credentials',
      });
      if (answer.status === 429) {
        if (attempt >= RATE_LIMIT_RETRIES) throw new RateLimitError(retryWait(answer.headers, 3));
        await sleep(retryWait(answer.headers, attempt));
        continue;
      }
      if ([400, 401, 403].includes(answer.status)) {
        throw new CredentialsError(credentialsReason(answer.body), answer.status);
      }
      if (answer.status >= 400) throw new ApiError(answer.status, problemTitle(answer.body));
      const accessToken = answer.body?.access_token;
      const expiresIn = Number(answer.body?.expires_in);
      if (typeof accessToken !== 'string' || !accessToken || !Number.isFinite(expiresIn)) {
        throw new ApiError(answer.status, 'no access token in the answer');
      }
      token = accessToken;
      tokenRefreshAt = now() + Math.max(0, expiresIn * 1000 - TOKEN_MARGIN_MS);
      return token;
    }
  }

  /** @description A valid access token (shared by concurrent callers). */
  async function accessToken() {
    if (token && now() < tokenRefreshAt) return token;
    if (!tokenRequest) {
      tokenRequest = fetchToken().finally(() => {
        tokenRequest = null;
      });
    }
    return tokenRequest;
  }

  /**
   * @description Call the Ally API.
   * @param {string} method - GET or POST.
   * @param {string} path - The path under /ally.
   * @param {object} [payload] - The JSON body.
   * @returns {Promise<object>} The parsed answer.
   */
  async function call(method, path, payload) {
    let renewed = false;
    for (let attempt = 0; ; attempt += 1) {
      const bearer = await accessToken();
      const answer = await exchange(`${API_HOST}${ALLY_PREFIX}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${bearer}`,
          'User-Agent': userAgent,
          ...(payload ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      if (answer.status === 429) {
        if (attempt >= RATE_LIMIT_RETRIES) throw new RateLimitError(retryWait(answer.headers, 3));
        await sleep(retryWait(answer.headers, attempt));
        continue;
      }
      if (answer.status === 401) {
        // An expired or revoked token: one new token, then give up.
        token = null;
        if (renewed) throw new CredentialsError('UNAUTHORIZED', 401);
        renewed = true;
        continue;
      }
      if (answer.status === 403) throw new CredentialsError('FORBIDDEN', 403);
      if (answer.status >= 400) throw new ApiError(answer.status, problemTitle(answer.body));
      return answer.body ?? {};
    }
  }

  const devicePath = (id) => `/devices/${encodeURIComponent(id)}`;

  return {
    /**
     * @description Use these credentials from now on (drops the token).
     * @param {string} consumerKey - The Consumer Key.
     * @param {string} consumerSecret - The Consumer Secret.
     */
    setCredentials(consumerKey, consumerSecret) {
      const changed = consumerKey !== key || consumerSecret !== secret;
      key = consumerKey ?? '';
      secret = consumerSecret ?? '';
      if (changed) {
        token = null;
        tokenRefreshAt = 0;
      }
    },
    hasCredentials: () => Boolean(key && secret),
    /** @returns {Promise<{result: Array, t?: number}>} Every device. */
    getDevices: () => call('GET', '/devices'),
    /**
     * @param {string} id - Device id.
     * @returns {Promise<{result: object}>} One device.
     */
    getDevice: (id) => call('GET', devicePath(id)),
    /**
     * @param {string} id - Device id.
     * @returns {Promise<{result: Array}>} Its status list.
     */
    getDeviceStatus: (id) => call('GET', `${devicePath(id)}/status`),
    /**
     * @description Send commands; true when Danfoss accepted them (both the
     * documented `{ result: true }` and the observed `{ t }` answers).
     * @param {string} id - Device id.
     * @param {Array<{code: string, value: unknown}>} commands - The commands.
     * @returns {Promise<boolean>} Accepted.
     */
    async sendCommands(id, commands) {
      const body = await call('POST', `${devicePath(id)}/commands`, { commands });
      if (body && 'result' in body) return Boolean(body.result);
      return Boolean(body && 't' in body);
    },
    /** @returns {number} Requests sent during the last hour. */
    requestsLastHour() {
      prune();
      return sentAt.length;
    },
  };
}

export {
  API_HOST,
  TOKEN_PATH,
  MIN_INTERVAL_MS,
  RATE_LIMIT_RETRIES,
  CredentialsError,
  RateLimitError,
  ApiError,
  NetworkError,
  createDanfossApi,
};
