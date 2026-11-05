'use strict';
// Synthetic recovery rehearsal only. Never connects to a server or production DB.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { setupStaging } = require('../staging/setup.cjs');
const { createPortal } = require('../server/api.cjs');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

async function privatePermissions(directory) {
 await fs.chmod(directory, 0o700);
 for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
  const target = path.join(directory, entry.name);
  assert.ok(!entry.isSymbolicLink(), 'Synthetic backup may not follow symlinks');
  if (entry.isDirectory()) await privatePermissions(target);
  else await fs.chmod(target, 0o600);
 }
}

async function fingerprints(db) {
 const tables = {
  client_accounts: 'id', orders: 'id', client_order_quotes: 'order_id',
  client_messages: 'id', client_attachments: 'id', client_consents: 'account_id,document,version',
  client_events: 'id', client_notifications: 'id', client_sessions: 'token_hash',
  client_idempotency: 'account_id,scope,request_id', business_staff: 'id'
 };
 const result = {};
 for (const [table, order] of Object.entries(tables)) {
  const { rows } = await db.query(`SELECT * FROM ${table} ORDER BY ${order}`);
  result[table] = { count: rows.length, digest: digest(JSON.stringify(rows, (_key, value) => typeof value === 'bigint' ? value.toString() : value)) };
 }
 return result;
}

test('closed synthetic staging database and private files restore into a separate directory', { timeout: 120_000 }, async () => {
 const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'bos-portal-restore-'));
 await fs.chmod(temporary, 0o700);
 const source = path.join(temporary, 'source'), recovered = path.join(temporary, 'recovered');
 const origin = 'http://127.0.0.1:4180';
 let stage, portal;
 const session = {};
 async function raw(route, method = 'GET', body) {
  return portal.handle(new Request(origin + '/client-api' + route, {
   method,
   headers: { Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(session.cookie ? { Cookie: session.cookie } : {}),
    ...(session.csrf ? { 'x-csrf-token': session.csrf } : {}) },
   ...(body ? { body: JSON.stringify(body) } : {})
  }), { ip: '127.0.0.1' });
 }
 async function request(route, method = 'GET', body) {
  const response = await raw(route, method, body);
  assert.ok(response.ok, `Synthetic recovery setup failed at ${route}: HTTP ${response.status}`);
  const data = await response.json();
  assert.equal(data.ok, true, `Synthetic recovery setup failed at ${route}`);
  const cookie = response.headers.get('set-cookie');
  if (cookie) session.cookie = cookie.split(';')[0];
  if (data.csrf_token) session.csrf = data.csrf_token;
  return data;
 }
 try {
  stage = await setupStaging({ dataDir: path.join(source, 'db'), privateDir: path.join(source, 'private'), origin });
  portal = await createPortal(stage);
  const { challenge_id } = await request('/auth/request', 'POST', { phone: '+79990009981' });
  const otp = JSON.parse(await fs.readFile(path.join(source, 'private/otp', challenge_id + '.json'), 'utf8'));
  const consents = stage.config.legalDocuments.filter(d => d.required).map(({ document, version }) => ({ document, version }));
  await request('/auth/verify', 'POST', { challenge_id, code: otp.code, consents });
  const { order } = await request('/orders', 'POST', {
   request_id: crypto.randomUUID(), items: [], name: 'Проверка восстановления',
   address: 'Синтетический адрес для проверки восстановления', city: 'Санкт-Петербург',
   description: 'Закрепить тестовую полку', comment: 'Синтетические данные',
   desired_date: '', desired_interval: '', parameters: {}
  });
  await request('/messages', 'POST', { request_id: crypto.randomUUID(), order_id: order.id,
   body: 'Синтетическое сообщение: должно сохраниться после восстановления.' });
  await request('/orders/' + order.id + '/attachments', 'POST', {
   name: 'restore-test.png', mime: 'image/png',
   data_base64: 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNQcLBQcLBggFAAEE4CYfopkxgAAAAASUVORK5CYII='
  });
  const detail = (await request('/orders/' + order.id)).order;
  assert.equal(detail.attachments.length, 1);
  const attachmentId = detail.attachments[0].id;
  const fileResponse = await raw('/attachments/' + attachmentId);
  assert.equal(fileResponse.status, 200);
  const fileHash = digest(Buffer.from(await fileResponse.arrayBuffer()));
  const before = await fingerprints(stage.db);
  assert.equal(before.client_accounts.count, 1);
  assert.equal(before.orders.count, 1);
  assert.equal(before.client_messages.count, 1);
  assert.equal(before.client_attachments.count, 1);
  assert.ok(before.client_consents.count >= 3);
  const credentialsHash = digest(await fs.readFile(path.join(source, 'private/access.json')));

  // PGlite must be fully closed before copying its filesystem. There are no live writers.
  await stage.close();
  stage = null;
  portal = null;
  await fs.cp(source, recovered, { recursive: true, errorOnExist: true, force: false, dereference: false });
  await privatePermissions(recovered);
  assert.equal((await fs.stat(path.join(recovered, 'private/access.json'))).mode & 0o777, 0o600);
  assert.ok(digest(await fs.readFile(path.join(recovered, 'private/access.json'))) === credentialsHash,
   'Private configuration must remain intact without printing values');

  stage = await setupStaging({ dataDir: path.join(recovered, 'db'), privateDir: path.join(recovered, 'private'), origin });
  portal = await createPortal(stage);
  assert.deepEqual(await fingerprints(stage.db), before, 'Restored rows must match the closed source snapshot');
  const restoredSession = await request('/session');
  assert.equal(restoredSession.authenticated, true, 'Persisted browser session remains valid in isolated recovery');
  const restoredOrder = (await request('/orders/' + order.id)).order;
  assert.equal(restoredOrder.id, order.id);
  assert.equal(restoredOrder.attachments.length, 1);
  const messages = (await request('/messages?order_id=' + order.id)).messages;
  assert.equal(messages.length, 1);
  const recoveredFile = await raw('/attachments/' + attachmentId);
  assert.equal(recoveredFile.status, 200);
  assert.equal(digest(Buffer.from(await recoveredFile.arrayBuffer())), fileHash, 'Private attachment bytes survive restore');
 } finally {
  if (stage) await stage.close();
  await fs.rm(temporary, { recursive: true, force: true });
 }
});
