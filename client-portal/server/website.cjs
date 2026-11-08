"use strict";
const catalog = require("./website-catalog.cjs");
function createWebsite(h) {
  const {
    row,
    rows,
    fail,
    keys,
    str,
    integer,
    uuid,
    ok,
    idempotent,
    consume,
    config: c,
  } = h;
  async function service(d, s) {
    const page = await row(
      d,
      "select * from website_service_pages where service_id=$1",
      [s.id],
    );
    return page && page.published ? catalog.resolve(page, s) : null;
  }
  async function list(d, q = "") {
    const pages = await rows(
      d,
      "select p.*,c.id,c.unit,c.price_type,c.price,c.conditions,c.city,c.version as catalog_version from website_service_pages p join client_catalog c on c.id=p.service_id where p.published and c.published and c.available order by p.sort_order,p.slug",
    );
    const out = pages
      .map((p) =>
        catalog.resolve(p, {
          id: p.service_id,
          category: p.category,
          name: p.public_title,
          description: p.short_description,
          unit: p.unit,
          price_type: p.price_type,
          price: p.price,
          conditions: p.conditions,
          city: p.city,
          version: Number(p.catalog_version),
        }),
      )
      .filter(Boolean);
    if (!q) return out;
    const matches = await rows(
      d,
      "select service_id from website_service_pages where published and to_tsvector('russian',public_title || ' ' || short_description || ' ' || category) @@ plainto_tsquery('russian',$1)",
      [q],
    );
    const ids = new Set([
      ...matches.map((x) => x.service_id),
      ...catalog.search(out, q).map((x) => x.id),
    ]);
    return out.filter((x) => ids.has(x.id));
  }
  function utm(value = {}) {
    keys(value, [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
    ]);
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, str(v, 160)]),
    );
  }
  async function publicRoute(d, req, url, b) {
    const p = url.pathname;
    if (p === "/client-api/website/catalog" && req.method === "GET")
      return ok({
        services: await list(d, str(url.searchParams.get("q") || "", 200)),
        city: "Санкт-Петербург",
        timezone: "Europe/Moscow",
      });
    if (p === "/client-api/website/reviews" && req.method === "GET")
      return ok({
        reviews: await rows(
          d,
          "select rating,body,public_name,created_at from website_reviews where published and publication_consent order by created_at desc limit 12",
        ),
      });
    return null;
  }
  async function validateItems(d, items) {
    if (!Array.isArray(items) || items.length > 50)
      fail(400, "INVALID_ITEMS", "Выберите не более 50 услуг");
    for (const i of items || []) {
      if (!i || typeof i.service_id !== "string")
        fail(400, "INVALID_ITEMS", "Некорректная услуга");
      const p = await row(
        d,
        "select published from website_service_pages where service_id=$1",
        [i.service_id],
      );
      if (!p?.published)
        fail(409, "CATALOG_CHANGED", "Услуга недоступна на сайте");
    }
  }
  async function clientRoute(d, req, url, b, a) {
    const p = url.pathname;
    let m;
    if (p === "/client-api/website/business-leads" && req.method === "POST") {
      keys(b, [
        "request_id",
        "company",
        "contact_name",
        "email",
        "description",
        "objects_count",
        "comment",
        "utm",
      ]);
      return ok(
        await idempotent(d, a, "website-business-lead", b, async () => {
          await consume(d, "business-lead:" + a.id, 10, 86400);
          const email = str(b.email, 254);
          if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            fail(400, "INVALID_EMAIL", "Проверьте email");
          const lead = await row(
            d,
            "insert into website_business_leads(id,account_id,company,contact_name,phone,email,description,objects_count,comment,utm) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id,status,created_at",
            [
              uuid(),
              a.id,
              str(b.company, 200, true),
              str(b.contact_name, 120, true),
              a.phone,
              email,
              str(b.description, 5000, true),
              integer(b.objects_count, 1, 10000),
              str(b.comment, 2000),
              JSON.stringify(utm(b.utm)),
            ],
          );
          await d.query(
            "insert into website_staff_events(lead_id,kind) values($1,'business_lead_created')",
            [lead.id],
          );
          return { lead };
        }),
      );
    }
    if (
      (m = p.match(/^\/client-api\/website\/orders\/(\d+)\/review$/)) &&
      req.method === "POST"
    ) {
      keys(b, ["rating", "body", "public_name", "publication_consent"]);
      const o = await h.ownership(d, m[1], a, true);
      if (o.status !== "Выполнена")
        fail(409, "ORDER_NOT_COMPLETED", "Отзыв доступен после завершения");
      if (typeof b.publication_consent !== "boolean")
        fail(400, "CONSENT_REQUIRED", "Выберите, можно ли публиковать отзыв");
      const r = await row(
        d,
        "insert into website_reviews(order_id,account_id,rating,body,public_name,publication_consent) values($1,$2,$3,$4,$5,$6) on conflict(order_id) do nothing returning order_id",
        [
          o.id,
          a.id,
          integer(b.rating, 1, 5),
          str(b.body, 2000, true),
          str(b.public_name, 80, true),
          b.publication_consent,
        ],
      );
      if (!r) fail(409, "REVIEW_EXISTS", "Отзыв уже отправлен");
      return ok({ submitted: true, published: false });
    }
    if (
      (m = p.match(/^\/client-api\/website\/orders\/(\d+)\/act$/)) &&
      req.method === "GET"
    ) {
      const o = await h.ownership(d, m[1], a);
      if (o.status !== "Выполнена" || !o.report_act_url || !c.reportAssetReader)
        fail(404, "ACT_UNAVAILABLE", "Акт пока недоступен. Напишите компании.");
      const f = await c.reportAssetReader(o.report_act_url);
      if (!f) fail(404, "ACT_UNAVAILABLE", "Акт пока недоступен");
      return new Response(f.bytes, {
        headers: {
          "content-type": f.mime,
          "cache-control": "no-store, private",
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'none'; sandbox",
          "content-disposition": "inline",
        },
      });
    }
    return null;
  }
  async function staffRoute(d, req, url, b, a) {
    const p = url.pathname;
    let m;
    if (
      (m = p.match(
        /^\/client-api\/staff\/website\/masters\/([a-f0-9-]+)\/phone$/,
      )) &&
      req.method === "PATCH"
    ) {
      if (!["owner", "manager"].includes(a.role))
        fail(403, "FORBIDDEN", "Недостаточно прав");
      keys(b, ["phone"]);
      const v = str(b.phone, 12);
      if (v && !/^\+7[0-9]{10}$/.test(v))
        fail(400, "INVALID_PHONE", "Проверьте публичный номер");
      const r = await row(
        d,
        "update client_public_masters set public_phone=$1 where staff_id=$2 returning staff_id",
        [v, m[1]],
      );
      if (!r)
        fail(404, "NOT_FOUND", "Сначала создайте публичную карточку мастера");
      await d.query(
        "insert into website_staff_events(kind,staff_id,target_id) values('public_master_phone_updated',$1,$2)",
        [a.id, m[1]],
      );
      return ok({ saved: true });
    }
    if (p === "/client-api/staff/website/summary" && req.method === "GET") {
      const count = await row(
        d,
        "select count(*) as n from website_business_leads where status='new'",
      );
      return ok({ new_business_leads: Number(count.n) });
    }
    if (p === "/client-api/staff/website/leads" && req.method === "GET")
      return ok({
        leads: await rows(
          d,
          "select id,company,contact_name,phone,email,description,objects_count,comment,status,version,created_at,utm from website_business_leads order by created_at desc limit 100",
        ),
      });
    if (
      (m = p.match(/^\/client-api\/staff\/website\/leads\/([a-f0-9-]+)$/)) &&
      req.method === "PATCH"
    ) {
      keys(b, ["version", "status"]);
      if (!["new", "contacted", "closed"].includes(b.status))
        fail(400, "INVALID_STATUS", "Проверьте статус");
      const lead = await row(
        d,
        "update website_business_leads set status=$1,version=version+1,updated_at=now() where id=$2 and version=$3 returning id,status,version",
        [b.status, m[1], integer(b.version, 1, 1e9)],
      );
      if (!lead) fail(409, "VERSION_CONFLICT", "Лид изменился");
      await d.query(
        "insert into website_staff_events(lead_id,kind,staff_id) values($1,'business_lead_updated',$2)",
        [m[1], a.id],
      );
      return ok({ lead });
    }
    if (p === "/client-api/staff/website/catalog" && req.method === "GET") {
      if (!["owner", "manager"].includes(a.role))
        fail(403, "FORBIDDEN", "Недостаточно прав");
      return ok({
        pages: await rows(
          d,
          "select * from website_service_pages order by sort_order,slug",
        ),
      });
    }
    if (
      (m = p.match(
        /^\/client-api\/staff\/website\/catalog\/([a-zA-Z0-9_-]+)$/,
      )) &&
      req.method === "PATCH"
    ) {
      if (!["owner", "manager"].includes(a.role))
        fail(403, "FORBIDDEN", "Недостаточно прав");
      keys(b, ["version", "published", "approve_price", "price_display_mode"]);
      const page = await row(
        d,
        "select * from website_service_pages where service_id=$1 for update",
        [m[1]],
      );
      if (!page) fail(404, "NOT_FOUND", "Услуга не найдена");
      if (integer(b.version, 1, 1e9) !== page.version)
        fail(409, "VERSION_CONFLICT", "Публикация изменилась");
      if (
        typeof b.published !== "boolean" ||
        typeof b.approve_price !== "boolean" ||
        !["fixed", "range", "from", "after_inspection"].includes(
          b.price_display_mode,
        )
      )
        fail(400, "INVALID_PUBLICATION", "Проверьте настройки публикации");
      const approved = b.approve_price ? catalog.fingerprint(page) : null;
      const resolved = catalog.resolve(
        {
          ...page,
          price_display_mode: b.price_display_mode,
          approved_fingerprint: approved,
        },
        {},
      );
      if (
        b.approve_price &&
        b.price_display_mode !== "after_inspection" &&
        resolved?.price_display_mode === "after_inspection"
      )
        fail(400, "PRICE_NOT_APPROVABLE", "Нет подходящей цены в общем прайсе");
      await d.query(
        "update website_service_pages set published=$1,price_display_mode=$2,approved_fingerprint=$3,version=version+1,updated_at=now() where service_id=$4",
        [b.published, b.price_display_mode, approved, page.service_id],
      );
      await d.query(
        "insert into website_staff_events(kind,staff_id,target_id,details) values('catalog_publication_updated',$1,$2,$3)",
        [
          a.id,
          page.service_id,
          JSON.stringify({
            published: b.published,
            mode: b.price_display_mode,
            approved_fingerprint: approved,
          }),
        ],
      );
      return ok({ saved: true });
    }
    if (p === "/client-api/staff/website/reviews" && req.method === "GET")
      return ok({
        reviews: await rows(
          d,
          "select order_id,rating,body,public_name,publication_consent,published from website_reviews order by created_at desc limit 100",
        ),
      });
    if (
      (m = p.match(/^\/client-api\/staff\/website\/reviews\/(\d+)$/)) &&
      req.method === "PATCH"
    ) {
      if (!["owner", "manager"].includes(a.role))
        fail(403, "FORBIDDEN", "Недостаточно прав");
      keys(b, ["published"]);
      if (typeof b.published !== "boolean")
        fail(400, "INVALID_BODY", "Проверьте публикацию");
      const r = await row(
        d,
        "update website_reviews set published=$1,reviewed_by=$2 where order_id=$3 and (publication_consent or not $1) returning order_id",
        [b.published, a.id, m[1]],
      );
      if (!r) fail(409, "NO_CONSENT", "Нет согласия на публикацию");
      await d.query(
        "insert into website_staff_events(kind,staff_id,target_id,details) values('review_publication_updated',$1,$2,$3)",
        [a.id, m[1], JSON.stringify({ published: b.published })],
      );
      return ok({ saved: true });
    }
    return null;
  }
  return {
    service,
    list,
    utm,
    publicRoute,
    clientRoute,
    staffRoute,
    validateItems,
  };
}
module.exports = { createWebsite };
