"use strict";
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const local = "http://127.0.0.1:4186";
async function check() {
  const health = await (await fetch(local + "/healthz")).json();
  assert.equal(health.booking, "phone");
  assert.equal(health.callback, true);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport:{ width:390, height:844 } });
    // Route the canonical HTTPS origin to the isolated container. No external requests.
    const origin = "https://site.homemaster.qd.je";
    await page.route("**/*", async route => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.origin !== origin) return route.abort();
      const response = await route.fetch({ url:local + url.pathname + url.search,
        headers:{ ...req.headers(), origin } });
      return route.fulfill({ response });
    });
    await page.goto(origin + "/");
    await page.locator(".hero-actions a").first().click();
    await page.getByLabel("Как к вам обращаться").fill("Тестовый клиент");
    await page.getByLabel("Телефон для связи").fill("+79990001122");
    await page.getByLabel("Что нужно сделать?").fill("Установить тестовый карниз");
    await page.getByRole("checkbox").check();
    const sent = page.waitForRequest(r => r.url().endsWith("/api/callback"));
    await page.getByRole("button", { name:"Отправить обращение" }).click();
    const body = (await sent).postDataJSON();
    await page.getByRole("heading", { name:"Обращение принято" }).waitFor();
    const again = await fetch(local + "/api/callback", { method:"POST",
      headers:{ Origin:origin, "Content-Type":"application/json" }, body:JSON.stringify(body) });
    assert.equal(again.status, 201);
  } finally { await browser.close(); }
}
check().catch(error => { console.error(error); process.exitCode = 1; });
