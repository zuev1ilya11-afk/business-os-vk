const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const {attachmentUrl}=require('./helpers/edge.cjs');
const {businessDay,nextDay}=require('../order-control.js');

async function ready(page){
 const data=await fullStack(page,'owner');
 const today=businessDay();
 Object.assign(data.db.tables.orders[0],{
  scheduled_date:today,scheduled_time:'10:00',report_review_status:'pending',
  report_uploaded_at:'2026-09-30T18:00:00Z',report_upload_token:'control-review',
  report_act_url:attachmentUrl('11','control-review')
 });
 Object.assign(data.db.tables.orders[1],{scheduled_date:nextDay(today),scheduled_time:'12:00'});
 await page.setViewportSize({width:390,height:900});
 await page.goto('/');
 await expect(page.locator('#authGate')).toBeHidden();
 await page.waitForFunction(()=>!!window.BOS_ORDER_CONTROL&&!!window.BOS_REFRESH_NOW);
 await page.locator('#bosOrderControlSummary').click();
 await expect(page.locator('#bosOrderControl [data-oc-total]')).toHaveText('2');
 return data;
}
function orderWrites(db){return db.calls.filter(c=>c.table==='orders'&&['update','insert','delete','upsert'].includes(c.mode));}

test('order control review button opens the existing report with its exact snapshot and no mutation',async({page})=>{
 const {db}=await ready(page);
 await page.locator('#bosOrderControl [data-oc-open="11"]').click();
 await expect(page.locator('#reviewForm')).toBeVisible();
 expect(await page.evaluate(()=>window.BOS_REVIEW_SNAPSHOT('11'))).toEqual({
  expected_report_token:'control-review',expected_report_uploaded_at:'2026-09-30T18:00:00Z'
 });
 expect(orderWrites(db)).toEqual([]);
 expect(db.tables.orders[0].report_review_status).toBe('pending');
});

test('real bootstrap refresh removes resolved tasks and preserves the selected filter',async({page})=>{
 const {db,master}=await ready(page),panel=page.locator('#bosOrderControl');
 await panel.locator('[data-oc-filter="reports"]').click();
 await expect(panel.locator('.ocItem')).toHaveCount(1);
 Object.assign(db.tables.orders[0],{status:'Выполнена',report_review_status:'approved'});
 Object.assign(db.tables.orders[1],{master_staff_id:master.id,master_name:master.full_name,master_called_at:'2026-09-30T19:00:00Z',master_agreed_at:'2026-09-30T19:01:00Z'});
 await expect.poll(()=>page.evaluate(async()=>{await window.BOS_REFRESH_NOW();return state.orders.find(o=>String(o.id)==='11')?.report_review_status;})).toBe('approved');
 await expect(panel.locator('[data-oc-total]')).toHaveText('0');
 await expect(panel.locator('[data-oc-filter="reports"]')).toHaveAttribute('aria-pressed','true');
 await expect(panel.locator('.ocItem')).toHaveCount(0);
 expect(orderWrites(db)).toEqual([]);
});

test('a stale review button cannot reopen an accepted report for review',async({page})=>{
 const {db}=await ready(page);
 await page.evaluate(()=>{
  const o=state.orders.find(x=>String(x.id)==='11');
  Object.assign(o,{status:'Выполнена',report_review_status:'approved'});
  // Update and click in one task to exercise the gap before the DOM refresh.
  document.querySelector('#bosOrderControl [data-oc-open="11"]').click();
 });
 await expect(page.locator('#modalRoot .modal')).toBeVisible();
 await expect(page.locator('#reviewForm')).toHaveCount(0);
 expect(orderWrites(db)).toEqual([]);
});
