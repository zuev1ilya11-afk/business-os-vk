const {chromium,expect}=require('@playwright/test');
const {createPreviewServer}=require('./preview-master-order.cjs');
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const {server,db}=await createPreviewServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,proxy:{server:'http://127.0.0.1:9',bypass:'127.0.0.1,localhost'}});
 const directory=path.resolve(__dirname,'../docs/master-order-compact');fs.mkdirSync(directory,{recursive:true});
 try{
  for(const width of [360,390,430,1440]){
   const page=await browser.newPage({viewport:{width,height:width>600?1000:844},timezoneId:'Europe/Moscow',proxy:{server:'http://127.0.0.1:9',bypass:'127.0.0.1,localhost'}});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
   await page.goto('http://127.0.0.1:'+server.address().port);
   const card=page.locator('.bosCompactMasterCard');await expect(card).toBeVisible();
   await expect(card.getByRole('button',{name:'Подтвердить: выехал',exact:true})).toBeEnabled();
   await expect(card.locator('[data-bos-help="home"]')).toHaveCount(1);
   await page.screenshot({path:path.join(directory,`master-order-${width}.png`)});
   if(width===390){
    await card.locator('.bosHandsWorks').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(directory,'master-order-390-works.png')});
    await card.locator('.bosOrderAdditional>summary').click();
    await card.getByRole('button',{name:'Помощь по заявке',exact:true}).click();
    await expect(page.locator('#bosMasterHelp')).toBeVisible();
    await page.getByRole('button',{name:'Закрыть помощь',exact:true}).click();
    await card.getByRole('button',{name:'Запросить перенос',exact:true}).click();
    await page.getByLabel('Причина переноса *',{exact:true}).fill('Тест: клиент просит другую дату');
    await page.getByRole('button',{name:'Отправить запрос на перенос',exact:true}).click();
    await expect.poll(()=>db.tables.orders[0].reschedule_requested).toBe(true);
    await page.evaluate(()=>openOrder('11'));
    await card.getByRole('button',{name:'Подтвердить: выехал',exact:true}).click();
    await page.locator('.bosStageTask').getByRole('button',{name:'Подтвердить: выехал',exact:true}).click();
    await expect.poll(()=>db.tables.orders[0].master_workflow_stage).toBe('departed');
    Object.assign(db.tables.orders[0],{master_workflow_stage:'assigned',master_departed_at:null,reschedule_requested:false});
   }
   expect(errors).toEqual([]);await page.close();
  }
  console.log('Preview verified: actual app, synthetic API, help, transfer request and confirmed departure; four widths captured.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
})().catch(error=>{console.error(error);process.exitCode=1});
