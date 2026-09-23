const {test,expect}=require('@playwright/test');
const fs=require('fs');
const path=require('path');

async function boot(page,{orders=[],claims=[],visibleOrderIds=[],refreshedClaims=null}={}){
  const cards=visibleOrderIds.map(id=>`<button type="button" class="bosMasterUpcomingCard" onclick="openOrder('${id}')"><strong class="bosUpcomingNo">№ ${id}</strong><span class="bosUpcomingWork">Старая работа</span><small class="bosUpcomingMeta">10:00 · 0 ₽</small></button>`).join('');
  const upcoming=visibleOrderIds.length
    ?`<div class="bosMasterUpcomingDays"><div class="bosMasterUpcomingDay"><div class="bosMasterUpcomingDayHead"><b>Завтра</b><span>2099-09-10</span></div>${cards}</div></div>`
    :'<div class="masterEmpty">Ближайших выездов пока нет</div>';
  await page.setContent(`<main id="content"><section class="card"><div class="masterSectionTitle"><h3>Ближайшие заявки</h3></div>${upcoming}</section></main>`);
  await page.addScriptTag({content:`
    window.state=${JSON.stringify({page:'home',user:{role:'master',id:'m1',external_id:'staff_m1',vk_user_id:'staff_m1'},orders,claims,masters:[],users:[]})};
    window.__refreshedClaims=${JSON.stringify(refreshedClaims)};
    window.esc=v=>String(v??'').replace(/[&<>"']/g,'');
    window.money=v=>String(Number(v||0).toLocaleString('ru-RU'))+' ₽';
    window.openOrder=id=>window.__opened='order:'+id;
    window.openClaimDetails=id=>window.__opened='claim:'+id;
    window.refreshClaims=async()=>{if(window.__refreshedClaims!==null)state.claims=window.__refreshedClaims;return state.claims};
    window.show=()=>{};
  `});
  await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'..','master-upcoming-claims-v110.js'),'utf8')});
}

test('server-filtered open claim appears after refresh when master has no ordinary upcoming orders',async({page})=>{
  const refreshedClaims=[
    {id:'c1',order_id:'11',master_staff_id:'server-master-uuid',status:'open',reason:'Исправить крепление',scheduled_date:null,scheduled_time:null,pay_revisit:false}
  ];
  await boot(page,{
    orders:[{id:'11',status:'Выполнена',master_staff_id:'m1',work:'Монтаж',scheduled_date:'2026-09-01'}],
    claims:[],
    refreshedClaims
  });
  await expect(page.locator('.masterEmpty')).toHaveText('Ближайших выездов пока нет');
  await page.evaluate(()=>window.refreshClaims());
  const group=page.locator('.bosMasterClaimDay');
  await expect(group).toBeVisible();
  await expect(page.locator('.masterEmpty')).toHaveCount(0);
  await expect(group).toContainText('Рекламации');
  await expect(group).toContainText('№ 11');
  await expect(group).toContainText('Рекламация');
  await expect(group).toContainText('Исправить крепление');
  await expect(group).toContainText('Дата не назначена');
  await group.locator('.bosMasterUpcomingCard').click();
  await expect.poll(()=>page.evaluate(()=>window.__opened)).toBe('order:11');
});

test('claim already present as upcoming order is decorated instead of duplicated',async({page})=>{
  await boot(page,{
    orders:[{id:'11',status:'В работе',master_staff_id:'m1',is_claim:true,scheduled_date:'2099-09-10',scheduled_time:'10:00'}],
    claims:[{id:'c1',order_id:'11',master_staff_id:'server-master-uuid',status:'open',required_work:'Переделать монтаж',scheduled_date:'2099-09-10',scheduled_time:'10:00',pay_revisit:true,revisit_payment:500}],
    visibleOrderIds:['11']
  });
  await expect(page.locator('.bosMasterUpcomingCard')).toHaveCount(1);
  await expect(page.locator('.bosMasterUpcomingCard')).toContainText('Рекламация');
  await expect(page.locator('.bosMasterUpcomingCard')).toContainText('Переделать монтаж');
  await expect(page.locator('.bosMasterUpcomingCard')).toContainText('Оплата 500 ₽');
  await expect(page.locator('.bosMasterClaimDay')).toHaveCount(0);
});

test('master upcoming claims runtime is loaded by production bootstrap with cache bump',()=>{
  const pwa=fs.readFileSync(path.join(__dirname,'..','pwa-register.js'),'utf8');
  expect(pwa).toContain('master-upcoming-claims-v110.js?v=20260923-v111');
});
