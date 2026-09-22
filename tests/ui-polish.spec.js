const {test, expect} = require('@playwright/test');
const {fullStack} = require('./helpers/full-stack.cjs');

async function fits(page) {
  await expect(async () => {
  const layout = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const root = document.querySelector('#modalRoot .modal') || document.querySelector('#content');
    const controls = [...root.querySelectorAll('button, input:not([type="hidden"]), select, textarea')]
      .filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    return {
      overflow: document.documentElement.scrollWidth - width,
      rootOverflow: root.scrollWidth - root.clientWidth,
      clipped: controls.filter(el => {
        const rect = el.getBoundingClientRect();
        // Horizontally scrolling date/filter strips are intentional.
        const strip = el.closest('.bosOrderFilters, .masterDayFilters, .masterWeekDays, .masterStatusFilters, .dmShortcuts');
        return !strip && (rect.left < -1 || rect.right > width + 1);
      }).map(el => el.id || el.className),
      small: controls.filter(el => el.matches('.primary, .secondary, .wide, .modalClose') &&
        el.getBoundingClientRect().height < 44).map(el => el.textContent.trim())
    };
  });
  // Fractional grid widths can round scrollWidth up by one CSS pixel.
  expect(layout.rootOverflow).toBeLessThanOrEqual(1);
  expect({...layout, rootOverflow: 0}).toEqual({overflow: 0, rootOverflow: 0, clipped: [], small: []});
  for (const strip of ['.bosOrderFilters', '.masterDayFilters']) {
    const heights = await page.locator(`${strip} button:visible`).evaluateAll(els =>
      els.map(el => el.getBoundingClientRect().height));
    expect(heights.every(height => height >= 44 && height <= 48)).toBe(true);
  }
  }).toPass({timeout: 3000});
}

for (const role of ['owner', 'manager', 'dispatcher', 'master']) {
  for (const width of [360, 390, 430, 1440]) {
    test(`polished forms and profiles: ${role} ${width}px`, async ({page}, testInfo) => {
      await page.setViewportSize({width, height: 900});
      const {master} = await fullStack(page, role);
      await page.goto('/');
      await expect(page.locator('#authGate')).toBeHidden();
      for (const screen of ['home', 'orders', 'dispatch', 'team']) {
        await page.locator(`nav [data-page="${screen}"]`).click();
        await expect(page.locator(`nav [data-page="${screen}"]`)).toHaveClass(/active/);
        if (role === 'master' && screen === 'dispatch')
          await expect(page.locator('.bosCompactSchedule')).toBeVisible();
        await fits(page);
        if (role === 'owner' && width === 1440 && screen === 'home')
          await page.screenshot({path: testInfo.outputPath('desktop-home.png')});
        if (role === 'owner' && width === 390 && screen === 'orders')
          await page.screenshot({path: testInfo.outputPath('mobile-orders.png')});
      }
      await page.locator('#profileBtn').click();
      await expect(page.locator('#modalRoot .modal')).toBeVisible();
      await fits(page);
      await page.locator('.modalClose').click();

      if (role !== 'master') {
        await page.locator('nav [data-page="orders"]').click();
        await page.getByRole('button', {name: '+ Новая', exact: true}).click();
        await expect(page.locator('#orderForm')).toBeVisible();
        await fits(page);
        await page.locator('.modalClose').click();
      }
      if (role === 'owner') {
        await page.evaluate(() => window.openOwnerProfile());
        await expect(page.locator('#bosOwnerLogout')).toBeVisible();
        await fits(page);
        await page.locator('.modalClose').click();
        await page.evaluate(id => window.openEmployeeProfile(id), master.external_id);
        await expect(page.locator('#modalRoot .modal')).toBeVisible();
        await fits(page);
        await page.locator('.modalClose').click();
        await page.locator('nav [data-page="team"]').click();
        await page.getByRole('button', {name: '+ Сотрудник', exact: true}).click();
        await expect(page.locator('#empForm')).toBeVisible();
        await fits(page);
        await page.locator('.modalClose').click();
        await page.locator('nav [data-page="home"]').click();
        await page.locator('#ownerToolsBtn').click();
        await expect(page.locator('#modalRoot .modal')).toBeVisible();
        await fits(page);
      }
    });
  }
}

test('owner logout remains usable and the login card fits a short mobile viewport', async ({page}) => {
  await page.setViewportSize({width: 360, height: 500});
  await fullStack(page, 'owner');
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('#profileBtn').click();
  const logout = page.locator('#bosLogout');
  await expect(logout).toBeVisible();
  await logout.click();
  await expect(page.locator('#bosLogoutLoginForm')).toBeVisible();
  const layout = await page.locator('.authGateCard').evaluate(el => {
    const rect = el.getBoundingClientRect();
    return {left: rect.left, right: rect.right, top: rect.top, overflow: el.scrollWidth - el.clientWidth};
  });
  expect(layout.left).toBeGreaterThanOrEqual(0);
  expect(layout.top).toBeGreaterThanOrEqual(0);
  expect(layout.right).toBeLessThanOrEqual(360);
  expect(layout.overflow).toBe(0);
});
