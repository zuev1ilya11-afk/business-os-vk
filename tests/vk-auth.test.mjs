import assert from 'node:assert/strict';
import { createHmac, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';

// Synthetic credentials only; these tests never read environment secrets or use a network.
const secret = 'synthetic-test-key-not-a-vk-app-secret';
const appId = '54758847';
const source = readFileSync(new URL('../supabase/functions/vk-auth/index.ts', import.meta.url), 'utf8');
let handler;
let adminCalls = 0;
const context = vm.createContext({
  URLSearchParams, TextEncoder, Uint8Array, btoa, crypto: webcrypto, Response, Error,
  createClient() { adminCalls++; throw new Error('TEST_AUTHENTICATED'); },
  Deno: {
    serve(fn) { handler = fn; },
    env: { get(name) { return name === 'VK_APP_SECRET' ? secret : 'synthetic-test-setting'; } },
  },
});
// Execute the actual Edge Function, replacing only its external Supabase import.
vm.runInContext(stripTypeScriptTypes(source.replace(/^import .*?;\r?\n/, '')), context);
const verify = (raw, key = secret, id = appId) => context.verifyVkLaunchParams(raw, key, id);
const signature = canonical => createHmac('sha256', secret).update(canonical).digest('base64url');
const basicCanonical = 'vk_app_id=54758847&vk_user_id=12345';
const basic = `vk_user_id=12345&vk_app_id=54758847&sign=${signature(basicCanonical)}`;

// Expected canonical text is explicit, not produced by the implementation under test.
const vectors = [
  ['space as %20', 'hello%20world', 'hello%20world'],
  ['space as +', 'hello+world', 'hello%20world'],
  ['literal plus', 'hello%2Bworld', 'hello%2Bworld'],
  ['URI punctuation', '%7E%21%27%28%29%2A', "~!'()*"],
  ['Unicode', '%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82%20%F0%9F%91%8B', '%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82%20%F0%9F%91%8B'],
  ['encoded delimiters', 'a%26b%3Dc%2Fd%3Fe%23f', 'a%26b%3Dc%2Fd%3Fe%23f'],
  ['decode only once', '%2520%252B%2526', '%2520%252B%2526'],
  ['empty value', '', ''],
];

test('accepts sorted signature regardless of input order, ? prefix and unsigned fields', async () => {
  for (const raw of [basic, `?${basic}`, `extra=ignored&${basic}&utm_source=anything`]) {
    assert.equal((await verify(raw))?.vkUserId, 12345);
  }
});

for (const [name, transport, encoded] of vectors) {
  test(`VK encoding: ${name}`, async () => {
    const canonical = `vk_app_id=54758847&vk_ref=${encoded}&vk_user_id=12345`;
    const raw = `vk_user_id=12345&vk_ref=${transport}&sign=${signature(canonical)}&vk_app_id=54758847`;
    assert.equal((await verify(raw))?.appId, Number(appId));
  });
}

test('includes every vk_* field, including empty values and future parameters', async () => {
  const canonical = 'vk_access_token_settings=&vk_app_id=54758847&vk_future=1&vk_user_id=12345';
  const raw = `vk_future=1&vk_user_id=12345&vk_access_token_settings=&vk_app_id=54758847&sign=${signature(canonical)}`;
  assert.ok(await verify(raw));
  assert.equal(await verify(raw.replace('vk_future=1', 'vk_future=2')), null);
  assert.equal(await verify(raw.replace('vk_access_token_settings=&', '')), null);
});

test('rejects the old form-encoded signature for spaces and punctuation', async () => {
  const oldCanonical = 'vk_app_id=54758847&vk_ref=hello+world%7E&vk_user_id=12345';
  assert.equal(await verify(`vk_app_id=54758847&vk_ref=hello%20world~&vk_user_id=12345&sign=${signature(oldCanonical)}`), null);
});

test('rejects tampering, wrong app, wrong key, malformed and missing signatures', async () => {
  assert.equal(await verify(basic.replace('12345', '54321')), null);
  assert.equal(await verify(basic, 'another-synthetic-key'), null);
  assert.equal(await verify(basic, secret, '1'), null);
  for (const raw of [basic.replace('54758847', '1'), basic.replace(/sign=.*/, ''),
    basic.replace(/sign=.*/, 'sign=bad'), `${basic}=`, 'sign=' + 'a'.repeat(43)]) {
    assert.equal(await verify(raw), null);
  }
});

test('rejects duplicate signed fields, including encoded duplicate names', async () => {
  for (const extra of ['vk_user_id=67890', 'vk_app_id=54758847', `sign=${signature(basicCanonical)}`, '%76k_user_id=12345']) {
    assert.equal(await verify(`${basic}&${extra}`), null);
  }
});

test('rejects invalid input types without throwing', async () => {
  for (const raw of [undefined, null, {}, [], 42, true, '']) assert.equal(await verify(raw), null);
});

test('rejects signed IDs that cannot identify a valid user', async () => {
  for (const id of ['0', '-1', 'NaN', '1.5', '9007199254740993']) {
    const canonical = `vk_app_id=54758847&vk_user_id=${id}`;
    assert.equal(await verify(`${canonical}&sign=${signature(canonical)}`), null);
  }
});

test('HTTP boundary rejects invalid signatures before any Supabase operation', async () => {
  const before = adminCalls;
  const response = await handler(new Request('https://test.invalid/vk-auth', {
    method: 'POST', body: JSON.stringify({ launchParams: basic.replace('12345', '54321') }),
  }));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, 'Invalid VK signature');
  assert.equal(adminCalls, before);
});

test('HTTP boundary accepts VK encoding and proceeds to Supabase', async () => {
  const before = adminCalls;
  const canonical = 'vk_app_id=54758847&vk_ref=hello%20world~&vk_user_id=12345';
  const response = await handler(new Request('https://test.invalid/vk-auth', {
    method: 'POST', body: JSON.stringify({ launchParams: `?vk_user_id=12345&vk_ref=hello%20world~&vk_app_id=54758847&sign=${signature(canonical)}` }),
  }));
  assert.equal((await response.json()).error, 'TEST_AUTHENTICATED');
  assert.equal(adminCalls, before + 1);
});

test('frontend sends the original query string unchanged', async () => {
  const raw = `?${basic}&vk_ref=a%2Bb%2520%26c%3Dd&custom=keep+this`;
  const element = { style: {}, classList: { add() {}, remove() {} } };
  let sent;
  const frontend = vm.createContext({
    window: {
      BUSINESS_OS_CONFIG: { SUPABASE_URL: 'https://test.invalid', SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key' },
      supabase: { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }) },
    },
    location: { search: raw },
    document: { querySelector: () => element, querySelectorAll: () => [] },
    console: { error() {} },
    fetch: async (_url, options) => {
      sent = JSON.parse(options.body);
      return { ok: false, json: async () => ({ error: 'TEST_STOP' }) };
    },
  });
  vm.runInContext(readFileSync(new URL('../app-vk.js', import.meta.url), 'utf8'), frontend);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.launchParams, raw);
});
