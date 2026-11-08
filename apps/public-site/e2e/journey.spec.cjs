const { test, expect } = require("@playwright/test");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  crypto = require("node:crypto");
const origin = "http://127.0.0.1:4191",
  root = path.resolve(__dirname, "../../.."),
  state = process.env.WEBSITE_E2E_STATE;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNQcLBQcLBggFAAEE4CYfopkxgAAAAASUVORK5CYII=",
  "base64",
);
const next = (page) =>
  page.getByRole("button", { name: "Продолжить →", exact: true }).click();
async function otpFromPrivateTestOutbox(phone) {
  for (let n = 0; n < 40; n++) {
    const names = await fs.readdir(path.join(state, "private/otp"));
    for (const name of names) {
      const v = JSON.parse(
        await fs.readFile(path.join(state, "private/otp", name), "utf8"),
      );
      if (v.phone === phone) return v.code;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error("Synthetic OTP missing");
}
async function staffToken(role = "dispatcher") {
  const c = JSON.parse(
    await fs.readFile(path.join(state, "private/access.json"), "utf8"),
  );
  const msg = "stage_" + role + "." + (Math.floor(Date.now() / 1000) + 3600);
  return (
    msg +
    "." +
    crypto.createHmac("sha256", c.secret).update(msg).digest("base64url")
  );
}
async function staffRequest(request, route, method = "GET", body) {
  const response = await request.fetch(origin + "/client-api/staff/" + route, {
    method,
    headers: { Origin: origin, "x-bos-session": await staffToken() },
    ...(body ? { data: body } : {}),
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}
async function edgeRequest(request, slug, body, role = "dispatcher") {
  const response = await request.post(origin + "/stage-api/" + slug, {
    headers: { Origin: origin, "x-bos-session": await staffToken(role) },
    data: body,
  });
  const result = await response.json();
  expect(
    response.ok(),
    slug + ": " + (result.error || response.status()),
  ).toBeTruthy();
  expect(result.ok).toBeTruthy();
  return result;
}
async function consents(page) {
  for (const checkbox of await page
    .locator(".consents input[type=checkbox]")
    .all())
    await checkbox.check();
}
async function noOverflow(page) {
  const check = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    path: location.pathname,
    overflow: [...document.querySelectorAll("body *")]
      .filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
      .slice(0, 8)
      .map((e) => ({
        tag: e.tagName,
        class: e.className,
        width: e.getBoundingClientRect().width,
      })),
  }));
  expect(check.scroll, JSON.stringify(check)).toBeLessThanOrEqual(check.width);
}

test("SSR search, multiple services, photo, OTP, dispatcher, master, estimate and cabinet chat", async ({
  page,
  request,
  browser,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  expect(
    (await request.get(origin + "/client-api/website/catalog")).status(),
  ).toBe(200);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Большие планы",
  );
  const html = await (
    await request.get(origin + "/services/zamena-smesitelya")
  ).text();
  expect(html).toContain("Замена смесителя");
  expect(html).toContain("application/ld+json");
  await page
    .getByLabel("Что нужно сделать?", { exact: true })
    .fill("течёт кран");
  await page.getByRole("button", { name: "Найти" }).click();
  await page
    .getByRole("link", {
      name: "Сантехника Замена смесителя После уточнения",
      exact: true,
    })
    .click();
  await page
    .getByRole("link", { name: "Оформить заявку ↗", exact: true })
    .click();
  await page
    .getByRole("checkbox", {
      name: "Замена розетки После уточнения",
      exact: true,
    })
    .check();
  await next(page);
  await page
    .getByRole("group", { name: "Замена смесителя", exact: true })
    .getByLabel("Количество, шт.", { exact: true })
    .fill("2");
  await page
    .getByLabel("Что нужно сделать?", { exact: true })
    .fill("Тест: два смесителя и розетка.");
  await page
    .locator("input[type=file]")
    .setInputFiles({ name: "test.png", mimeType: "image/png", buffer: png });
  await next(page);
  await page
    .getByLabel("Адрес *", { exact: true })
    .fill("Синтетическая улица, 1");
  await page.getByLabel("Желаемая дата *", { exact: true }).fill("2026-12-01");
  await page
    .getByRole("combobox", { name: "Время, МСК *", exact: true })
    .selectOption("13:00–16:00");
  await next(page);
  const phone = "+7999887" + String(crypto.randomInt(1000, 9999));
  await page.getByLabel("Ваше имя *", { exact: true }).fill("Тестовый клиент");
  await page.getByLabel("Телефон *", { exact: true }).fill(phone);
  await next(page);
  await expect(page.getByRole("heading", { name: "Всё верно?" })).toBeVisible();
  await expect(page.locator(".review")).toContainText("2 шт.");
  await consents(page);
  await page.getByRole("button", { name: "Получить код" }).click();
  await expect(
    page.getByRole("heading", { name: "Подтвердите телефон" }),
  ).toBeVisible();
  // Synthetic test-only code never leaves this process or enters logs / artifacts.
  await page
    .getByLabel("Код подтверждения", { exact: true })
    .fill(await otpFromPrivateTestOutbox(phone));
  await page.getByRole("button", { name: "Создать заявку" }).click();
  await expect(
    page.getByRole("heading", { name: "Заявка принята" }),
  ).toBeVisible();
  const href = await page
      .getByRole("link", { name: /Открыть мою заявку/ })
      .getAttribute("href"),
    id = href.split("/").at(-1);
  await page.getByRole("link", { name: /Открыть мою заявку/ }).click();
  await expect(
    page.getByRole("heading", { name: "Заявка № " + id, exact: true }),
  ).toBeVisible();
  await expect(page.locator("#order-attachments")).toContainText("test.webp");
  const orders = await staffRequest(request, "orders");
  let order = orders.orders.find((o) => o.id === id);
  expect(order).toBeTruthy();
  const masters = await staffRequest(request, "masters");
  order = (
    await staffRequest(request, "orders/" + id, "PATCH", {
      version: order.version,
      master_staff_id: masters.masters[0].id,
      visit: { date: "2026-12-01", time: "14:00", interval: "13:00–16:00" },
    })
  ).order;
  await page.getByRole("button", { name: "Обновить заявку" }).click();
  await expect(page.locator(".master-card")).toContainText("Алексей");
  await expect(page.locator(".details")).toContainText("13:00–16:00");
  order = (
    await staffRequest(request, "orders/" + id + "/estimates", "POST", {
      version: order.version,
      items: [
        {
          name: "Замена смесителя",
          unit: "шт.",
          quantity: 2,
          unit_price: 1000,
        },
        {
          name: "Дополнительная работа",
          unit: "шт.",
          quantity: 1,
          unit_price: 200,
        },
      ],
      conditions: "Тестовое согласование",
    })
  ).order;
  await page.getByRole("button", { name: "Обновить заявку" }).click();
  await page.getByRole("button", { name: /Согласовать/ }).click();
  await expect(
    page.getByText("Вы согласовали эту версию", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Сообщение компании" })
    .fill("Тестовое сообщение из браузера");
  await page.getByRole("button", { name: /Отправить/ }).click();
  await expect(page.getByRole("log")).toContainText(
    "Тестовое сообщение из браузера",
  );
  await staffRequest(request, "messages", "POST", {
    request_id: crypto.randomUUID(),
    order_id: id,
    body: "Тестовый ответ диспетчера",
  });
  await page.getByRole("button", { name: "Обновить заявку" }).click();
  await expect(page.getByRole("log")).toContainText(
    "Тестовый ответ диспетчера",
  );

  await page.screenshot({
    path: path.join(
      root,
      "docs/public-site/screenshots/client-order-browser.png",
    ),
    fullPage: true,
  });
  await edgeRequest(
    request,
    "master-workflow-api",
    { action: "setStage", id, stage: "departed" },
    "master",
  );
  await edgeRequest(
    request,
    "master-workflow-api",
    { action: "setStage", id, stage: "started" },
    "master",
  );
  const report = await edgeRequest(
    request,
    "report-api",
    {
      action: "uploadMasterReport",
      order_id: id,
      upload_token: crypto.randomUUID(),
      act_name: "act.png",
      act_mime: "image/png",
      act_data: png.toString("base64"),
      photos_json: JSON.stringify([
        { name: "photo.png", mime: "image/png", data: png.toString("base64") },
      ]),
    },
    "master",
  );
  await edgeRequest(request, "order-lifecycle-api", {
    action: "reviewReport",
    id,
    decision: "approved",
    expected_report_token: report.order.report_upload_token,
    expected_report_uploaded_at: report.order.report_uploaded_at,
  });
  await page.getByRole("button", { name: "Обновить заявку" }).click();
  await expect(
    page.getByRole("link", { name: "Открыть акт выполненных работ" }),
  ).toBeVisible();
  const act = await page.request.get(
    "/client-api/website/orders/" + id + "/act",
  );
  expect(act.status()).toBe(200);
  expect(act.headers()["content-type"]).toMatch(/^image\//);
  await page
    .getByLabel("Имя для отзыва", { exact: true })
    .fill("Тестовый клиент");
  await page
    .getByLabel("Ваш отзыв", { exact: true })
    .fill("Синтетический отзыв после завершения");
  await page
    .getByLabel("Разрешаю опубликовать отзыв и указанное имя на сайте", {
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Отправить отзыв", exact: true })
    .click();
  await expect(
    page.getByText(
      "Отзыв получен. Публикация возможна после проверки компанией.",
    ),
  ).toBeVisible();
  const beforeClaim = (await staffRequest(request, "orders")).orders;
  await page
    .getByRole("button", { name: "Помощь по работе", exact: true })
    .click();
  await page
    .getByLabel("Что нужно исправить? *", { exact: true })
    .fill("Тестовое гарантийное обращение");
  await page
    .getByRole("button", { name: "Отправить запрос", exact: true })
    .click();
  await expect(
    page.getByText("Открыто гарантийное обращение", { exact: true }),
  ).toBeVisible();
  const afterClaim = (await staffRequest(request, "orders")).orders;
  expect(afterClaim.length).toBe(beforeClaim.length);
  expect(afterClaim.find((o) => o.id === id).final_total).toBe(
    beforeClaim.find((o) => o.id === id).final_total,
  );
  await page.screenshot({
    path: path.join(
      root,
      "docs/public-site/screenshots/completed-warranty-browser.png",
    ),
    fullPage: true,
  });
  const foreign = await browser.newContext();
  const p = await foreign.newPage();
  await p.goto("/client/#order/" + id);
  await expect(p.getByText("Синтетическая улица, 1")).toHaveCount(0);
  await foreign.close();
  expect(errors).toEqual([]);
});

test("B2B form records a lead in staff queue", async ({ page, request }) => {
  await page.goto("/business");
  await page
    .getByLabel("Компания *", { exact: true })
    .fill("Синтетический офис");
  await page
    .getByLabel("Контактное лицо *", { exact: true })
    .fill("Тестовый контакт");
  const phone = "+7999886" + String(crypto.randomInt(1000, 9999));
  await page.getByLabel("Телефон *", { exact: true }).fill(phone);
  await page.getByLabel("Email", { exact: true }).fill("qa@example.invalid");
  await page.getByLabel("Количество объектов *", { exact: true }).fill("3");
  await page
    .getByLabel("Описание задачи *", { exact: true })
    .fill("Тестовая заявка на обслуживание офиса");
  await consents(page);
  await page.getByRole("button", { name: "Получить код" }).click();
  await expect(
    page.getByLabel("Код подтверждения", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Код подтверждения", { exact: true })
    .fill(await otpFromPrivateTestOutbox(phone));
  await page.getByRole("button", { name: "Отправить обращение" }).click();
  await expect(
    page.getByRole("heading", { name: "Обращение принято" }),
  ).toBeVisible();
  const list = await staffRequest(request, "website/leads");
  expect(
    list.leads.some(
      (l) =>
        l.phone === phone &&
        l.company === "Синтетический офис" &&
        l.objects_count === 3,
    ),
  ).toBeTruthy();
});

test("staff interface displays website business queue", async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(
    (token) => localStorage.setItem("bos_vk_session_v2", token),
    await staffToken("owner"),
  );
  const page = await context.newPage();
  await page.goto("/staff/");
  await page
    .getByRole("button", {
      name: "Кабинет клиента · сообщения и заявки",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Заявки бизнеса", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Обращения бизнеса с сайта",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText(/Новых обращений:/)).toBeVisible();
  await page.screenshot({
    path: path.join(
      root,
      "docs/public-site/screenshots/staff-business-browser.png",
    ),
    fullPage: true,
  });
  await context.close();
});

test("quick task requires description and survives offline state", async ({
  page,
  context,
}) => {
  await page.goto("/order?quick=1");
  await expect(
    page.getByRole("heading", { name: "Расскажите о задаче" }),
  ).toBeVisible();
  await next(page);
  await expect(
    page.getByRole("heading", { name: "Расскажите о задаче" }),
  ).toBeVisible();
  await page
    .getByLabel("Что нужно сделать? *", { exact: true })
    .fill("Не знаю, какая работа нужна");
  await context.setOffline(true);
  await expect(page.getByRole("status")).toContainText("Нет подключения");
  await expect(
    page.getByRole("button", { name: "Продолжить →", exact: true }),
  ).toBeDisabled();
  await context.setOffline(false);
  await next(page);
  await expect(
    page.getByRole("heading", { name: "Куда и когда приехать?" }),
  ).toBeVisible();
});

for (const width of [360, 390, 768, 1440])
  test("responsive and accessibility smoke " + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of [
      "/",
      "/services",
      "/services/zamena-smesitelya",
      "/order",
      "/business",
    ]) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await noOverflow(page);
      expect(await page.locator("img:not([alt])").count()).toBe(0);
      expect(await page.locator("main").count()).toBe(1);
      await page.keyboard.press("Tab");
      expect(
        await page.evaluate(() => document.activeElement !== document.body),
      ).toBeTruthy();
    }
    await page.goto("/");
    await page.screenshot({
      path: path.join(
        root,
        "docs/public-site/screenshots/home-" + width + ".png",
      ),
      fullPage: width === 390,
    });
    if (width === 1440)
      await page.screenshot({
        path: path.join(root, "docs/public-site/screenshots/home-desktop.jpg"),
      });
  });

test("404, staged robots, noindex and CSP", async ({ request, page }) => {
  expect((await request.get(origin + "/unknown-route")).status()).toBe(404);
  const r = await request.get(origin + "/");
  expect(r.headers()["content-security-policy"]).toContain("object-src 'none'");
  expect(await (await request.get(origin + "/robots.txt")).text()).toContain(
    "Disallow: /",
  );
  const sitemap = await request.get(origin + "/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  const xml = await sitemap.text();
  for (const article of require("../lib/content-data.json"))
    if (article.published)
      expect(xml).toContain(
        "https://website-stage.invalid/articles/" + article.slug,
      );
  await page.goto("/login");
  await expect(page.locator("meta[name=robots]")).toHaveAttribute(
    "content",
    "noindex,nofollow",
  );
});
