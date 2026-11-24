"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("@playwright/test");
const origin = process.env.COMPANY_PREVIEW_ORIGIN || "http://127.0.0.1:4173";
const screens = process.env.COMPANY_PREVIEW_DIR || "company-preview";
const expectPhone = process.env.COMPANY_EXPECT_PHONE !== "0";
(async () => {
  await fs.mkdir(screens, {recursive: true});
  const browser = await chromium.launch({headless: true});
  try {
    for (const route of ["/order", "/request?kind=business", "/login"]) {
      const res = await fetch(origin + route, {redirect:"manual"});
      assert.equal(res.status, 307, route + " must redirect");
      assert.equal(new URL(res.headers.get("location"), origin).pathname, "/contacts");
    }
    const proposal = await fetch(origin + "/company-proposal.pdf");
    assert.equal(proposal.status, 200);
    assert.ok(Buffer.from(await proposal.arrayBuffer()).subarray(0,5).toString() === "%PDF-", "proposal PDF");
    for (const width of [1440, 768, 390, 360]) {
      const page = await browser.newPage({viewport: {width, height: 900}, deviceScaleFactor: 1});
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      for (const route of ["/", "/services", "/categories/curtains", "/services/ustanovka-karniza", "/facades", "/how-it-works", "/business", "/quality", "/careers", "/documents", "/feedback", "/contacts", "/privacy", "/articles/podgotovit-zayavku", "/articles/mokryy-ili-ventiliruemyy-fasad", "/articles/podklyuchenie-tehniki-podgotovka", "/faq"]) {
        const res = await page.goto(origin + route, {waitUntil: "networkidle"});
        assert.equal(res.status(), 200, route);
        assert.equal(await page.locator("h1").count(), 1, route + " h1");
        assert.equal(await page.locator("form, input, textarea").count(), 0, route + " intake controls");
        assert.equal(await page.locator('a[href^="/request"], a[href^="/order"], a[href^="/client/"]').count(), 0, route + " hidden booking");
        if (expectPhone) {
          assert.ok(await page.locator('a[href="tel:+79816849719"]').count(), route + " telephone");
        } else {
          assert.equal(await page.locator('a[href^="tel:"]').count(), 0, route + " no telephone links");
          const html = await page.content();
          assert.ok(!html.includes("684-97-19") && !html.includes("79816849719"), route + " no phone in HTML or metadata");
          assert.equal(await page.getByRole("link", {name:/Позвонить/}).count(), 0, route + " no call CTA");
        }
        assert.ok(await page.locator('a[href="mailto:home_master92@mail.ru"]').count(), route + " mail");
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), width + "px overflow: " + route);
        await page.evaluate(async () => {
          const photos = [...document.querySelectorAll("img")];
          for (const img of photos) img.loading = "eager";
          await Promise.all(photos.map(img => img.decode().catch(() => {})));
        });
        assert.equal(await page.locator(".hm-photo-fallback").count(), 0, route + " local photo fallback");
        assert.ok(await page.locator("img").evaluateAll(imgs => imgs.every(img => img.naturalWidth > 0)), route + " broken image");
        if (route === "/" || route === "/business") {
          assert.ok(await page.getByText("Лемана ПРО", {exact:true}).count(), route + " partner");
          assert.ok(await page.getByText("Петрович", {exact:true}).count(), route + " partner");
        }
        if (route === "/facades") {
          for (const heading of ["Мокрый фасад", "Вентилируемый фасад", "Утепление фасадов"])
            assert.equal(await page.getByRole("heading", {name:heading,exact:true}).count(), 1);
        }
        if (route === "/") {
          assert.equal(await page.locator(".hm-approved-service").count(), 6, "all household services");
          assert.equal(await page.locator(".hm-approved-service:visible").count(), 6, "all services visible");
          assert.ok(await page.locator(".hm-quality").count(), "quality section");
          assert.ok(await page.locator(".hm-useful").count(), "article preview");
          assert.ok(await page.locator(".hm-team").count(), "team section");
          assert.ok(await page.locator(".hm-hero-photo img").evaluate((img,w)=>img.naturalWidth >= (w <= 600 ? 800 : 1200), width), "new hero resolution");
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
        if (route === "/" || route === "/contacts" || route === "/facades" || route === "/how-it-works" || route === "/business") {
          await page.evaluate(async () => { const root=document.documentElement; root.style.scrollBehavior="auto"; window.scrollTo(0,0); for(let y=0;y<root.scrollHeight;y+=Math.max(400,innerHeight-80)){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,45));}window.scrollTo(0,0);root.style.removeProperty("scroll-behavior"); });
          await page.waitForTimeout(1000);
          await page.screenshot({path: screens + "/" + (route === "/" ? "home" : route.slice(1)) + "-" + width + ".png", fullPage: true});
        }
      }
      assert.deepEqual(errors, [], width + "px client errors");
      await page.close();
    }
    const reduced = await browser.newPage({viewport:{width:390,height:844},reducedMotion:"reduce"});
    await reduced.goto(origin + "/", {waitUntil:"networkidle"});
    assert.equal(await reduced.locator(".hm-approved-hero h1").evaluate(el=>getComputedStyle(el).animationName), "none");
    assert.equal(await reduced.locator(".hm-intro-motion").count(), 0);
    assert.equal(await reduced.locator(".hm-hero-photo img").evaluate(el=>getComputedStyle(el).transform), "none");
    await reduced.close();
    console.log("Information site: pages, local images, PDF, gallery, responsive layout and reduced motion checks passed.");
  } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode=1;});
