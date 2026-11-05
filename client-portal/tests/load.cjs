'use strict';
// Bounded synthetic load. Refuses non-loopback targets and non-test delivery.
// Run only against a freshly created LOCAL staging instance.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const assert = require('node:assert/strict');

const percentile = (values, q) => values.slice().sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * q) - 1)] || 0;
async function runLoad({ baseUrl, privateDir, concurrency = 5, rounds = 6, resourceSample = () => ({}) }) {
 const url = new URL(baseUrl);
 assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Load target must be loopback');
 assert.ok(concurrency >= 1 && concurrency <= 5 && rounds >= 1 && rounds <= 10, 'Bounded workload only');
 const health = await fetch(new URL('/client-api/health', url)).then(r => r.json());
 assert.ok(health.ok && health.environment !== 'production' && health.delivery === 'test', 'Refusing non-isolated target');
 const timings = {}, errors = [];
 async function request(session, name, route, method = 'GET', body) {
  const start = performance.now();
  const response = await fetch(new URL('/client-api' + route, url), {
   method, headers: { Origin: url.origin, ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(session?.cookie ? { Cookie: session.cookie } : {}), ...(session?.csrf ? { 'x-csrf-token': session.csrf } : {}) },
   ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json();
  if (name) (timings[name] ||= []).push(performance.now() - start);
  if (!response.ok || !data.ok) {
   const error = `${name || route}:${response.status}:${data.code || 'ERROR'}`; errors.push(error); throw Error(error);
  }
  const set = response.headers.get('set-cookie');
  if (session && set) session.cookie = set.split(';')[0];
  if (session && data.csrf_token) session.csrf = data.csrf_token;
  return data;
 }
 const documents = await request(null, null, '/documents');
 const consents = documents.documents.filter(d => d.required).map(({document, version}) => ({document, version}));
 const sessions = [];
 for (let i = 0; i < concurrency; i++) {
  const session = {};
  const { challenge_id } = await request(session, null, '/auth/request', 'POST', { phone: '+79995550' + String(100 + i) });
  const otp = JSON.parse(await fs.readFile(path.join(privateDir, 'otp', challenge_id + '.json'), 'utf8'));
  await request(session, null, '/auth/verify', 'POST', { challenge_id, code: otp.code,
   consents });
  sessions.push(session);
 }
 const before = resourceSample();
 const wallStart = performance.now();
 await Promise.all(sessions.map(async (session, i) => {
  for (let round = 0; round < rounds; round++) {
   await request(session, 'dashboard', '/session');
   const { order } = await request(session, 'create_order', '/orders', 'POST', {
    request_id: randomUUID(), items: [], city: 'Санкт-Петербург', name: 'Нагрузочный тест ' + i,
    address: 'Синтетический адрес ' + (i + 1), description: 'Закрепить тестовую полку',
    desired_date: '', desired_interval: '', comment: '', parameters: {}
   });
   await request(session, 'orders', '/orders?limit=20&offset=0');
   await request(session, 'message', '/messages', 'POST', { request_id: randomUUID(), order_id: order.id, body: 'Синтетическое сообщение ' + round });
   await request(session, 'messages', '/messages?order_id=' + order.id);
   if (round === 0) await request(session, 'upload', '/orders/' + order.id + '/attachments', 'POST', {
    name: 'test.png', mime: 'image/png', data_base64: 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNQcLBQcLBggFAAEE4CYfopkxgAAAAASUVORK5CYII='
   });
  }
 }));
 const wallMs = performance.now() - wallStart;
 const after = resourceSample();
 for (const session of sessions) await request(session, null, '/auth/logout', 'POST', { all_devices: true });
 return { scope: 'local synthetic PGlite; not production capacity', concurrency, rounds, duration_ms: Math.round(wallMs),
  requests: Object.values(timings).reduce((n, a) => n + a.length, 0), errors,
  routes: Object.fromEntries(Object.entries(timings).map(([name, times]) => [name, { count: times.length,
   p50_ms: +percentile(times, 0.50).toFixed(1), p95_ms: +percentile(times, 0.95).toFixed(1), max_ms: +Math.max(...times).toFixed(1) }])), resources: { before, after } };
}
module.exports = { runLoad };
if (require.main === module) runLoad({ baseUrl: process.env.BOS_TEST_BASE_URL || 'http://127.0.0.1:4180',
 privateDir: process.env.BOS_TEST_PRIVATE_DIR || path.resolve('.client-portal-stage/private') })
 .then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
