const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

async function expectViewportSafe(page,label){
  const result=await page.evaluate(()=>{
    const vw=document.documentElement.clientWidth;
    const nodes=[...document.querySelectorAll('#content,.opsCompactOrder,.bosHandsMiniCard,.modal,#orderForm,#orderForm input,#orderForm select,#orderForm textarea,.bosOrderFact,.bosOrderMoney')]
      .filter(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;});
    const outside=nodes.filter(el=>{const r=el.getBoundingClientRect();return r.left<-1||r.right>vw+1;}).map(el=>el.className||el.id||el.tagName);
    return {pageOverflow:document.documentElement.scrollWidth-vw,outside};
  });
  expect(result,label).toEqual({pageOverflow:0,outside:[]});
}

test('management order cards and order form stay compact and usable on mobile',async({page})=>{
  await fullStack(page,'owner');
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();

  await page.locator('nav button[data-page="orders"]').click();
  await expect(page.locator('#bosOrderList')).toBeVisible();
  await expect(page.locator('.opsCompactOrder')).toHaveCount(2);
  await expectViewportSafe(page,'owner order list');

  const firstCard=await page.locator('.opsCompactOrder').first().boundingBox();
  expect(firstCard).not.toBeNull();
  expect(firstCard.width).toBeGreaterThan(300);

  await page.getByRole('button',{name:'+ Новая',exact:true}).click();
  await expect(page.locator('#orderForm')).toBeVisible();
  await expectViewportSafe(page,'owner order form');

  const formLayout=await page.locator('#orderForm').evaluate(form=>{
    const controls=[...form.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]),select,textarea,button.primary.wide')].map(el=>{
      const r=el.getBoundingClientRect();return {tag:el.tagName,height:r.height,width:r.width};
    });
    const checkRows=[...form.querySelectorAll('.checkRow')].map(el=>el.getBoundingClientRect().height);
    const pair=form.querySelector('.two');
    return {controls,checkRows,columns:pair?getComputedStyle(pair).gridTemplateColumns:''};
  });
  expect(formLayout.controls.every(x=>x.width>0&&x.height>=44)).toBeTruthy();
  expect(formLayout.checkRows.every(height=>height>=44)).toBeTruthy();
  expect(formLayout.columns.trim().split(/\s+/)).toHaveLength(1);

  await page.evaluate(()=>closeModal());
  await page.locator('.opsCompactOrder').first().click();
  await expect(page.locator('#quickStatus')).toBeVisible();
  await expect(page.locator('#quickMaster')).toBeVisible();
  await expectViewportSafe(page,'owner order details');

  const stacked=await page.evaluate(()=>{
    const a=document.querySelector('#quickStatus').getBoundingClientRect();
    const b=document.querySelector('#quickMaster').getBoundingClientRect();
    return {sameColumn:Math.abs(a.left-b.left)<2,nextRow:b.top>=a.bottom-1};
  });
  expect(stacked).toEqual({sameColumn:true,nextRow:true});
});

test('master grouped order cards stay viewport-safe on narrow mobile screens',async({page})=>{
  await fullStack(page,'master');
  await page.setViewportSize({width:320,height:700});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(()=>show('orders'));

  await expect(page.locator('.masterDayFilters')).toBeVisible();
  await expect(page.locator('.bosHandsMiniCard')).toHaveCount(1);
  await expectViewportSafe(page,'master order list');

  const card=page.locator('.bosHandsMiniCard').first();
  const box=await card.boundingBox();
  expect(box).not.toBeNull();
  expect(box.width).toBeGreaterThan(270);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x+box.width).toBeLessThanOrEqual(321);

  await card.click();
  await expect(page.locator('.bosHandsOrder')).toBeVisible();
  await expectViewportSafe(page,'master order details');
});
