const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const viewports=[
  [320,700],[360,800],[375,812],[390,844],[430,932],
  [768,1024],[1024,768],[1280,800],[1440,900],[1920,1080]
];

async function expectNoHorizontalOverflow(page,width,role){
  const layout=await page.evaluate(()=>{
    const vw=document.documentElement.clientWidth;
    const visible=[...document.querySelectorAll('#app,#content,#app>header,#app>nav,.card,.hero,.dashMetric,.loadCard,.ownerProblemsCompact')]
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
