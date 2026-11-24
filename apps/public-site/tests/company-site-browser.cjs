"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("@playwright/test");
const origin = process.env.COMPANY_PREVIEW_ORIGIN || "http://127.0.0.1:4173";
const screens = process.env.COMPANY_PREVIEW_DIR || "company-preview";
(async () => {
  await fs.mkdir(screens, {recursive: true});
  const browser = await chromium.launch({headless: true});
  try {
    for (const route of ["/order", "/request?kind=business", "/login"]) {
      const res = await fetch(origin + route, {redirect:"manual"});
      assert.equal(res.status, 307, route + " must redirect");
      assert.equal(new URL(res.headers.get("location"), origin).pathname, "/contacts");
    }
    for (const width of [1440, 768, 390, 360]) {
      const page = await browser.newPage({viewport: {width, height: 900}, deviceScaleFactor: 1});
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      for (const route of ["/", "/services", "/categories/curtains", "/services/ustanovka-karniza", "/business", "/contacts", "/privacy", "/articles/podgotovit-zayavku", "/faq"]) {
        const res = await page.goto(origin + route, {waitUntil: "networkidle"});
        assert.equal(res.status(), 200, route);
        assert.equal(await page.locator("h1").count(), 1, route + " h1");
        assert.equal(await page.locator("form, input, textarea").count(), 0, route + " intake controls");
        assert.equal(await page.locator('a[href^="/request"], a[href^="/order"], a[href^="/client/"]').count(), 0, route + " hidden booking");
        assert.ok(await page.locator('a[href="tel:+79816849719"]').count(), route + " telephone");
        assert.ok(await page.locator('a[href="mailto:home_master92@mail.ru"]').count(), route + " mail");
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), width + "px overflow: " + route);
        await page.evaluate(async () => {
          const photos = [...document.querySelectorAll("img")];
          for (const img of photos) img.loading = "eager";
          await Promise.all(photos.map(img => img.decode().catch(() => {})));
        });
        assert.equal(await page.locator(".hm-photo-fallback").count(), 0, route + " local photo fallback");
        assert.ok(await page.locator("img").evaluateAll(imgs => imgs.every(img => img.naturalWidth > 0)), route + " broken image");
        if (route === "/") {
          const grid = page.locator(".hm-gallery-card");
          assert.equal(await grid.count(), 6);
          await page.getByRole("button", {name:"Сантехника",exact:true}).click();
          assert.equal(await grid.count(), 3);
          await grid.first().click();
          assert.equal(await page.locator(".hm-gallery-detail").count(), 1);
          await page.getByRole("button", {name:"Закрыть подробности"}).click();
          assert.equal(await page.locator(".hm-gallery-detail").count(), 0);
          await page.getByRole("button", {name:"Бытовая техника",exact:true}).click();
          assert.equal(await grid.count(), 1);
          await page.getByRole("button", {name:"Прочие",exact:true}).click();
          assert.equal(await grid.count(), 4);
          await page.getByRole("button", {name:"Все",exact:true}).click();
          await page.getByRole("button", {name:"Показать ещё работы"}).click();
          assert.equal(await grid.count(), 10);
          await page.getByRole("button", {name:"Свернуть",exact:true}).click();
          assert.equal(await grid.count(), 6);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "gallery overflow");
        }
        if (route === "/" || route === "/contacts") {
          await page.screenshot({path: screens + "/" + (route === "/" ? "home" : "contacts") + "-" + width + ".png", fullPage: true});
        }
      }
      assert.deepEqual(errors, [], width + "px client errors");
      await page.close();
    }
    console.log("Information site: page and redirect checks passed at 1440, 768, 390 and 360px");
  } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode=1;});
