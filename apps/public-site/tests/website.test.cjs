"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
const {
  createIntegratedStaging,
} = require("../../../client-portal/staging/integrated.cjs");
const {
  resolve,
  fingerprint,
  search,
} = require("../../../client-portal/server/website-catalog.cjs");
const ORIGIN = "http://127.0.0.1:4180";
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNQcLBQcLBggFAAEE4CYfopkxgAAAAASUVORK5CYII=";
async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "website-qa-"));
  const stage = await createIntegratedStaging({
    dataDir: path.join(dir, "db"),
    privateDir: path.join(dir, "private"),
    origin: ORIGIN,
    websiteEnabled: true,
  });
  const request = async (actor, route, method = "GET", body, extra = {}) => {
    const r = await stage.portal.handle(
      new Request(ORIGIN + "/client-api" + route, {
        method,
        headers: {
          Origin: ORIGIN,
          ...(body ? { "content-type": "application/json" } : {}),
          ...(actor?.cookie ? { Cookie: actor.cookie } : {}),
          ...(actor?.csrf ? { "x-csrf-token": actor.csrf } : {}),
          ...(actor?.staff ? { "x-bos-session": actor.staff } : {}),
          ...extra,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
    const data = (r.headers.get("content-type") || "").includes("json")
      ? await r.json()
      : Buffer.from(await r.arrayBuffer());
    if (actor && r.headers.get("set-cookie"))
      actor.cookie = r.headers.get("set-cookie").split(";")[0];
    if (actor && data.csrf_token) actor.csrf = data.csrf_token;
    return { status: r.status, data, headers: r.headers };
  };
  const good = async (...args) => {
    const r = await request(...args);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
  };
  const login = async (phone) => {
    const a = {};
    const ch = await good(a, "/auth/request", "POST", { phone });
    const otp = JSON.parse(
      await fs.readFile(
        path.join(dir, "private/otp", ch.challenge_id + ".json"),
        "utf8",
      ),
    );
    const docs = (await good(null, "/documents")).documents;
    const r = await good(a, "/auth/verify", "POST", {
      challenge_id: ch.challenge_id,
      code: otp.code,
      consents: docs
        .filter((d) => d.required)
        .map(({ document, version }) => ({ document, version })),
    });
    a.profile = r.profile;
    return a;
  };
  return {
    ...stage,
    dir,
    request,
    good,
    login,
    owner: { staff: stage.signStaff("owner") },
    dispatcher: { staff: stage.signStaff("dispatcher") },
    cleanup: async () => {
      await stage.close();
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}
module.exports = { fixture, PNG };
test("canonical price approval, stale approvals, ranges and problem synonyms", () => {
  const p = {
    source_ref: "standard:standard_005",
    upper_source_ref: "standard:standard_006",
    price_display_mode: "range",
  };
  assert.equal(resolve(p, {}).price_min, null);
  p.approved_fingerprint = fingerprint(p);
  const r = resolve(p, {});
  assert.equal(r.price_min, 1699);
  assert.equal(r.price_max, 2229);
  p.approved_fingerprint = "old";
  assert.equal(resolve(p, {}).price_display_mode, "after_inspection");
  const av = { source_ref: "avito:mixer", price_display_mode: "fixed" };
  av.approved_fingerprint = fingerprint(av);
  assert.equal(resolve(av, {}).price_min, null);
  assert.equal(
    search(
      [
        {
          name: "Замена смесителя",
          synonyms: ["течёт кран"],
          category: "Сантехника",
        },
      ],
      "течет кран",
    ).length,
    1,
  );
  assert.equal(
    search([{ name: "Полка", synonyms: [] }], "несуществующая задача").length,
    0,
  );
});
test("website shares persistent orders, safe public price and isolated business pipeline", async (t) => {
  const f = await fixture();
  t.after(() => f.cleanup());
  let alice, bob, order, service;
  await t.test(
    "only mapped published services are exposed, defaults never publish numbers",
    async () => {
      const a = await f.good(null, "/website/catalog");
      assert.equal(a.services.length, 10);
      assert.ok(
        a.services.every(
          (s) =>
            s.price_min === null && s.price_display_mode === "after_inspection",
        ),
      );
      service = a.services.find((s) => s.slug === "zamena-smesitelya");
      assert.equal((await f.good(null, "/catalog")).services.length, 10);
      assert.equal(
        (
          await f.request(null, "/quote", "POST", {
            items: [{ service_id: "curtain_rod", quantity: 1 }],
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await f.good(
            null,
            "/website/catalog?q=" + encodeURIComponent("течёт кран"),
          )
        ).services.length,
        1,
      );
    },
  );
  await t.test(
    "staff confirmation references shared catalog and cannot set a shadow price",
    async () => {
      const pages = (await f.good(f.owner, "/staff/website/catalog")).pages;
      const p = pages.find((p) => p.service_id === service.id);
      assert.equal(
        (
          await f.request(
            f.dispatcher,
            "/staff/website/catalog/" + service.id,
            "PATCH",
            {
              version: p.version,
              published: true,
              approve_price: true,
              price_display_mode: "from",
            },
          )
        ).status,
        403,
      );
      await f.good(f.owner, "/staff/website/catalog/" + service.id, "PATCH", {
        version: p.version,
        published: true,
        approve_price: true,
        price_display_mode: "from",
      });
      const s = (await f.good(null, "/website/catalog")).services.find(
        (s) => s.id === service.id,
      );
      assert.equal(s.price_min, 1000);
      assert.equal(
        (
          await f.request(f.owner, "/staff/catalog/" + service.id, "PATCH", {
            version: 1,
            price: 1,
            price_type: "fixed",
            confirmed: true,
          })
        ).status,
        409,
      );
    },
  );
  await t.test(
    "quantity and parameters are validated, quoted from one price source",
    async () => {
      const quote = (
        await f.good(null, "/website/quote", "POST", {
          items: [
            {
              service_id: service.id,
              quantity: 3,
              parameters: { height: 3.5, wall_material: "бетон" },
            },
          ],
        })
      ).quote;
      assert.equal(quote.minimum_total, 3000);
      assert.equal(quote.total, null);
      assert.equal(quote.items[0].parameters.height, 3.5);
      for (const items of [
        null,
        {},
        [{ service_id: service.id, quantity: -1 }],
        [{ service_id: service.id, quantity: 1, unit_price: 1 }],
        [{ service_id: "unknown", quantity: 1 }],
      ])
        assert.ok(
          [400, 409].includes(
            (await f.request(null, "/website/quote", "POST", { items })).status,
          ),
        );
    },
  );
  await t.test(
    "website order authenticates once, creates native row, source, intake date and attribution",
    async () => {
      alice = await f.login("+79995552001");
      bob = await f.login("+79995552002");
      const p = {
        request_id: randomUUID(),
        name: "Тестовый клиент",
        address: "Тестовая улица, 1",
        description: "Замена крана",
        desired_date: "2026-12-01",
        desired_interval: "10:00–13:00",
        items: [
          { service_id: service.id, quantity: 2, parameters: { height: 2.5 } },
        ],
        utm: { utm_source: "qa", utm_campaign: "website" },
      };
      assert.equal(
        (await f.request(null, "/website/orders", "POST", p)).status,
        401,
      );
      order = (await f.good(alice, "/website/orders", "POST", p)).order;
      const again = await f.good(alice, "/website/orders", "POST", p);
      assert.equal(again.order.id, order.id);
      assert.equal(again.idempotent, true);
      assert.equal(
        (
          await f.request(alice, "/website/orders", "POST", {
            ...p,
            address: "Другой адрес",
          })
        ).status,
        409,
      );
      const row = (
        await f.db.query("select * from orders where id=$1", [order.id])
      ).rows[0];
      assert.equal(row.source, "website");
      assert.equal(row.external_source, "website");
      assert.equal(row.status, "В работе");
      assert.ok(row.received_date);
      assert.equal(row.work_items[0].quantity, 2);
      assert.match(row.work, /Высота: 2.5 м/);
      assert.equal(
        (
          await f.db.query(
            "select utm from website_order_attribution where order_id=$1",
            [order.id],
          )
        ).rows[0].utm.utm_source,
        "qa",
      );
      assert.ok(
        (await f.good(f.dispatcher, "/staff/orders")).orders.some(
          (o) => o.id === order.id,
        ),
      );
    },
  );
  await t.test(
    "IDOR, CSRF, file ownership and anonymous table boundaries hold",
    async () => {
      assert.equal((await f.request(bob, "/orders/" + order.id)).status, 404);
      assert.equal(
        (
          await f.request(
            { cookie: alice.cookie },
            "/website/business-leads",
            "POST",
            {},
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await f.request(
            alice,
            "/website/business-leads",
            "POST",
            {},
            { Origin: "https://attacker.invalid" },
          )
        ).status,
        403,
      );
      const file = (
        await f.good(alice, "/orders/" + order.id + "/attachments", "POST", {
          request_id: randomUUID(),
          name: "test.png",
          mime: "image/png",
          data_base64: PNG,
        })
      ).attachment;
      assert.equal(
        (await f.request(bob, "/attachments/" + file.id)).status,
        404,
      );
      assert.equal(
        (await f.request(null, "/attachments/" + file.id)).status,
        401,
      );
      assert.equal(
        (await f.request(alice, "/attachments/" + file.id)).status,
        200,
      );
      for (const role of ["anon", "authenticated"])
        for (const table of [
          "website_service_pages",
          "website_business_leads",
          "website_order_attribution",
          "website_reviews",
          "website_staff_events",
        ]) {
          assert.equal(
            (
              await f.db.query(
                "select relrowsecurity from pg_class where relname=$1",
                [table],
              )
            ).rows[0].relrowsecurity,
            true,
          );
          await assert.rejects(() =>
            f.db.transaction(async (d) => {
              await d.exec("set local role " + role);
              await d.query("select * from " + table);
            }),
          );
          const rollback = Error("test-only rollback");
          await assert.rejects(
            () =>
              f.db.transaction(async (d) => {
                await d.exec("grant select on " + table + " to " + role);
                await d.exec("set local role " + role);
                assert.equal(
                  Number(
                    (await d.query("select count(*) as n from " + table))
                      .rows[0].n,
                  ),
                  0,
                );
                throw rollback;
              }),
            (e) => e === rollback,
          );
        }
    },
  );
  await t.test(
    "assignment, verified public phone, visit and client estimate use one order",
    async () => {
      await f.good(
        f.owner,
        "/staff/website/masters/" + f.staffIds.master + "/phone",
        "PATCH",
        { phone: "+79990000004" },
      );
      order = (
        await f.good(f.dispatcher, "/staff/orders/" + order.id, "PATCH", {
          version: order.version,
          master_staff_id: f.staffIds.master,
          visit: { date: "2026-12-01", time: "11:00", interval: "11:00–13:00" },
        })
      ).order;
      assert.equal(order.master.phone, "+79990000004");
      assert.equal(order.visit.time, "11:00");
      order = (
        await f.good(
          f.dispatcher,
          "/staff/orders/" + order.id + "/estimates",
          "POST",
          {
            version: order.version,
            items: [
              {
                name: "Замена крана",
                unit: "шт.",
                quantity: 2,
                unit_price: 1100,
              },
              {
                name: "Дополнительная работа",
                unit: "шт.",
                quantity: 1,
                unit_price: 200,
              },
            ],
            conditions: "Уточнённый объём",
          },
        )
      ).order;
      assert.equal(order.estimate.total, 2400);
      assert.equal(order.estimate.accepted_at, null);
      order = (
        await f.good(
          alice,
          "/orders/" + order.id + "/estimate/accept",
          "POST",
          { version: order.estimate.version },
        )
      ).order;
      assert.ok(order.estimate.accepted_at);
      await f.good(f.dispatcher, "/staff/messages", "POST", {
        request_id: randomUUID(),
        order_id: order.id,
        body: "Время согласовано",
      });
      assert.equal(
        (await f.good(alice, "/messages?order_id=" + order.id)).messages[0]
          .body,
        "Время согласовано",
      );
      assert.equal(Object.hasOwn(order, "master_payout"), false);
    },
  );
  await t.test(
    "real staff report completion, act, review and claim never reaccrue paid work",
    async () => {
      const call = async (slug, body, role) => {
        const r = await f.edgeHandlers[slug](body, "", f.signStaff(role));
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.ok, true, JSON.stringify(r.body));
        return r.body;
      };
      await call(
        "master-workflow-api",
        { action: "setStage", id: order.id, stage: "departed" },
        "master",
      );
      assert.equal(
        (await f.good(alice, "/orders/" + order.id)).order.status,
        "on_way",
      );
      await call(
        "master-workflow-api",
        { action: "setStage", id: order.id, stage: "started" },
        "master",
      );
      assert.equal(
        (await f.good(alice, "/orders/" + order.id)).order.status,
        "in_progress",
      );
      const report = await call(
        "report-api",
        {
          action: "uploadMasterReport",
          order_id: order.id,
          upload_token: randomUUID(),
          act_name: "act.png",
          act_mime: "image/png",
          act_data: PNG,
          photos_json: JSON.stringify([
            { name: "photo.png", mime: "image/png", data: PNG },
          ]),
        },
        "master",
      );
      // Read the saved report through the client API before staff accepts it.
      // A new read must leave the completed work awaiting confirmation, not in progress.
      for (let read = 0; read < 2; read++) {
        const pending = (await f.good(alice, "/orders/" + order.id)).order;
        assert.equal(pending.status, "awaiting_confirmation");
        assert.equal(pending.status_label, "Ожидается подтверждение");
      }
      const pendingList = (await f.good(alice, "/orders")).orders;
      assert.equal(
        pendingList.find((entry) => entry.id === order.id).status,
        "awaiting_confirmation",
      );
      await call(
        "order-lifecycle-api",
        {
          action: "reviewReport",
          id: order.id,
          decision: "approved",
          expected_report_token: report.order.report_upload_token,
          expected_report_uploaded_at: report.order.report_uploaded_at,
        },
        "dispatcher",
      );
      order = (await f.good(alice, "/orders/" + order.id)).order;
      assert.equal(order.status, "completed");
      assert.equal(order.act_available, true);
      assert.equal(
        (await f.request(alice, "/website/orders/" + order.id + "/act")).status,
        200,
      );
      assert.equal(
        (await f.request(bob, "/website/orders/" + order.id + "/act")).status,
        404,
      );
      const before = (
          await f.db.query(
            "select amount,master_payout,status,work_items from orders where id=$1",
            [order.id],
          )
        ).rows[0],
        count = (await f.db.query("select count(*) as n from orders")).rows[0]
          .n;
      await f.good(alice, "/website/orders/" + order.id + "/review", "POST", {
        rating: 5,
        body: "Тестовый отзыв",
        public_name: "Тестовый клиент",
        publication_consent: true,
      });
      assert.equal((await f.good(null, "/website/reviews")).reviews.length, 0);
      await f.good(f.owner, "/staff/website/reviews/" + order.id, "PATCH", {
        published: true,
      });
      assert.equal((await f.good(null, "/website/reviews")).reviews.length, 1);
      await f.good(alice, "/orders/" + order.id + "/requests", "POST", {
        request_id: randomUUID(),
        type: "warranty",
        text: "Проверка гарантии",
        desired_interval: "После 15:00",
      });
      assert.deepEqual(
        (
          await f.db.query(
            "select amount,master_payout,status,work_items from orders where id=$1",
            [order.id],
          )
        ).rows[0],
        before,
      );
      assert.equal(
        (await f.db.query("select count(*) as n from orders")).rows[0].n,
        count,
      );
      assert.equal(
        (await f.good(alice, "/orders/" + order.id)).order.status_label,
        "Открыто гарантийное обращение",
      );
    },
  );
  await t.test(
    "B2B persists a separate lead, no work order, with an in-app staff event",
    async () => {
      const count = (await f.db.query("select count(*) as n from orders"))
        .rows[0].n;
      const p = {
        request_id: randomUUID(),
        company: "Тестовая компания",
        contact_name: "Тестовый контакт",
        email: "qa@example.invalid",
        description: "Работы в офисе",
        objects_count: 2,
        comment: "Тест",
        utm: { utm_source: "qa" },
      };
      const lead = (await f.good(alice, "/website/business-leads", "POST", p))
        .lead;
      assert.equal(
        (await f.good(alice, "/website/business-leads", "POST", p)).lead.id,
        lead.id,
      );
      assert.equal(
        (await f.db.query("select count(*) as n from orders")).rows[0].n,
        count,
      );
      assert.equal((await f.request(bob, "/staff/website/leads")).status, 401);
      const list = (await f.good(f.dispatcher, "/staff/website/leads")).leads;
      assert.equal(list[0].id, lead.id);
      assert.equal(list[0].utm.utm_source, "qa");
      assert.equal(
        (await f.good(f.dispatcher, "/staff/website/summary"))
          .new_business_leads,
        1,
      );
      await f.good(f.dispatcher, "/staff/website/leads/" + lead.id, "PATCH", {
        version: 1,
        status: "contacted",
      });
      assert.equal(
        (
          await f.db.query(
            "select count(*) as n from website_staff_events where lead_id=$1",
            [lead.id],
          )
        ).rows[0].n,
        2,
      );
    },
  );
  await t.test(
    "unknown services, unpublished cards and unapproved price mutations fail closed",
    async () => {
      const p = (await f.good(f.owner, "/staff/website/catalog")).pages.find(
        (p) => p.service_id === service.id,
      );
      await f.good(f.owner, "/staff/website/catalog/" + service.id, "PATCH", {
        version: p.version,
        published: false,
        approve_price: false,
        price_display_mode: "after_inspection",
      });
      assert.equal(
        (await f.good(null, "/website/catalog")).services.some(
          (s) => s.id === service.id,
        ),
        false,
      );
      assert.equal(
        (
          await f.request(null, "/website/quote", "POST", {
            items: [{ service_id: service.id, quantity: 1 }],
          })
        ).status,
        409,
      );
    },
  );
});
