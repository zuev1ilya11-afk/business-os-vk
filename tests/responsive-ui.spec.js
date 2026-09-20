const { test, expect } = require('@playwright/test');

const sizes = [[320, 700], [390, 844], [768, 1024], [1366, 768], [1920, 1080]];
const master = { id: 'ui-master', vk_user_id: 'ui-master', external_id: 'ui-master', full_name: 'Александр Тестовый Мастер', role: 'master', city: 'Москва', is_active: true };
const owner = { id: 'ui-owner', vk_user_id: 'ui-owner', full_name: 'Тестовый Владелец', role: 'owner', city: 'Москва', is_active: true };

async function mockApi(page, role) {
  if (role) await page.addInitScript(() => localStorage.setItem('bos_vk_session_v2', 'ui-fixture-session'));
  await page.route('https://unpkg.com/**', route => route.fulfill({ contentType: 'application/javascript', body: 'window.vkBridge={send:async()=>({})};' }));
  const handler = async route => {
    let body = {}; try { body = route.request().postDataJSON() || {}; } catch (_) {}
    const result = body.action === 'bootstrap' ? {
      ok: true, user: role === 'master' ? master : owner, users: [master], masters: [master],
      orders: [1, 2, 3].map(n => ({
        id: `UI-${n}`, status: 'В работе', client: 'Тестовый клиент',
        address: 'ОченьДлинныйАдресБезПробелов'.repeat(4), work: 'Монтаж карнизов и штор',
        comment: 'Длинный комментарий к заявке для проверки переноса текста. '.repeat(3),
        amount: 125000, master_payout: 69062.5, scheduled_date: '2099-09-10',
        scheduled_time: '10:00', master_vk_id: master.vk_user_id, master_name: master.full_name,
      })), masterSchedule: [], claims: [], sources: [{ source: 'VK' }], settings: {},
    } : { ok: true, claims: [], orders: [], masters: [] };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) });
  };
  await page.route('**/api/proxy/**', handler);
  await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/**', handler);
}

async function fits(page, label, testInfo) {
  // Check visible boxes as well as document width: overflow:hidden can mask clipping.
  const layout = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const outside = [...document.querySelectorAll('#content, #authGate .authGateCard, .modal, .modal input, .modal select, .modal textarea')]
      .filter(el => el.checkVisibility())
      .filter(el => { const r = el.getBoundingClientRect(); return r.left < -1 || r.right > width + 1; })
      .map(el => el.id || el.className || el.tagName);
    return { overflow: document.documentElement.scrollWidth - width, outside };
  });
  expect(layout, label).toEqual({ overflow: 0, outside: [] });
  await page.screenshot({ path: testInfo.outputPath(`${label}.png`), fullPage: true });
}

async function closeModal(page) {
  await page.locator('.modalClose').click();
  await expect(page.locator('.modal')).toHaveCount(0);
}

for (const [width, height] of sizes) {
  test(`login fits ${width}x${height}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await mockApi(page);
    await page.goto('/');
    await expect(page.locator('#simplePassForm')).toBeVisible();
    await fits(page, 'login', testInfo);
  });

  for (const role of ['owner', 'master']) {
    test(`${role} screens fit ${width}x${height}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height });
      await mockApi(page, role);
      await page.goto('/');
      await expect(page.locator('#authGate')).toBeHidden();
      await expect(page.locator('.loadCard, .bosMasterUpcomingDays').first()).toBeVisible();
      await fits(page, 'home', testInfo);

      for (const screen of ['orders', 'dispatch', 'team']) {
        await page.locator(`nav button[data-page="${screen}"]`).click();
        if (screen === 'dispatch' && role === 'master') {
          await expect(page.locator('#masterMonthCalendar .bosCalDay').first()).toBeVisible();
          const save = page.getByRole('button', { name: 'Сохранить график', exact: true });
          await save.scrollIntoViewIfNeeded();
          await expect(save).toBeInViewport();
        }
        await fits(page, screen, testInfo);
      }

      if (role === 'owner') {
        await page.getByRole('button', { name: '+ Сотрудник' }).click();
        await expect(page.locator('input[name="full_name"]')).toBeVisible();
        await fits(page, 'employee-form', testInfo);
        await closeModal(page);
      }

      await page.locator('#profileBtn').click();
      await expect(page.locator('.modal')).toBeVisible();
      await fits(page, 'profile', testInfo);
      await closeModal(page);

      await page.locator('nav button[data-page="orders"]').click();
      await page.locator('.opsCompactOrder, .bosHandsMiniCard').filter({ hasText: 'UI-1' }).click();
      await expect(page.locator('.modal')).toBeVisible();
      await fits(page, 'order-modal', testInfo);
      const modal = await page.locator('.modal').boundingBox();
      expect(modal.y).toBeGreaterThanOrEqual(0);
      expect(modal.y + modal.height).toBeLessThanOrEqual(height + 1);
      if (width >= 768) expect(modal.width).toBeLessThanOrEqual(720);
      if (role === 'owner') {
        await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
        await fits(page, 'order-form', testInfo);
      }
      await closeModal(page);

      const nav = await page.locator('#app > nav').boundingBox();
      const content = await page.locator('#content').boundingBox();
      if (width >= 1024) {
        expect(nav.x + nav.width).toBeLessThan(content.x);
        expect(content.width).toBeGreaterThan(700);
      } else {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const last = await page.locator('#content > :last-child').boundingBox();
        const bottomNav = await page.locator('#app > nav').boundingBox();
        expect(last.y + last.height).toBeLessThanOrEqual(bottomNav.y + 1);
      }
    });
  }
}
