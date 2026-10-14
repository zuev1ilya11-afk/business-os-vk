const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { dispatchScrollFixture } = require('./helpers/dispatch-scroll.cjs');

const screens = [[1920,1080],[1600,900],[1440,900],[1366,768],[1280,720],[1024,768],[390,844]];
// Equivalent CSS viewport + pixel density, not an assertion about browser toolbar zoom.
for (const [width,height] of screens) for (const zoom of [1,1.25]) {
  test.describe(`${width}x${height} at ${zoom * 100}% equivalent zoom`, () => {
    test.use({ viewport: { width: Math.floor(width/zoom), height: Math.floor(height/zoom) }, deviceScaleFactor: zoom, locale: 'ru-RU' });
    test('schedule, list and control reach their final row with page scrolling', async ({ page }, info) => {
      if(process.env.BOS_CAPTURE_DIR)fs.mkdirSync(process.env.BOS_CAPTURE_DIR,{recursive:true});
      const { db } = await dispatchScrollFixture(page);
      const errors=[];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('/');
      await expect(page.locator('#authGate')).toBeHidden();
      await page.evaluate(async () => window.BOS_LOAD_ROLE_MODULES?.('owner'));
      await page.locator('nav [data-page=orders]').click();
      const desktop = width/zoom >= 1050;
      if (desktop) await expect(page.locator('.dbBoard')).toHaveClass(/dh190Board/);
      const results=[];
      for (const [tab,key] of [['Расписание','schedule'],['Список','list'],['Контроль','control']]) {
        let root, rows;
        if (desktop) {
          if (tab === 'Контроль') await page.locator('.dbV24Tab').click();
          else await page.locator('.dbViewTabs').getByRole('button',{name:tab,exact:true}).click();
          root=page.locator(tab==='Расписание'?'.dh190Grid':tab==='Список'?'.dbV94ListItems':'.dbV24List');
          rows=root.locator(tab==='Расписание'?'.du187Master':tab==='Список'?'.dbV94ListCard':'.dbV24Card');
          await expect(rows).toHaveCount(tab==='Расписание'?12:tab==='Список'?30:18);
          if (tab==='Список') await expect(root.locator('.du183Amount')).toHaveCount(30);
        } else {
          await page.locator(`nav [data-page=${tab==='Расписание'?'dispatch':'orders'}]`).click();
          if (tab==='Контроль') {
            await page.locator('#bosOrderControlEntry').click();
            await expect(page.locator('[data-oc-total]')).toHaveText('30');
            while (await page.locator('[data-oc-more]').isVisible()) {
              const count=await page.locator('#bosOrderControl .ocItem').count();
              await page.locator('[data-oc-more]').click();
              await expect.poll(()=>page.locator('#bosOrderControl .ocItem').count()).toBeGreaterThan(count);
            }
          }
          root=page.locator(tab==='Расписание'?'.usManagement':tab==='Список'?'#bosOrderList':'#bosOrderControl');
          rows=root.locator(tab==='Расписание'?'.usTeamDay':tab==='Список'?'[data-ops-list-order]':'.ocItem');
          await expect(rows.last()).toBeVisible();
        }
        await page.evaluate(() => window.scrollTo(0,0));
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const captures = process.env.BOS_CAPTURE_DIR && zoom===1 && [1600,1280,390].includes(width);
        const capture = async part => {
          if (!captures) return;
          const file=path.join(process.env.BOS_CAPTURE_DIR,`${width}-${key}-${part}.png`);
          fs.mkdirSync(path.dirname(file),{recursive:true});
          await page.screenshot({path:file});
        };
        await capture('top');
        const geometry=await root.evaluate(el=>({height:el.clientHeight,scrollHeight:el.scrollHeight,overflowY:getComputedStyle(el).overflowY,pageHeight:document.scrollingElement.scrollHeight,viewport:innerHeight,pageOverflow:document.documentElement.scrollWidth-innerWidth}));
        expect(geometry.pageOverflow, `${tab}: whole-page horizontal overflow`).toBeLessThanOrEqual(1);
        expect(geometry.pageHeight, `${tab}: enough content to exercise real scroll`).toBeGreaterThan(geometry.viewport);
        if (desktop) {
          const traps=await page.locator('.dbAttention,.dbSchedule,#dispatchBoardDetail,#dispatchBoardDetail>.dbDetail,.dh190GridWrap,.dbV94ListItems,.dbV24List').evaluateAll(els=>els.filter(el=>el.getClientRects().length&&el.scrollHeight>el.clientHeight+2&&['auto','scroll','hidden'].includes(getComputedStyle(el).overflowY)).map(el=>el.className||el.id));
          expect(traps, `${tab}: no nested vertical scroll trap`).toEqual([]);
        }
        const before=await page.evaluate(()=>scrollY);
        await page.mouse.move(Math.min(width/zoom-30,700),Math.floor(height/zoom*.8));
        await expect.poll(async()=>{await page.mouse.wheel(0,500);return page.evaluate(()=>scrollY)}).toBeGreaterThan(before);
        await rows.nth(Math.floor(await rows.count()/2)).scrollIntoViewIfNeeded();
        await capture('middle');
        await rows.last().scrollIntoViewIfNeeded();
        await expect(rows.last()).toBeInViewport();
        await capture('bottom');
        if(desktop) {
          const action=page.locator('#dispatchBoardDetail button').last();
          await action.scrollIntoViewIfNeeded();
          await expect(action).toBeInViewport();
          await capture('detail-bottom');
          const queueEnd=page.locator('.dbAttention .dbOrderCard').last();
          await queueEnd.scrollIntoViewIfNeeded();
          await expect(queueEnd).toBeInViewport();
        }
        await page.evaluate(()=>window.scrollTo(0,document.scrollingElement.scrollHeight));
        await expect.poll(()=>page.evaluate(()=>document.scrollingElement.scrollHeight-innerHeight-scrollY)).toBeLessThanOrEqual(1);
        await capture('page-end');
        if (desktop && tab==='Расписание') {
          const wrap=page.locator('.dh190GridWrap');
          const horizontal=await wrap.evaluate(el=>{el.scrollLeft=el.scrollWidth;return {left:el.scrollLeft,extra:el.scrollWidth-el.clientWidth,vertical:el.scrollHeight-el.clientHeight}});
          expect(horizontal.vertical).toBeLessThanOrEqual(1);
          if(horizontal.extra>1)expect(horizontal.left).toBeGreaterThan(0);
        }
        results.push({tab,rows:await rows.count(),...geometry});
      }
      expect(errors).toEqual([]);
      expect(db.calls.filter(c=>c.table==='orders'&&['update','insert','delete'].includes(c.mode))).toEqual([]);
      await info.attach('responsive-scroll',{body:JSON.stringify({width,height,zoom,cssViewport:page.viewportSize(),results},null,2),contentType:'application/json'});
      if(process.env.BOS_CAPTURE_DIR)fs.writeFileSync(path.join(process.env.BOS_CAPTURE_DIR,`${width}-${zoom}-metrics.json`),JSON.stringify({width,height,zoom,cssViewport:page.viewportSize(),results,errors},null,2));
    });
  });
}
