const { test, expect } = require('@playwright/test');
const { dispatchScrollFixture } = require('./helpers/dispatch-scroll.cjs');

for (const tab of ['Расписание', 'Список', 'Контроль']) {
  test(`${tab}: page scroll reaches the final content at 1280x720`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const { db } = await dispatchScrollFixture(page);
    await page.goto('/');
    await expect(page.locator('#authGate')).toBeHidden();
    await page.waitForFunction(() => window.BOS_DISPATCHER_HORIZONTAL_SCHEDULE_V190);
    await page.locator('nav [data-page=orders]').click();
    await expect(page.locator('.dbBoard')).toHaveClass(/dh190Board/);
    if (tab === 'Контроль') await page.locator('.dbV24Tab').click();
    else await page.locator('.dbViewTabs').getByRole('button', { name: tab, exact: true }).click();
    const content = page.locator(tab === 'Расписание' ? '.dh190Grid' : tab === 'Список' ? '.dbV94ListItems' : '.dbV24List');
    await expect(content).toBeVisible();
    const extraQueue=page.locator('#content>.duq122:visible');
    if(tab==='Список')await expect(extraQueue).toBeVisible();
    if(await extraQueue.count()) {
      expect(await extraQueue.evaluate(el=>el.previousElementSibling?.matches('.dbBoard')), 'keyboard order follows visual order').toBe(true);
      const queue=await extraQueue.boundingBox(),board=await page.locator('.dbBoard').boundingBox();
      expect(queue.y, 'supplementary queue follows the board').toBeGreaterThanOrEqual(board.y+board.height);
    }
    if (process.env.BOS_CAPTURE_DIR) await page.screenshot({ path: `${process.env.BOS_CAPTURE_DIR}/${tab}-top.png` });
    const metrics = await page.evaluate(() => {
      const selectors = ['html', 'body', '#app', '.dh190Board', '.dbLayout', '.dbAttention', '.dbSchedule', '.dh190GridWrap', '.dbV94ListItems', '.dbV24List', '#dispatchBoardDetail', '#dispatchBoardDetail>.dbDetail'];
      return selectors.map(selector => {
        const el = document.querySelector(selector);
        if (!el || !el.getClientRects().length) return null;
        const css = getComputedStyle(el);
        return { selector, height: el.clientHeight, scrollHeight: el.scrollHeight, overflowY: css.overflowY };
      }).filter(Boolean);
    });
    await testInfo.attach('scroll-containers', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
    expect(await page.evaluate(() => document.scrollingElement.scrollHeight - innerHeight), 'busy board must extend the document').toBeGreaterThan(100);
    expect(metrics.filter(m => !['html', 'body', '#app'].includes(m.selector) && m.scrollHeight > m.height + 2 && ['auto', 'scroll', 'hidden'].includes(m.overflowY)), 'no clipped or independently scrolling columns').toEqual([]);
    await content.hover({ position: { x: 100, y: 20 } });
    await page.mouse.wheel(0, 600);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(100);
    const last = content.locator(tab === 'Расписание' ? '.du187Master' : tab === 'Список' ? '.dbV94ListCard' : '.dbV24Card').last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    const candidateText=page.locator('#dispatchBoardDetail .dbSmartCandidate>div:first-child').first();
    await expect(candidateText).toBeVisible();
    expect((await candidateText.boundingBox()).width, 'recommendation text must not be squeezed by its button').toBeGreaterThan(150);
    const lastAction=page.locator('#dispatchBoardDetail button').last();
    await lastAction.scrollIntoViewIfNeeded();
    await expect(lastAction).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    expect(db.calls.filter(c => c.table === 'orders' && c.mode === 'update')).toHaveLength(0);
  });
}

test('control cards show price and support whole-card and keyboard selection without writes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { db } = await dispatchScrollFixture(page);
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(() => window.BOS_DISPATCHER_HORIZONTAL_SCHEDULE_V190);
  await page.locator('nav [data-page=orders]').click();
  await expect(page.locator('.dbBoard')).toHaveClass(/dh190Board/);
  await page.locator('.dbV24Tab').click();
  await expect(page.locator('.dbViewTabs button.primary')).toHaveCount(1);
  await expect(page.locator('.dbV24Tab')).toHaveClass(/primary/);
  const card = page.locator('.dbV24Card[data-order-id="530"]');
  await expect(card).toContainText(/5\s*700\s*₽/);
  await card.locator('.dbV24Meta').click();
  await expect(card).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('#dispatchBoardDetail')).toContainText('Клиент 30');
  const next = page.locator('.dbV24Card[data-order-id="529"]');
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(next).toHaveAttribute('aria-current', 'true');
  await expect(card).not.toHaveAttribute('aria-current', 'true');
  await expect(page.locator('#dispatchBoardDetail')).toContainText('Клиент 29');
  await page.locator('.dbOrderCard[data-order-id="513"]').click();
  await expect(page.locator('#dispatchBoardDetail')).toContainText('Клиент 13');
  await expect(page.locator('.dbV24Card[data-order-id="513"]')).toHaveAttribute('aria-current', 'true');
  await expect(next).not.toHaveAttribute('aria-current', 'true');
  db.tables.orders.find(o => o.id === '530').amount = 6100;
  await page.evaluate(() => window.BOS_REFRESH_NOW());
  await expect(card).toContainText(/6\s*100\s*₽/);
  expect(db.calls.filter(c => c.table === 'orders' && c.mode === 'update')).toHaveLength(0);
});
