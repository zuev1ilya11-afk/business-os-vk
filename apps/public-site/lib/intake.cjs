"use strict";
const { version } = require("./intake-terms.json");
const { isIP } = require("node:net");
const SQL = "select hm_site_private.submit($1, $2, $3, $4, $5, $6) as result";
const messages = {
  invalid: [400, "Проверьте имя, российский номер телефона, описание и согласие."],
  conflict: [409, "Предыдущая версия обращения уже отправлена. Свяжитесь с диспетчером для уточнения."],
  limited: [429, "Слишком много обращений. Повторите позже или позвоните диспетчеру."],
};
function fields(body) {
  if (!body || typeof body !== "object" || body.consent !== true || body.version !== version) return null;
  const { id, name, phone, description, kind } = body;
  if (typeof id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)
    || typeof phone !== "string" || !/^[+\d\s()-]{10,30}$/.test(phone)
    || typeof name !== "string" || !name.trim() || name.trim().length > 100
    || typeof description !== "string" || description.trim().length < 3 || description.trim().length > 1200
    || !["home", "business"].includes(kind)) return null;
  const digits = phone.replace(/\D/g, "");
  if (!/^(?:[78]\d{10}|\d{10})$/.test(digits)) return null;
  return [id, name.trim(), "+7" + digits.slice(-10), description.trim(), kind, version];
}
async function connectDatabase(url) {
  const address = new URL(url);
  if (!["postgres:", "postgresql:"].includes(address.protocol) || address.username !== "hm_site_intake"
    || !["127.0.0.1", "localhost", "[::1]"].includes(address.hostname) || address.search)
    throw Error("Use the dedicated hm_site_intake login on the local PostgreSQL listener");
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 3500, statement_timeout: 5000 });
  pool.on("error", () => console.warn("site_intake_connection_interrupted"));
  try {
    const { rows } = await pool.query("select current_user = 'hm_site_intake' and has_function_privilege(current_user, 'hm_site_private.submit(uuid,text,text,text,text,text)', 'EXECUTE') as ready");
    if (!rows[0]?.ready) throw Error("Intake function unavailable");
    return pool;
  } catch {
    await pool.end();
    throw Error("Cannot verify the dedicated Business OS intake connection");
  }
}
function handler(db, origin, behindCaddy) {
  const attempts = new Map();
  return async (req, res) => {
    const reply = (status, data) => {
      res.writeHead(status, { "content-type":"application/json;charset=utf-8", "cache-control":"no-store", "x-content-type-options":"nosniff" });
      res.end(JSON.stringify(data));
    };
    if (req.method !== "POST") return reply(405, { error:"Используйте форму обращения." });
    if (!db) return reply(503, { error:"Онлайн-приём временно недоступен. Позвоните диспетчеру." });
    if (req.headers.origin !== origin) return reply(403, { error:"Откройте форму на сайте компании." });
    if (req.headers["content-type"]?.split(";")[0] !== "application/json") return reply(415, { error:"Неверный формат." });
    const forwarded = String(req.headers["x-forwarded-for"] || "").split(",").at(-1).trim();
    const ip = behindCaddy && isIP(forwarded) ? forwarded : req.socket.remoteAddress;
    const now = Date.now();
    for (const [key, window] of attempts) if (window.until <= now) attempts.delete(key);
    const window = attempts.get(ip) || { count: 0, until: now + 60000 };
    if (window.count >= 12 || (!attempts.has(ip) && attempts.size >= 4096)) return reply(429, { error:messages.limited[1] });
    window.count++;
    attempts.set(ip, window);
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 10000) return reply(413, { error:"Сократите описание задачи." });
      chunks.push(chunk);
    }
    let data;
    try { data = fields(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { /* Bad JSON. */ }
    if (!data) return reply(400, { error:messages.invalid[1] });
    try {
      const { rows } = await db.query(SQL, data);
      if (rows[0]?.result === "accepted") return reply(201, { accepted:true });
      const [code, message] = messages[rows[0]?.result] || [503, "Попробуйте ещё раз или позвоните диспетчеру."];
      return reply(code, { error:message });
    } catch {
      return reply(503, { error:"Не удалось подтвердить отправку. Повторите попытку или позвоните диспетчеру." });
    }
  };
}
module.exports = { handler, connectDatabase };
