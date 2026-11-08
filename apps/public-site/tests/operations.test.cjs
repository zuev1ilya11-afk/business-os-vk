"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { setupStaging } = require("../../../client-portal/staging/setup.cjs");
const { createPortal } = require("../../../client-portal/server/api.cjs");
async function seedRecoveryData(stage, privateDir) {
  const portal = await createPortal(stage),
    origin = "http://127.0.0.1:4180";
  let cookie = "",
    csrf = "";
  const call = async (route, body) => {
    const r = await portal.handle(
      new Request(origin + "/client-api" + route, {
        method: body ? "POST" : "GET",
        headers: {
          Origin: origin,
          "content-type": "application/json",
          Cookie: cookie,
          "x-csrf-token": csrf,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
    assert.equal(r.status, 200, route);
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    const out = await r.json();
    if (out.csrf_token) csrf = out.csrf_token;
    return out;
  };
  const docs = (await call("/documents")).documents,
    ch = await call("/auth/request", { phone: "+79995552999" }),
    otp = JSON.parse(
      await fs.readFile(
        path.join(privateDir, "otp", ch.challenge_id + ".json"),
        "utf8",
      ),
    );
  await call("/auth/verify", {
    challenge_id: ch.challenge_id,
    code: otp.code,
    consents: docs
      .filter((d) => d.required)
      .map(({ document, version }) => ({ document, version })),
  });
  const order = (
    await call("/website/orders", {
      request_id: crypto.randomUUID(),
      name: "Тест восстановления",
      address: "Тестовый адрес",
      description: "Тестовая задача",
      items: [],
      desired_date: "2026-12-01",
      desired_interval: "10:00–13:00",
    })
  ).order;
  await call("/orders/" + order.id + "/attachments", {
    name: "recovery.png",
    mime: "image/png",
    data_base64:
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNQcLBQcLBggFAAEE4CYfopkxgAAAAASUVORK5CYII=",
  });
  await call("/website/business-leads", {
    request_id: crypto.randomUUID(),
    company: "Тест восстановления",
    contact_name: "Тест",
    description: "Синтетический лид",
    objects_count: 1,
  });
  return order.id;
}
async function privateSnapshot(dir) {
  const out = {};
  async function walk(base) {
    for (const name of await fs.readdir(base)) {
      const p = path.join(base, name);
      if ((await fs.stat(p)).isDirectory()) await walk(p);
      else
        out[path.relative(dir, p)] = crypto
          .createHash("sha256")
          .update(await fs.readFile(p))
          .digest("hex");
    }
  }
  await walk(dir);
  return out;
}
async function snapshot(db) {
  const out = {};
  for (const table of [
    "website_schema_version",
    "website_service_pages",
    "website_business_leads",
    "website_order_attribution",
    "website_reviews",
    "website_staff_events",
    "client_catalog",
    "orders",
    "client_accounts",
    "client_order_quotes",
    "client_attachments",
    "client_idempotency",
  ]) {
    const rows = (await db.query("select * from " + table)).rows;
    rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    out[table] = crypto
      .createHash("sha256")
      .update(
        JSON.stringify(rows, (_k, v) =>
          typeof v === "bigint" ? String(v) : v,
        ),
      )
      .digest("hex");
  }
  return out;
}
test("website migration archives and restores without deleting shared records", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "website-rollback-"));
  const stage = await setupStaging({
    dataDir: path.join(dir, "db"),
    privateDir: path.join(dir, "private"),
    websiteEnabled: true,
  });
  t.after(async () => {
    await stage.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  await seedRecoveryData(stage, path.join(dir, "private"));
  const before = await snapshot(stage.db);
  await stage.db.exec(
    await fs.readFile(path.join(__dirname, "../ops/rollback.sql"), "utf8"),
  );
  assert.equal(
    (
      await stage.db.query(
        "select to_regclass('public.website_service_pages') as name",
      )
    ).rows[0].name,
    null,
  );
  assert.equal(
    (
      await stage.db.query(
        "select count(*) as n from website_rollback_20261106.website_service_pages",
      )
    ).rows[0].n,
    10,
  );
  await stage.db.exec(
    await fs.readFile(
      path.join(__dirname, "../ops/restore-schema.sql"),
      "utf8",
    ),
  );
  assert.deepEqual(await snapshot(stage.db), before);
});
test("closed website database and private files restore into another isolated directory", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "website-restore-")),
    src = path.join(dir, "src"),
    dst = path.join(dir, "dst");
  let stage = await setupStaging({
    dataDir: path.join(src, "db"),
    privateDir: path.join(src, "private"),
    websiteEnabled: true,
  });
  t.after(async () => {
    await stage?.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const portal = await createPortal(stage);
  const res = await portal.handle(
    new Request("http://127.0.0.1:4180/client-api/website/catalog"),
  );
  assert.equal(res.status, 200);
  const orderId = await seedRecoveryData(stage, path.join(src, "private"));
  const before = await snapshot(stage.db),
    privateBefore = await privateSnapshot(path.join(src, "private"));
  await stage.close();
  stage = null;
  await fs.cp(src, dst, { recursive: true, errorOnExist: true, force: false });
  stage = await setupStaging({
    dataDir: path.join(dst, "db"),
    privateDir: path.join(dst, "private"),
    websiteEnabled: true,
  });
  assert.deepEqual(await snapshot(stage.db), before);
  assert.deepEqual(
    await privateSnapshot(path.join(dst, "private")),
    privateBefore,
  );
  assert.equal(
    (
      await stage.db.query(
        "select count(*) as n from client_attachments where order_id=$1",
        [orderId],
      )
    ).rows[0].n,
    1,
  );
  const restored = await createPortal(stage);
  assert.equal(
    (
      await restored.handle(
        new Request("http://127.0.0.1:4180/client-api/website/catalog"),
      )
    ).status,
    200,
  );
});
