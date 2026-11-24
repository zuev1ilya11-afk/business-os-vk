"use strict";
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

async function check() {
  const port = Number(process.argv[2] || 4186);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error("Invalid local test port");
  const origin = "http://127.0.0.1:" + port;
  const health = await (await fetch(origin + "/healthz")).json();
  assert.equal(health.booking, "phone");
  const phone = 'a[href="tel:+79816849719"]';
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const width of [320, 360, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(origin);
      assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1);
      assert(await page.locator("header " + phone).isVisible());
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "Overflow at " + width,
      );
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".mobile-menu summary").click();
    await page
      .getByRole("navigation", { name: "Разделы сайта" })
      .getByText("Услуги", { exact: true })
      .click();
    assert.equal(await page.locator("a.service-card").count(), 10);
    await page.getByRole("search").getByRole("textbox").fill("течёт кран");
    await page.getByRole("button", { name: "Найти" }).click();
    assert.equal(await page.locator(".service-card").count(), 1);
    await page.locator(".service-card").click();
    assert.equal(
      await page
        .getByRole("link", { name: "Заказать по телефону" })
        .getAttribute("href"),
      "tel:+79816849719",
    );
    for (const path of ["/order", "/login", "/client/"]) {
      await page.goto(origin + path);
      assert.equal(new URL(page.url()).pathname, "/contacts");
    }
    await page.goto(origin + "/contacts");
    assert.equal(await page.locator('main a[href="mailto:home_master92@mail.ru"]').count(), 1);
    await page.locator('footer a[href="/privacy"]').click();
    assert(await page.getByRole("heading", { name: "Политика конфиденциальности" }).isVisible());
    assert(await page.locator("main").getByText(/ИП Шагалина И.Б./).count() > 0);
    await page.goto(origin + "/business");
    assert.equal(await page.locator("main form").count(), 0);
    assert(await page.locator("main " + phone).isVisible());
    assert.equal((await fetch(origin + "/client-api/session")).status, 404);
    const xml = await (await fetch(origin + "/sitemap.xml")).text();
    const urls = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(
      (match) => new URL(match[1]),
    );
    assert(urls.length > 30);
    for (const url of urls) {
      assert.equal(url.origin, "https://site.homemaster.qd.je");
      assert.equal(
        (await fetch(origin + url.pathname)).status,
        200,
        url.pathname,
      );
    }
    assert.deepEqual(errors, []);
    console.log(
      "Phone website passed at six widths and on all " +
        urls.length +
        " sitemap pages.",
    );
  } finally {
    await browser.close();
  }
}
check().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
