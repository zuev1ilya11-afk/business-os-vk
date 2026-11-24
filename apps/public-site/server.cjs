"use strict";
const http = require("node:http"),
  path = require("node:path"),
  fs = require("node:fs/promises"),
  crypto = require("node:crypto");
const appDir = __dirname,
  root = path.resolve(appDir, "../..");
async function start() {
  const args = process.argv.slice(2),
    arg = (key, fallback) => {
      const i = args.indexOf(key);
      return i < 0 ? fallback : args[i + 1];
    };
  const port = Number(arg("--port", process.env.PORT || 4173)),
    host = arg("--host", process.env.HOST || "127.0.0.1");
  const managed =
    process.cwd() === "/site" && host === "0.0.0.0" && port === 4173;
  const environment = process.env.WEBSITE_ENV || "staging";
  if (!["staging", "production"].includes(environment))
    throw Error("Explicit website environment required");
  if (host === "0.0.0.0" && !managed && process.env.WEBSITE_CONTAINER !== "1")
    throw Error("Public binding requires an explicit container");
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error("Invalid port");
  const origin = managed
    ? "http://terminal.local:4173"
    : process.env.WEBSITE_STAGING_ORIGIN || `http://127.0.0.1:${port}`;
  const stagingHttpsOrigin = process.env.WEBSITE_STAGING_HTTPS_ORIGIN || "";
  if (
    stagingHttpsOrigin &&
    (environment !== "staging" ||
      process.env.WEBSITE_CONTAINER !== "1" ||
      managed ||
      stagingHttpsOrigin !== origin)
  )
    throw Error(
      "HTTPS preview requires an explicit staging container and matching origin",
    );
  const booking = process.env.NEXT_PUBLIC_BOOKING_MODE || "online";
  const informationOnly = process.env.WEBSITE_INFORMATION_ONLY === "1";
  if (informationOnly && (environment !== "production" || booking !== "phone"))
    throw Error("Information-only website requires production phone mode");
  if (
    !["phone", "online"].includes(booking) ||
    (environment === "staging" && booking !== "online")
  )
    throw Error("Unknown website booking mode");
  let stage;
  if (environment === "staging") {
    const state = process.env.WEBSITE_STAGE_STATE
      ? path.resolve(process.env.WEBSITE_STAGE_STATE)
      : path.join(root, ".public-site-stage");
    stage =
      await require("../../client-portal/staging/integrated.cjs").createIntegratedStaging(
        {
          dataDir: path.join(state, "db"),
          privateDir: path.join(state, "private"),
          origin,
          stagingHttpsOrigin,
          websiteEnabled: true,
        },
      );
    process.env.WEBSITE_INTERNAL_API_ORIGIN = `http://127.0.0.1:${port}`;
  } else {
    const publicOrigin = new URL(process.env.NEXT_PUBLIC_SITE_URL || "");
    if (
      publicOrigin.protocol !== "https:" ||
      publicOrigin.pathname !== "/" ||
      publicOrigin.username ||
      publicOrigin.search ||
      publicOrigin.hash ||
      publicOrigin.password ||
      (booking === "online" && !process.env.WEBSITE_INTERNAL_API_ORIGIN)
    )
      throw Error(
        "HTTPS site URL required; online orders also need the customer API",
      );
    // Customer requests are proxied by nginx, never by a generic user-selected URL.
  }
  const intake = require("./lib/intake.cjs");
  let callbackDb;
  if (stage) {
    await stage.db.exec(await fs.readFile(path.join(appDir, "lib/site-intake.sql"), "utf8"));
    callbackDb = stage.db;
  } else if (!informationOnly && process.env.WEBSITE_INTAKE_DATABASE_URL) {
    callbackDb = await intake.connectDatabase(process.env.WEBSITE_INTAKE_DATABASE_URL);
  }
  process.env.WEBSITE_CALLBACK_READY = callbackDb ? "1" : "0";
  const callback = intake.handler(callbackDb, stage ? origin : new URL(process.env.NEXT_PUBLIC_SITE_URL).origin,
    !stage && host === "127.0.0.1");
  const next = require("next");
  const app = next({
    dev: process.env.NODE_ENV !== "production",
    dir: appDir,
    hostname: managed ? "terminal.local" : host,
    port,
  });
  await app.prepare();
  const nextHandler = app.getRequestHandler();
  const staffAssets = new Set(
    (stage ? await fs.readdir(root) : []).filter((f) =>
      /^[\w-][\w.-]*\.(js|css|svg|png|ico|webmanifest)$/.test(f),
    ),
  );
  const portalDir = path.join(appDir, "public/client");
  const portalFiles = new Map([
    ["index.html", "text/html;charset=utf-8"],
    ["app.js", "text/javascript;charset=utf-8"],
    ["styles.css", "text/css"],
    ["sw.js", "text/javascript;charset=utf-8"],
    ["manifest.webmanifest", "application/manifest+json"],
    ["icon.svg", "image/svg+xml"],
    ["icon-192.png", "image/png"],
    ["icon-512.png", "image/png"],
  ]);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin),
        p = url.pathname;
      if (informationOnly && (p === "/api/callback" || p.startsWith("/api/callback/"))) {
        res.writeHead(404, { "cache-control": "no-store" }).end();
        return;
      }
      if (p === "/api/callback") {
        await callback(req, res);
        return;
      }
      if (stage && p === "/qa/mobile") {
        res.setHeader("content-type", "text/html;charset=utf-8");
        res.setHeader("cache-control", "no-store");
        res.setHeader("x-robots-tag", "noindex, nofollow");
        res.end(
          '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Проверка сайта · 360 px</title><style>body{margin:0;background:#e8ece7;font:14px system-ui;display:grid;justify-content:center}p{margin:10px 0}iframe{width:360px;height:800px;border:1px solid #c8d3c5;background:#fff}</style><p>Изолированная проверка · 360 × 800</p><iframe title="Сайт на экране 360 пикселей" src="/"></iframe></html>',
        );
        return;
      }
      if (p === "/healthz") {
        res.setHeader("content-type", "application/json");
        res.setHeader("cache-control", "no-store");
        res.end(
          JSON.stringify({
            ok: true,
            service: "public-site",
            environment,
            booking,
            callback: Boolean(callbackDb),
            ...(informationOnly ? { informationOnly: true } : {}),
          }),
        );
        return;
      }
      if (p === "/robots.txt") {
        res.setHeader("content-type", "text/plain");
        res.end(
          environment === "production"
            ? `User-agent: *\nDisallow: /client/\nDisallow: /client-api/\nDisallow: /order\nDisallow: /request\nDisallow: /search\nDisallow: /login\nDisallow: /staff/\nDisallow: /maintenance\nDisallow: /500\nSitemap: ${process.env.NEXT_PUBLIC_SITE_URL}/sitemap.xml\n`
            : "User-agent: *\nDisallow: /\n",
        );
        return;
      }
      if (p === "/sitemap.xml") {
        const base = process.env.NEXT_PUBLIC_SITE_URL;
        let paths = [
          "/",
          "/services",
          "/facades",
          "/quality",
          "/careers",
          "/documents",
          "/feedback",
          "/business",
          "/how-it-works",
          "/guarantee",
          "/areas",
          "/articles",
          "/contacts",
          "/faq",
          "/privacy",
        ];
        const services = require("./lib/phone-catalog.cjs");
        for (const s of services) {
          paths.push(
            "/services/" + s.slug,
            "/categories/" + s.category_slug,
            "/categories/" + s.category_slug + "/" + s.subcategory_slug,
          );
        }
        // Pages and sitemap consume the same structured publication metadata.
        const articles = require("./lib/content-data.json");
        for (const article of articles)
          if (article.published) paths.push("/articles/" + article.slug);
        res.setHeader("content-type", "application/xml");
        res.setHeader("cache-control", "public, max-age=60");
        res.end(
          '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
            (base
              ? [...new Set(paths)]
                  .map(
                    (p) =>
                      "<url><loc>" +
                      new URL(p, base).href
                        .replaceAll("&", "&amp;")
                        .replaceAll("<", "&lt;") +
                      "</loc></url>",
                  )
                  .join("")
              : "") +
            "</urlset>",
        );
        return;
      }
      if (
        stage &&
        (p.startsWith("/client-api/") ||
          p.startsWith("/client/") ||
          p.startsWith("/staff/") ||
          p.startsWith("/stage-api/") ||
          p.startsWith("/storage/v1/object/sign/") ||
          p === "/stage-bootstrap.js" ||
          p === "/stage-archive-info" ||
          staffAssets.has(p.slice(1)) ||
          p.startsWith("/assets/") ||
          p.startsWith("/vendor/") ||
          p.startsWith("/icons/"))
      ) {
        const parts = [];
        let n = 0;
        for await (const part of req) {
          n += part.length;
          if (n > 23 * 1024 * 1024) {
            res.statusCode = 413;
            res.end("Too large");
            return;
          }
          parts.push(part);
        }
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers))
          if (v !== undefined)
            headers.set(k, Array.isArray(v) ? v.join(",") : v);
        headers.delete("x-real-ip");
        headers.delete("x-forwarded-for");
        const request = new Request(origin + req.url, {
          method: req.method,
          headers,
          ...(!["GET", "HEAD"].includes(req.method)
            ? { body: Buffer.concat(parts) }
            : {}),
        });
        request.portalClientIp = req.socket.remoteAddress;
        const response = await stage.handle(request);
        res.statusCode = response.status;
        for (const [k, v] of response.headers)
          if (k !== "set-cookie") res.setHeader(k, v);
        const cookies = response.headers.getSetCookie();
        if (cookies.length) res.setHeader("set-cookie", cookies);
        res.setHeader("x-robots-tag", "noindex, nofollow");
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      if (!stage && (p === "/client" || p.startsWith("/client/"))) {
        res.setHeader("cache-control", "no-store");
        res.setHeader("x-robots-tag", "noindex, nofollow");
        if (booking === "phone" || p === "/client") {
          res.writeHead(302, {
            Location: booking === "phone" ? "/contacts" : "/client/",
          });
          res.end();
          return;
        }
        const file = p.slice("/client/".length) || "index.html";
        const type = portalFiles.get(file);
        if (!type || !["GET", "HEAD"].includes(req.method)) {
          res.writeHead(404).end();
          return;
        }
        const body = await fs.readFile(path.join(portalDir, file));
        res.setHeader(
          "content-security-policy",
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        );
        res.setHeader("x-content-type-options", "nosniff");
        res.setHeader("content-type", type);
        res.end(req.method === "HEAD" ? undefined : body);
        return;
      }
      if (
        !stage &&
        (p === "/client-api" ||
          p.startsWith("/client-api/") ||
          p === "/staff" ||
          p.startsWith("/staff/") ||
          p.startsWith("/stage-api/"))
      ) {
        res.writeHead(404, { "cache-control": "no-store" }).end();
        return;
      }
      const nonce = crypto.randomBytes(18).toString("base64");
      req.headers["x-csp-nonce"] = nonce;
      res.setHeader(
        "content-security-policy",
        `default-src 'self'; script-src 'self' 'nonce-${nonce}'${process.env.NODE_ENV !== "production" ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'`,
      );
      res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
      res.setHeader("x-content-type-options", "nosniff");
      res.setHeader(
        "permissions-policy",
        "camera=(), microphone=(), geolocation=()",
      );
      if (environment !== "production")
        res.setHeader("x-robots-tag", "noindex, nofollow");
      await nextHandler(req, res);
    } catch {
      if (!res.headersSent) {
        res.statusCode = 503;
        res.setHeader("cache-control", "no-store");
        res.setHeader("content-type", "text/plain;charset=utf-8");
      }
      res.end("Сервис временно недоступен. Повторите позже.");
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  process.stdout.write(`Public website ready (${environment}, ${booking})\n`);
  const stop = () =>
    server.close(async () => {
      if (!stage && callbackDb) await callbackDb.end();
      await stage?.close();
      await app.close();
      process.exit(0);
    });
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  return { server, stage };
}
if (require.main === module)
  start().catch((e) => {
    console.error("Website startup refused:", e.message);
    process.exitCode = 1;
  });
module.exports = { start };
