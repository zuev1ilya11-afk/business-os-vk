const {test, expect} = require('@playwright/test');
const {fullStack} = require('./helpers/full-stack.cjs');

const widths = [320, 360, 375, 390, 430, 768, 1024, 1280, 1440, 1920];

async function fitsViewport(page) {
  const layout = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const content = document.querySelector('#content').getBoundingClientRect();
    const nav = document.querySelector('#app > nav').getBoundingClientRect();
    return {width, overflow: document.documentElement.scrollWidth - width,
      contentLeft: content.left, contentRight: content.right,
      navLeft: nav.left, navRight: nav.right,
      controls: [...document.querySelectorAll('#app > nav button, #profileBtn')]
        .filter(el => el.getClientRects().length)
        .map(el => ({label: el.textContent, width: el.getBoundingClientRect().width,
          height: el.getBoundingClientRect().height}))};
  });
  expect(layout.overflow).toBeLessThanOrEqual(1);
  expect(layout.contentLeft).toBeGreaterThanOrEqual(0);
  expect(layout.contentRight).toBeLessThanOrEqual(layout.width + 1);
  expect(layout.navLeft).toBeGreaterThanOrEqual(0);
  expect(layout.navRight).toBeLessThanOrEqual(layout.width + 1);
  for (const control of layout.controls) {
    expect(control.width, control.label).toBeGreaterThanOrEqual(44);
    expect(control.height, control.label).toBeGreaterThanOrEqual(44);
  }
}

// Fixtures belong only to tests; the application continues to use its existing APIs.
for (const role of ['owner', 'dispatcher', 'master']) for (const width of widths) {
  test(`dark UI ${role} at ${width}px keeps navigation, content and actions usable`, async ({page}, testInfo) => {
    await page.setViewportSize({width, height: 900});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const {db} = await fullStack(page, role);
    Object.assign(db.tables.orders[0], {
      phone: '+79991234567', scheduled_date: new Date().toLocaleDateString('en-CA'), scheduled_time: '12:00',
      client: 'Анна Александровна Константинопольская',
      address: 'Санкт-Петербург, Большой Сампсониевский проспект, дом 123, корпус 4, квартира 567',
      comment: 'Пожалуйста, позвоните заранее. '.repeat(12)
    });
    await page.goto('/');
    await expect(page.locator('#authGate')).toBeHidden();
    await fitsViewport(page);
    if (process.env.BOS_UI_SCREENSHOTS && [390, 1440].includes(width)) {
      await page.screenshot({path: testInfo.outputPath(`${role}-${width}-home.png`), fullPage: true});
    }
    for (const name of ['orders', 'dispatch', 'team']) {
      await page.locator(`nav [data-page="${name}"]`).click();
      await expect(page.locator(`nav [data-page="${name}"]`)).toHaveClass(/active/);
      await fitsViewport(page);
      if (name === 'orders' && process.env.BOS_UI_SCREENSHOTS && [390, 1440].includes(width)) {
        await page.screenshot({path: testInfo.outputPath(`${role}-${width}-orders.png`), fullPage: true});
      }
    }
    // Existing entrypoint opens the real order modal; clicks below exercise its visible controls.
    await page.evaluate(() => window.openOrder('11'));
    await expect(page.locator('#modalRoot .modal')).toBeVisible();
    const modal = page.locator('#modalRoot .modal');
    expect(await modal.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    if (role === 'master') {
      const call = modal.locator('a[href="tel:+79991234567"]').first();
      await expect(call).toBeVisible();
      expect((await call.boundingBox()).height).toBeGreaterThanOrEqual(44);
      await expect(page.getByRole('button', {name: 'Нужно перенести', exact: true})).toBeVisible();
      await expect(page.getByRole('button', {name: 'Я на месте', exact: true})).toHaveCount(0);
      await page.evaluate(() => window.masterWorkflowCallAndAdvance(null, '11', 'departed'));
      await expect(page.locator('.bosMasterWorkflow')).toContainText('Выехал');
      expect(db.tables.orders[0].master_workflow_stage).toBe('departed');
      expect(db.tables.orders[0].master_payout).toBe(552.5);
      await expect(page.getByRole('link', {name: 'Позвонить по приезду', exact: true})).toBeVisible();
      await page.evaluate(() => window.masterWorkflowCallAndAdvance(null, '11', 'started'));
      await expect(page.locator('.bosMasterWorkflow')).toContainText('Работа начата');
      await page.getByRole('button', {name: 'Завершить и прикрепить отчёт', exact: true}).click();
      await expect(page.locator('#masterReportForm')).toBeVisible();
      await expect(page.getByRole('button', {name: 'Нужно перенести', exact: true})).toBeVisible();
      expect(db.tables.orders[0].status).toBe('В работе');
      if (width === 390) {
        await page.getByRole('button', {name: 'Нужно перенести', exact: true}).click();
        const reason = page.getByLabel('Причина переноса *', {exact: true});
        await page.getByRole('button', {name: 'Отправить запрос на перенос'}).click();
        await expect(reason).toBeVisible();
        expect(await reason.evaluate(el => el.validity.valueMissing)).toBe(true);
        await reason.fill('Клиент просит приехать завтра');
        await page.getByRole('button', {name: 'Отправить запрос на перенос'}).click();
        await expect(page.locator('#masterRescheduleForm')).toHaveCount(0);
        // Verify the existing profile bridge contract through the real handler.
        expect(db.calls.some(c => c.table === 'business_staff' && c.mode === 'update' &&
          c.payload?.district === '@@BOS_R1@@|11|Клиент просит приехать завтра')).toBe(true);
        await page.evaluate(() => window.openOrder('11'));
        await expect(page.locator('.bosRescheduleNotice')).toContainText('Клиент просит приехать завтра');
        expect(db.tables.orders[0].amount).toBe(1000);
        expect(db.tables.orders[0].master_payout).toBe(552.5);
      }
    }
    if (process.env.BOS_UI_SCREENSHOTS && [390, 1440].includes(width)) {
      await page.screenshot({path: testInfo.outputPath(`${role}-${width}-modal.png`)});
    }
    await page.locator('.modalClose').click();
    await expect(page.locator('#modalRoot .modal')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('dark UI keyboard focus stays visible and reduced motion is respected', async ({page}) => {
  await fullStack(page, 'owner');
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page="home"]').focus();
  const focus = await page.locator('nav [data-page="home"]').evaluate(el => ({
    outline: getComputedStyle(el).outlineStyle, transition: getComputedStyle(el).transitionDuration
  }));
  expect(focus.outline).toBe('solid');
  expect(focus.transition).toBe('0s');
});
