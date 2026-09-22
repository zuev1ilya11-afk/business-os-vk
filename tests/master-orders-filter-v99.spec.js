const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test('master orders keep new first, separate claims, and move completed orders to archive after week rollover', async ({ page }) => {
  await page.setContent('<main id="content"></main>');
  await page.addScriptTag({content:`
    window.state={page:'orders',user:{role:'master'},orders:[]};
    window.pages={orders:()=>''};
    window.esc=v=>String(v??'');
    window.money=v=>String(Math.round(Number(v)||0))+' ₽';
    window.openOrder=()=>{};
    window.show=()=>{};
    window.__BOS_MASTER_NOW='2026-09-22T12:00:00';
    window.ownOrders=()=>[
      {id:'new',status:'В работе',master_workflow_stage:'assigned',scheduled_date:'2026-09-24',scheduled_time:'12:00',client:'Новая',amount:1000,created_at:'2026-09-22T10:00:00Z'},
      {id:'work',status:'В работе',master_workflow_stage:'started',scheduled_date:'2026-09-22',scheduled_time:'09:00',client:'В работе',amount:1000,created_at:'2026-09-20T10:00:00Z'},
      {id:'done-current',status:'Выполнена',master_workflow_stage:'completed',scheduled_date:'2026-09-22',completed_at:'2026-09-22T11:00:00Z',client:'Выполнена сейчас',amount:1000},
      {id:'done-old',status:'Выполнена',master_workflow_stage:'completed',scheduled_date:'2026-09-20',completed_at:'2026-09-20T11:00:00Z',client:'Старое выполнение',amount:1000},
      {id:'claim',status:'Рекламация',scheduled_date:'2026-09-23',scheduled_time:'10:00',client:'Рекламация',amount:1000}
    ];
  `});
  await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'..','master-orders-filter-v99.js'),'utf8')});
  await page.locator('#content').evaluate(el=>{el.innerHTML=window.pages.orders()});

  await expect.poll(()=>page.locator('.masterOrdersV99Card').evaluateAll(cards=>cards.map(c=>c.dataset.masterOrderId))).toEqual(['new','work']);
  await expect(page.locator('.masterStatusFilters')).toContainText('Новые1');
  await expect(page.locator('.masterStatusFilters')).toContainText('Выполненные1');
  await expect(page.locator('.masterStatusFilters')).toContainText('Рекламации1');
  await expect(page.locator('.masterStatusFilters')).toContainText('Архив1');

  await page.evaluate(()=>setMasterOrdersFilter('done'));
  await expect.poll(()=>page.locator('.masterOrdersV99Card').evaluateAll(cards=>cards.map(c=>c.dataset.masterOrderId))).toEqual(['done-current']);

  await page.evaluate(()=>setMasterOrdersFilter('claim'));
  await expect.poll(()=>page.locator('.masterOrdersV99Card').evaluateAll(cards=>cards.map(c=>c.dataset.masterOrderId))).toEqual(['claim']);

  await page.evaluate(()=>setMasterOrdersFilter('archive'));
  await expect.poll(()=>page.locator('.masterOrdersV99Card').evaluateAll(cards=>cards.map(c=>c.dataset.masterOrderId))).toEqual(['done-old']);

  await page.evaluate(()=>{window.__BOS_MASTER_NOW='2026-09-28T12:00:00';setMasterOrdersFilter('done')});
  await expect(page.locator('.masterOrdersV99Card')).toHaveCount(0);
  await page.evaluate(()=>setMasterOrdersFilter('archive'));
  await expect.poll(()=>page.locator('.masterOrdersV99Card').evaluateAll(cards=>cards.map(c=>c.dataset.masterOrderId))).toEqual(['done-current','done-old']);
});

test('master order filter runtime is loaded by production bootstrap', async () => {
  const pwa=fs.readFileSync(path.join(__dirname,'..','pwa-register.js'),'utf8');
  expect(pwa).toContain('master-orders-filter-v99.js?v=20260922-v99');
});
