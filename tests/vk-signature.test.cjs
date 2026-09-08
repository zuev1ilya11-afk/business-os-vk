const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = join(__dirname, '..');
const backendSource = readFileSync(join(root, 'google-apps-script/Code.gs'), 'utf8');
const frontendSource = readFileSync(join(root, 'app-sheets.js'), 'utf8');
const TEST_SECRET = 'local-test-only-not-a-vk-app-secret';

function backend(secret = TEST_SECRET, source = backendSource) {
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => secret }) },
    Utilities: {
      Charset: { UTF_8: 'UTF-8' },
      computeHmacSha256Signature: (value, key, charset) => {
        assert.equal(charset, 'UTF-8');
        return [...createHmac('sha256', key).update(value, 'utf8').digest()]
          .map(byte => byte > 127 ? byte - 256 : byte);
      },
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_'),
    },
    ContentService: {
      MimeType: { JAVASCRIPT: 'javascript' },
      createTextOutput: text => ({ text, setMimeType() { return this; } }),
    },
  });
  vm.runInContext(source, context);
  return context;
}

// Independent oracle: native URLSearchParams + Node crypto, not GAS helpers.
function signed(raw, secret = TEST_SECRET) {
  const params = new URLSearchParams(raw);
  const vk = new URLSearchParams([...params].filter(([key]) => key.startsWith('vk_')));
  vk.sort();
  const sign = createHmac('sha256', secret).update(vk.toString()).digest('base64url');
  return raw + '&sign=' + sign;
}

const base = 'vk_user_id=12345&vk_app_id=54758847&vk_access_token_settings=&vk_language=ru';
const b = backend();

test('accepts sorted form serialization of spaces, plus, Unicode and reserved characters', () => {
  const raw = base + '&vk_ref=' + encodeURIComponent("Москва + &=%2B !'()~*/?# 😀");
  assert.equal(b.verifyVk_(signed(raw)).userId, '12345');
  assert.equal(b.verifyVk_('?' + signed(raw)).appId, '54758847');
});

test('form serializer matches native URLSearchParams over ASCII and Unicode', () => {
  const value = Array.from({ length: 128 }, (_, i) => String.fromCharCode(i)).join('') + 'Москва 😀';
  assert.equal('vk_ref=' + b.formEncode_(value), new URLSearchParams({ vk_ref: value }).toString());
});

test('plus and percent-encoded spaces have the same meaning, literal plus stays distinct', () => {
  const raw = signed(base + '&vk_ref=a+b');
  assert.ok(b.verifyVk_(raw.replace('a+b', 'a%20b')));
  assert.equal(b.verifyVk_(raw.replace('a+b', 'a%2Bb')), null);
});

test('preserves empty values, equals signs, escaped keys and percent sequences', () => {
  assert.ok(b.verifyVk_(signed(base + '&vk_empty&vk_ref=a=b%3Dc%2526%252B')));
  assert.ok(b.verifyVk_(signed(base).replace('vk_user_id', '%76k_user_id')));
});

test('ignores unsigned parameters and their order', () => {
  const raw = signed(base + '&screen=orders&callback=one');
  assert.ok(b.verifyVk_(raw.replace('screen=orders&callback=one', 'callback=two&screen=team')));
  assert.ok(b.verifyVk_(raw.split('&').reverse().join('&')));
});

test('rejects changed signed values, wrong app and wrong secret', () => {
  assert.equal(b.verifyVk_(signed(base).replace('12345', '54321')), null);
  assert.equal(b.verifyVk_(signed(base.replace('54758847', '1'))), null);
  assert.equal(backend('wrong-secret').verifyVk_(signed(base)), null);
});

test('rejects missing identity/signature and non-base64url or padded signatures', () => {
  for (const raw of ['', base, 'sign=' + 'A'.repeat(43), signed(base) + '=',
    signed(base).replace(/sign=.*/, 'sign=+'), signed(base.replace('vk_user_id=12345&', ''))]) {
    assert.equal(b.verifyVk_(raw), null);
  }
});

test('rejects duplicate signed keys and signatures including encoded duplicate keys', () => {
  for (const extra of ['&vk_user_id=12345', '&%76k_user_id=12345', '&sign=' + 'A'.repeat(43)]) {
    assert.equal(b.verifyVk_(signed(base) + extra), null);
  }
});

test('malformed signed encoding fails closed without an uncaught URI error', () => {
  for (const value of ['%', '%GG', '%E0%A4', '%ED%A0%80']) {
    assert.equal(b.verifyVk_(signed(base) + '&vk_ref=' + value), null);
  }
});

test('matches the published VKCOM fixture (public example app, not production credentials)', () => {
  // https://github.com/VKCOM/vk-apps-launch-params/blob/master/examples/python3.py
  const example = backend('wvl68m4dR1UpLrVRli', backendSource.replace("const VK_APP_ID = '54758847'", "const VK_APP_ID = '6736218'"));
  const raw = 'vk_user_id=494075&vk_app_id=6736218&vk_is_app_user=1&vk_are_notifications_enabled=1&vk_language=ru&vk_access_token_settings=&vk_platform=android&sign=htQFduJpLxz7ribXRZpDFUH-XEUhC9rBPTJkjUFEkRA';
  assert.equal(example.verifyVk_(raw).userId, '494075');
});

test('doGet rejects invalid launch params before spreadsheet access', () => {
  const response = b.doGet({ parameter: { callback: 'boscb_test', launch_params: signed(base).replace('12345', '54321') } });
  assert.equal(response.text, 'boscb_test({"ok":false,"error":"INVALID_VK_SIGNATURE"});');
});

test('configuration errors use the requested JSONP callback', () => {
  const response = backend('').doGet({ parameter: { callback: 'boscb_test', launch_params: signed(base) } });
  assert.equal(response.text, 'boscb_test({"ok":false,"error":"VK_APP_SECRET is not configured"});');
});

test('real frontend transports original launch bytes through JSONP after URL changes', async () => {
  const original = signed(base + '&vk_ref=a%2Bb+c%2526%3D%26%F0%9F%98%80&screen=orders');
  const location = { search: '?' + original };
  const requests = [];
  const elements = new Map();
  const element = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} } });
  const context = vm.createContext({
    location, URLSearchParams, console, setTimeout, clearTimeout,
    BUSINESS_OS_CONFIG: { GAS_WEB_APP_URL: 'https://example.invalid/exec' },
    document: {
      querySelector: key => { if (!elements.has(key)) elements.set(key, element()); return elements.get(key); },
      querySelectorAll: () => [],
      createElement: () => ({ remove() {} }),
      body: { appendChild(script) {
        const query = new URL(script.src).searchParams;
        // Google decodes the outer query once when producing e.parameter.
        const launch = query.get('launch_params');
        assert.equal(launch, original);
        assert.equal(b.verifyVk_(launch).userId, '12345');
        requests.push(query.get('action'));
        context[query.get('callback')]({ ok: true, user: { role: 'owner' } });
      } },
    },
    vkBridge: { async send(method) {
      if (method === 'VKWebAppInit') location.search = '?screen=team';
      return { first_name: 'Test' };
    } },
  });
  context.window = context;
  // Execute the entire app, including init(), without replacing its API code.
  await vm.runInContext(frontendSource, context);
  await context.api('updateOrder', { id: 'test', status: 'В работе' });
  assert.deepEqual(requests, ['bootstrap', 'updateOrder']);
});
