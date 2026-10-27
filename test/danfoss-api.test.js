import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CredentialsError,
  RateLimitError,
  ApiError,
  NetworkError,
  createDanfossApi,
} from '../src/danfoss-api.js';
import { apiWithFetch, RADIATOR } from './helpers/fixtures.js';

const KEY = 'consumer-key-123';
const SECRET = 'consumer-secret-456';
const TOKEN = { access_token: 'token-abc', expires_in: 3599, token_type: 'Bearer' };
// The real answer of https://api.danfoss.com/oauth2/token to wrong credentials.
const INVALID = {
  type: 'https://developer.danfoss.com/error-code-reference#api-key-invalid',
  title: 'API key invalid',
  status: 401,
  detail: 'InvalidClientIdentifier',
};

/**
 * @description A fetch handler: the token, then the routes.
 * @param {object} routes - `{ 'GET /ally/devices': answer | (init) => answer }`.
 * @returns {Function} The handler.
 */
const server = (routes) => (url, init) => {
  const path = new URL(url).pathname;
  const key = `${init.method} ${path}`;
  if (key === 'POST /oauth2/token') {
    return routes[key] ? routes[key](init) : { status: 200, body: TOKEN };
  }
  const route = routes[key];
  if (!route) return { status: 404, body: { title: 'Not Found', status: 404 } };
  return typeof route === 'function' ? route(init) : route;
};

test('the token: client credentials, Basic auth, form body, then a Bearer call', async () => {
  const { api, fetch } = apiWithFetch(
    server({ 'GET /ally/devices': { status: 200, body: { result: [RADIATOR], t: 1 } } }),
  );
  api.setCredentials(KEY, SECRET);
  assert.equal(api.hasCredentials(), true);
  const answer = await api.getDevices();
  assert.equal(answer.result[0].id, RADIATOR.id);
  const [token, call] = fetch.requests;
  assert.equal(token.url, 'https://api.danfoss.com/oauth2/token');
  assert.equal(token.method, 'POST');
  assert.equal(
    token.headers.Authorization,
    `Basic ${Buffer.from(`${KEY}:${SECRET}`).toString('base64')}`,
  );
  assert.equal(token.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(token.body, 'grant_type=client_credentials');
  assert.equal(call.url, 'https://api.danfoss.com/ally/devices');
  assert.equal(call.headers.Authorization, 'Bearer token-abc');
  assert.equal(call.headers.Accept, 'application/json');
  assert.ok(call.signal, 'every request has a timeout');
});

test('the token is reused, then renewed 30 s before it expires', async () => {
  const { api, fetch, clock } = apiWithFetch(
    server({ 'GET /ally/devices': { status: 200, body: { result: [] } } }),
  );
  api.setCredentials(KEY, SECRET);
  await api.getDevices();
  clock.now += 3000 * 1000;
  await api.getDevices();
  const tokens = () => fetch.requests.filter((r) => r.url.endsWith('/oauth2/token')).length;
  assert.equal(tokens(), 1);
  clock.now += 570 * 1000; // 3570 s: within the 30 s margin of 3599 s
  await api.getDevices();
  assert.equal(tokens(), 2);
  api.setCredentials(KEY, 'another-secret');
  await api.getDevices();
  assert.equal(tokens(), 3, 'new credentials, new token');
});

test('wrong credentials: a CredentialsError without the secret', async () => {
  const { api } = apiWithFetch(
    server({ 'POST /oauth2/token': () => ({ status: 401, body: INVALID }) }),
  );
  api.setCredentials(KEY, SECRET);
  await assert.rejects(api.getDevices(), (err) => {
    assert.ok(err instanceof CredentialsError);
    assert.equal(err.reason, 'API_KEY_INVALID');
    assert.equal(err.status, 401);
    assert.doesNotMatch(err.message, new RegExp(`${SECRET}|${KEY}`));
    return true;
  });
  const empty = createDanfossApi({ fetchImpl: () => assert.fail('no request') });
  assert.equal(empty.hasCredentials(), false);
  await assert.rejects(empty.getDevices(), (err) => err.reason === 'MISSING');
});

test('a 401 on the Ally API renews the token once; a 403 is a refused API', async () => {
  let calls = 0;
  const { api, fetch } = apiWithFetch(
    server({
      'GET /ally/devices': () => {
        calls += 1;
        return calls === 1 ? { status: 401, body: {} } : { status: 200, body: { result: [] } };
      },
    }),
  );
  api.setCredentials(KEY, SECRET);
  assert.deepEqual(await api.getDevices(), { result: [] });
  assert.equal(fetch.requests.filter((r) => r.url.endsWith('/oauth2/token')).length, 2);

  const always = apiWithFetch(server({ 'GET /ally/devices': { status: 401, body: {} } }));
  always.api.setCredentials(KEY, SECRET);
  await assert.rejects(always.api.getDevices(), (err) => err.reason === 'UNAUTHORIZED');

  const forbidden = apiWithFetch(server({ 'GET /ally/devices': { status: 403, body: {} } }));
  forbidden.api.setCredentials(KEY, SECRET);
  await assert.rejects(forbidden.api.getDevices(), (err) => err.reason === 'FORBIDDEN');
});

test('a 429 is retried after an exponential wait, Retry-After first, then reported', async () => {
  let calls = 0;
  const { api, clock } = apiWithFetch(
    server({
      'GET /ally/devices': () => {
        calls += 1;
        return calls < 3 ? { status: 429, body: {} } : { status: 200, body: { result: [] } };
      },
    }),
  );
  api.setCredentials(KEY, SECRET);
  await api.getDevices();
  assert.deepEqual(
    clock.slept.filter((ms) => ms >= 1000),
    [1000, 2000],
  );

  const limited = apiWithFetch(
    server({ 'GET /ally/devices': { status: 429, body: {}, headers: { 'Retry-After': '7' } } }),
  );
  limited.api.setCredentials(KEY, SECRET);
  await assert.rejects(limited.api.getDevices(), (err) => {
    assert.ok(err instanceof RateLimitError);
    assert.equal(err.retryAfterMs, 7000);
    return true;
  });
  assert.deepEqual(
    limited.clock.slept.filter((ms) => ms >= 1000),
    [7000, 7000],
  );
});

test('requests are spaced: about three per second at most', async () => {
  const { api, clock } = apiWithFetch(
    server({ 'GET /ally/devices': { status: 200, body: { result: [] } } }),
  );
  api.setCredentials(KEY, SECRET);
  const start = clock.now;
  await Promise.all([api.getDevices(), api.getDevices(), api.getDevices()]);
  // token + 3 calls = 4 requests, 3 gaps of 350 ms.
  assert.ok(clock.now - start >= 3 * 350, `${clock.now - start} ms`);
  assert.equal(api.requestsLastHour(), 4);
  clock.now += 61 * 60 * 1000;
  assert.equal(api.requestsLastHour(), 0);
});

test('one device, its status, commands; ids are URI-encoded', async () => {
  const { api, fetch } = apiWithFetch(
    server({
      'GET /ally/devices/a%2Fb': { status: 200, body: { result: RADIATOR } },
      'GET /ally/devices/a%2Fb/status': { status: 200, body: { result: RADIATOR.status } },
      'POST /ally/devices/a%2Fb/commands': (init) => {
        assert.deepEqual(JSON.parse(init.body), { commands: [{ code: 'temp_set', value: 215 }] });
        assert.equal(init.headers['Content-Type'], 'application/json');
        return { status: 201, body: { result: true, t: 1 } };
      },
    }),
  );
  api.setCredentials(KEY, SECRET);
  assert.equal((await api.getDevice('a/b')).result.id, RADIATOR.id);
  assert.equal((await api.getDeviceStatus('a/b')).result.length, RADIATOR.status.length);
  assert.equal(await api.sendCommands('a/b', [{ code: 'temp_set', value: 215 }]), true);
  assert.ok(fetch.requests.every((r) => !r.url.includes('a/b')));
});

test('the command answers: { result } or only { t }', async () => {
  const answers = [{ result: false }, { t: 1551851043862 }, {}];
  const { api } = apiWithFetch(
    server({ 'POST /ally/devices/x/commands': () => ({ status: 201, body: answers.shift() }) }),
  );
  api.setCredentials(KEY, SECRET);
  assert.equal(await api.sendCommands('x', []), false);
  assert.equal(await api.sendCommands('x', []), true);
  assert.equal(await api.sendCommands('x', []), false);
});

test('HTTP and network errors', async () => {
  const { api } = apiWithFetch(
    server({
      'GET /ally/devices/gw/status': {
        status: 500,
        body: { title: 'Internal Server Error', status: 500 },
      },
    }),
  );
  api.setCredentials(KEY, SECRET);
  await assert.rejects(api.getDeviceStatus('gw'), (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 500);
    assert.match(err.message, /Internal Server Error/);
    return true;
  });
  const down = createDanfossApi({
    fetchImpl: async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    },
    sleep: async () => {},
  });
  down.setCredentials(KEY, SECRET);
  await assert.rejects(down.getDevices(), (err) => {
    assert.ok(err instanceof NetworkError);
    assert.match(err.message, /ENOTFOUND/);
    return true;
  });
  const noToken = apiWithFetch(
    server({ 'POST /oauth2/token': () => ({ status: 200, body: { token_type: 'Bearer' } }) }),
  );
  noToken.api.setCredentials(KEY, SECRET);
  await assert.rejects(noToken.api.getDevices(), ApiError);
});
