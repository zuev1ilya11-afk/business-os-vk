import test from 'node:test';
import assert from 'node:assert/strict';
import { productionPath } from '../shared/routing.ts';
import { forwardRequest } from '../shared/proxy.ts';

test('current and historical function URLs resolve only to current production paths', () => {
  const origin = 'https://recovery.example';
  for (const raw of [
    'https://139.100.237.167/api/proxy/mini-app-api',
    'https://obsropbslfwtanyspjbi.supabase.co/functions/v1/mini-app-api',
    'https://business-os-api-gateway.netlify.app/api/proxy/mini-app-api',
    '/functions/v1/mini-app-api',
  ]) assert.equal(productionPath(raw, origin), '/functions/v1/mini-app-api');
  assert.equal(productionPath('https://example.org/functions/v1/mini-app-api', origin), null);
});

test('session, request body, HTTP status and response headers survive forwarding', async () => {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response('{"ok":false,"error":"UNAUTHORIZED"}', {
      status: 401, headers: { 'Content-Type': 'application/json', 'X-BOS-Session': 'test-only' },
    });
  };
  try {
    const body = '{"action":"bootstrap"}';
    const result = await forwardRequest({ path: '/functions/v1/mini-app-api', method: 'POST',
      headers: { 'x-bos-session': 'test-only', 'content-type': 'application/json', cookie: 'must-not-forward' },
      bodyBase64: Buffer.from(body).toString('base64') });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://139.100.237.167/functions/v1/mini-app-api');
    assert.equal(calls[0].options.headers['x-bos-session'], 'test-only');
    assert.equal(calls[0].options.headers.cookie, undefined);
    assert.equal(Buffer.from(calls[0].options.body).toString(), body);
    assert.equal(calls[0].options.redirect, 'error');
    assert.equal(result.status, 401);
    assert.equal(result.headers['x-bos-session'], 'test-only');
    assert.equal(JSON.parse(Buffer.from(result.bodyBase64, 'base64').toString()).error, 'UNAUTHORIZED');
  } finally { globalThis.fetch = previous; }
});

test('foreign hosts and traversal cannot turn the gateway into an open proxy', async () => {
  for (const path of ['https://evil.example/', '//evil.example/', '/functions/v1/../../admin', '/admin', '/functions/v1/%2e%2e/admin']) {
    assert.equal((await forwardRequest({ path, method: 'GET' })).status, 400);
  }
});

test('failed writes are never replayed', async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('simulated failure'); };
  try {
    const result = await forwardRequest({ path: '/functions/v1/mini-app-api', method: 'POST' });
    assert.equal(result.status, 502);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = previous; }
});
