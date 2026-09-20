const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const viewports=[
  [320,700],[360,800],[375,812],[390,844],[430,932],
  [768,1024],[1024,768],[1280,800],[1440,900],[1920,1080]
];

async function expectNoHorizontalOverflow(page,width,role){
  const layout=await page.evaluate(()=>{
    const vw=document.documentElement.clientWidth;
    const visible=[...document.querySelectorAll('#app,#content,#app>header,#app>nav,.card,.hero,.dashMetric,.loadCard,.ownerProblemsCompact,.modal,.form,.bosHandsMiniCard,.opsCompactOrder')]
      .filter(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;});
    const outside=visible.filter(el=>{const r=el.getBoundingClientRect();return r.left<-1||r.right>vw+1;}).map(el=>el.className||el.id||el.tagName);
    return {overflow:document.documentElement.scrollWidth-vw,outside};
  });
  expect(layout,`${role} ${width}px`).toEqual({overflow:0,outside:[]});
}

async function expectKpiLabelsClear(page,width){
  if(width>430)return;
  const metrics=page.locator('.dashMetric:visible');
  const count=await metrics.count();
  for(let i=0;i<count;i++){
    const metric=metrics.nth(i);
    const label=metric.locator(':scope > .muted');
    const value=metric.locator(':scope > strong');
    if(await label.count()&&await value.count()){
      const a=await label.boundingBox(),b=await value.boundingBox();
      if(a&&b)expect(a.y+a.height).toBeLessThanOrEqual(b.y+1);
    }
  }
}

for(const role of ['owner','dispatcher','master']){
  test(`dark Business OS stays responsive for ${role} at all target widths`,async({page},testInfo)=>{
    await fullStack(page,role);
    await page.setViewportSize({width:390,height:844});
    await page.goto('/');
    await expect(page.locator('#authGate')).toBeHidden();

    for(const [width,height] of viewports){
      await page.setViewportSize({width,height});
      await page.waitForTimeout(40);
      await expectNoHorizontalOverflow(page,width,role);
      await expectKpiLabelsClear(page,width);

      const nav=await page.locator('#app > nav').boundingBox();
      const content=await page.locator('#content').boundingBox();
      expect(nav).not.toBeNull();
      expect(content).not.toBeNull();
      if(width>=1024){
        expect(nav.x+nav.width).toBeLessThanOrEqual(content.x-8);
        expect(content.width).toBeGreaterThan(620);
      }else{
        expect(nav.y).toBeGreaterThan(height/2);
      }

      if((width===390||width===1440)&&role==='owner'){
        await page.screenshot({path:testInfo.outputPath(`owner-${width}.png`),fullPage:true});
      }
    }
  });
}

test('mobile order form keeps fields and actions inside the viewport',async({page})=>{
  await fullStack(page,'owner');
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(()=>openOrderForm());

  const modal=page.locator('#modalRoot .modal');
  await expect(modal).toBeVisible();
  const modalBox=await modal.boundingBox();
  expect(modalBox).not.toBeNull();

  const selectors=['input','select','textarea','button.primary','button.secondary'];
  let count=0;
  for(const selector of selectors){
    const group=modal.locator(selector);
    const groupCount=await group.count();
    count+=groupCount;
    for(let i=0;i<groupCount;i++){
      const box=await group.nth(i).boundingBox();
      if(!box)continue;
      expect(box.x).toBeGreaterThanOrEqual(modalBox.x-1);
      expect(box.x+box.width).toBeLessThanOrEqual(modalBox.x+modalBox.width+1);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  }
  expect(count).toBeGreaterThan(5);

  const columns=await modal.locator('#orderForm .two').first().evaluate(el=>getComputedStyle(el).gridTemplateColumns);
  expect(columns.trim().split(/\s+/)).toHaveLength(1);
  await expectNoHorizontalOverflow(page,390,'owner form');
});

test('master mobile order cards and day filters remain touch friendly',async({page},testInfo)=>{
  await fullStack(page,'master');
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(()=>show('orders'));
  await expect(page.getByText('Мои заявки',{exact:true})).toBeVisible();

  const diagnostics=await page.evaluate(()=>{
    const rect=el=>{
      if(!el)return null;
      const r=el.getBoundingClientRect();
      const s=getComputedStyle(el);
      return {
        text:String(el.textContent||'').trim().slice(0,80),
        x:r.x,y:r.y,left:r.left,right:r.right,width:r.width,height:r.height,
        minHeight:s.minHeight,boxSizing:s.boxSizing,display:s.display,
        overflowX:s.overflowX,paddingLeft:s.paddingLeft,paddingRight:s.paddingRight
      };
    };
    return {
      innerWidth:window.innerWidth,
      documentClientWidth:document.documentElement.clientWidth,
      documentScrollWidth:document.documentElement.scrollWidth,
      bodyClientWidth:document.body.clientWidth,
      bodyScrollWidth:document.body.scrollWidth,
      content:rect(document.querySelector('#content')),
      filters:[...document.querySelectorAll('.masterDayFilters button')].map(rect),
      card:rect(document.querySelector('.bosHandsMiniCard'))
    };
  });
  await testInfo.attach('master-mobile-layout.json',{
    body:Buffer.from(JSON.stringify(diagnostics,null,2)),
    contentType:'application/json'
  });

  const filters=page.locator('.masterDayFilters button');
  expect(await filters.count()).toBeGreaterThan(0);
  for(let i=0;i<await filters.count();i++){
    const box=await filters.nth(i).boundingBox();
    if(box)expect(box.height).toBeGreaterThanOrEqual(40);
  }

  const card=page.locator('.bosHandsMiniCard').first();
  await expect(card).toBeVisible();
  const cardBox=await card.boundingBox();
  expect(cardBox).not.toBeNull();
  expect(cardBox.x).toBeGreaterThanOrEqual(-1);
  expect(cardBox.x+cardBox.width).toBeLessThanOrEqual(391);
  await expectNoHorizontalOverflow(page,390,'master orders');
});
