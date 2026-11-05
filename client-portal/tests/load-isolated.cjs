'use strict';
// Reproducible bounded HTTP load against a disposable real database + API.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { once } = require('node:events');
const assert = require('node:assert/strict');
const { setupStaging } = require('../staging/setup.cjs');
const { createPortal } = require('../server/api.cjs');
const { runLoad } = require('./load.cjs');

async function main() {
 const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bos-portal-load-'));
 let stage, portal;
 const server = http.createServer((req, res) => portal.handler(req, res));
 server.listen(0, '127.0.0.1'); await once(server, 'listening');
 let peakRss = 0;
 const sample = () => {
  const memory = process.memoryUsage(), cpu = process.cpuUsage();
  peakRss = Math.max(peakRss, memory.rss);
  return { rss_mb: +(memory.rss / 1048576).toFixed(1), heap_used_mb: +(memory.heapUsed / 1048576).toFixed(1), cpu_user_ms: +(cpu.user / 1000).toFixed(1), cpu_system_ms: +(cpu.system / 1000).toFixed(1) };
 };
 let monitor;
 try {
  const origin = 'http://127.0.0.1:' + server.address().port;
  const privateDir = path.join(directory, 'private');
  stage = await setupStaging({ dataDir: path.join(directory, 'db'), privateDir, origin });
  portal = await createPortal({ db: stage.db, config: stage.config });
  monitor = setInterval(sample, 20);
  const results = await runLoad({ baseUrl: origin, privateDir, concurrency: 5, rounds: 6, resourceSample: sample });
  clearInterval(monitor);
  const counts = (await stage.db.query('select (select count(*) from client_accounts)::int as clients, (select count(*) from orders)::int as orders, (select count(*) from client_messages)::int as messages, (select count(*) from client_attachments)::int as attachments')).rows[0];
  assert.deepEqual(counts, { clients: 5, orders: 30, messages: 30, attachments: 5 });
  results.resources.peak_sampled_rss_mb = +(peakRss / 1048576).toFixed(1);
  results.resources.workload_cpu_user_ms = +(results.resources.after.cpu_user_ms - results.resources.before.cpu_user_ms).toFixed(1);
  results.resources.workload_cpu_system_ms = +(results.resources.after.cpu_system_ms - results.resources.before.cpu_system_ms).toFixed(1);
  results.persisted_rows = counts;
  console.log(JSON.stringify(results, null, 2));
 } finally {
  clearInterval(monitor);
  await new Promise(resolve => server.close(resolve));
  if (stage) await stage.close();
  await fs.rm(directory, { recursive: true, force: true });
 }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
