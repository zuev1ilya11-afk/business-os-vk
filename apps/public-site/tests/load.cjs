"use strict";
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  http = require("node:http"),
  { once } = require("node:events");
const { setupStaging } = require("../../../client-portal/staging/setup.cjs");
const { createPortal } = require("../../../client-portal/server/api.cjs");
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "website-load-"));
  let portal;
  const server = http.createServer((req, res) => portal.handler(req, res));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = "http://127.0.0.1:" + server.address().port;
  const stage = await setupStaging({
    dataDir: path.join(dir, "db"),
    privateDir: path.join(dir, "private"),
    origin,
    websiteEnabled: true,
  });
  portal = await createPortal(stage);
  const latencies = [],
    errors = [];
  const cpu = process.cpuUsage(),
    begin = performance.now();
  try {
    await Promise.all(
      Array.from({ length: 5 }, async () => {
        for (let n = 0; n < 30; n++) {
          const t = performance.now();
          try {
            const response = await fetch(
              origin +
                "/client-api/website/" +
                (n % 2 ? "quote" : "catalog?q=" + encodeURIComponent("кран")),
              {
                method: n % 2 ? "POST" : "GET",
                headers: { Origin: origin, "content-type": "application/json" },
                ...(n % 2
                  ? {
                      body: JSON.stringify({
                        items: [
                          { service_id: "web_zamena_smesitelya", quantity: 2 },
                        ],
                      }),
                    }
                  : {}),
              },
            );
            if (!response.ok) errors.push(response.status);
            await response.arrayBuffer();
          } catch (e) {
            errors.push(e.name);
          }
          latencies.push(performance.now() - t);
        }
      }),
    );
    latencies.sort((a, b) => a - b);
    const used = process.cpuUsage(cpu);
    console.log(
      JSON.stringify(
        {
          environment:
            "local isolated PGlite API, NOT RU server; not Next rendering load",
          requests: 150,
          concurrency: 5,
          errors: errors.length,
          statuses: errors,
          duration_ms: Math.round(performance.now() - begin),
          p50_ms: +latencies[75].toFixed(2),
          p95_ms: +latencies[142].toFixed(2),
          max_ms: +latencies[149].toFixed(2),
          rss_mb: +(process.memoryUsage().rss / 1048576).toFixed(1),
          cpu_user_ms: used.user / 1000,
          cpu_system_ms: used.system / 1000,
        },
        null,
        2,
      ),
    );
    if (errors.length) process.exitCode = 1;
  } finally {
    await new Promise((r) => server.close(r));
    await stage.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
