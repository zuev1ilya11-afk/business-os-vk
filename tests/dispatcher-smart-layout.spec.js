const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
test.use({screenshot:'only-on-failure'});
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

async function setup(page,role,width){
  const data=await fullStack(page,role);
  const {db,master}=data;
  db.tables.business_staff.find(s=>s.id===master.id).full_name='Александр Константинопольский';
  db.tables.business_staff.push(
    {id:'m2',external_id:'staff_m2',full_name:'Владимир Александрович',role:'master',is_active:true,city:'Санкт-Петербург'},
    {id:'m3',external_id:'staff_m3',full_name:'Дмитрий Владимирович',role:'master',is_active:true,city:'Санкт-Петербург'}
  );
  for(const staff_id of [master.id,'m2','m3'])db.tables.staff_schedule.push({id:`layout_${staff_id}`,staff_id,work_date:today(),is_working:true,work_start:'10:00',work_end:'20:00'});
  // Reproduce the reported All orders card: Hands, no master, no date/time, several work lines.
  Object.assign(db.tables.orders[1],{source:'Hands',external_source:'hands',external_id:'hands:120012',city:'Санкт-Петербург',amount:2800,original_amount:2800,work:'Установка декоративного карниза длиной более 3,5 метров × 2 м\nДемонтаж карниза × 1 шт.\nМинимальная стоимость заказа',scheduled_date:null,scheduled_time:null,time_slot:''});
  await page.setViewportSize({width,height:1000});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_DISPATCHER_SMART_DISPATCH_V121===true);
  await page.locator('nav [data-page=orders]').click();
  if(width>=1050)await page.getByRole('button',{name:'Все заявки',exact:true}).click();
  const card=page.locator('#bosOrderList .opsCompactOrder').filter({hasText:'Борис'});
  const smart=card.locator(':scope > .dsd121');
  await expect(smart).toBeVisible();
  await expect(smart.locator('.dsd121Candidate')).toHaveCount(3);
  return {...data,card,smart};
}

async function checkGeometry(card){
  return card.evaluate(card=>{
    const smart=card.querySelector(':scope > .dsd121'),r=card.getBoundingClientRect(),b=smart.getBoundingClientRect(),s=getComputedStyle(card);
    const innerWidth=r.width-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight)-parseFloat(s.borderLeftWidth)-parseFloat(s.borderRightWidth);
    const rect=el=>el.getBoundingClientRect(),nodes=[...smart.querySelectorAll('.dsd121Candidate')];
    const overlap=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;
    const details=[...card.querySelectorAll(':scope > .opsCompactTop,:scope > .opsCompactMain,:scope > .opsCompactAddress,:scope > .opsCompactWorks,:scope > .opsCompactBottom')];
    return {
      fullWidth:Math.abs(b.width-innerWidth)<=2,
      belowDetails:details.every(el=>rect(el).bottom<=b.top+1),
      contentsFit:[...smart.querySelectorAll('.dsd121Head,.dsd121Candidate,.dsd121CandidateCopy,.dsd121CandidateTitle,.dsd121CandidateTitle b,.dsd121Assign')].every(el=>{const x=rect(el);return x.width>0&&x.left>=b.left-1&&x.right<=b.right+1&&el.scrollWidth<=el.clientWidth+1}),
      nonOverlapping:nodes.every((el,i)=>nodes.slice(i+1).every(other=>!overlap(rect(el),rect(other))))&&nodes.every(el=>!overlap(rect(el.querySelector('.dsd121CandidateCopy')),rect(el.querySelector('button')))),
      readableNames:nodes.every(el=>rect(el.querySelector('.dsd121CandidateCopy')).width>=150),
      wholeButtons:nodes.every(el=>{const button=el.querySelector('button');return button.textContent==='Назначить'&&getComputedStyle(button).whiteSpace==='nowrap'&&rect(button).height>=44}),
      pageFits:document.documentElement.scrollWidth<=document.documentElement.clientWidth+1
    };
  });
}
const expected={fullWidth:true,belowDetails:true,contentsFit:true,nonOverlapping:true,readableNames:true,wholeButtons:true,pageFits:true};
for(const [role,width] of [['owner',320],['dispatcher',390],['owner',768],['owner',1024],['owner',1280],['owner',1440],['manager',1670],['dispatcher',1440]]){
  test(`smart recommendations fill their order card for ${role} at ${width}px`,async({page},testInfo)=>{
    const {card,smart}=await setup(page,role,width);
    await expect.poll(()=>checkGeometry(card)).toEqual(expected);
    await expect(smart).toContainText('Александр Константинопольский');
    await expect(smart).toContainText('город совпадает');
    await card.screenshot({path:testInfo.outputPath(`smart-${role}-${width}.png`)});
    // A normal list refresh must not duplicate or squeeze the recommendations again.
    await page.evaluate(()=>refreshBosOrders());
    await expect(card.locator(':scope > .dsd121')).toHaveCount(1);
    await expect.poll(()=>checkGeometry(card)).toEqual(expected);
  });
}

test('full-width smart assignment uses the existing single order update',async({page})=>{
  const {db,master,smart}=await setup(page,'owner',1440);
  const updates=[];
  page.on('request',request=>{if(request.method()==='POST'){try{const b=request.postDataJSON();if(b?.action==='updateOrder')updates.push(b)}catch{}}});
  const best=smart.locator('.dsd121Candidate').first(),time=await best.getAttribute('data-time');
  const bestKey=await best.getAttribute('data-master'),chosen=db.tables.business_staff.find(s=>s.external_id===bestKey);
  expect(chosen).toBeTruthy();
  await best.getByRole('button').click();
  await expect.poll(()=>db.tables.orders[1].master_staff_id).toBe(chosen.id);
  expect(db.tables.orders[1].scheduled_time).toBe(time);
  expect(db.tables.orders[1].amount).toBe(2800);
  expect(db.tables.orders[1].master_payout).toBe(1547);
  expect(updates).toHaveLength(1);
  await expect(page.locator('.dsd121[data-order-id="12"]')).toHaveCount(0);
  await expect(page.locator('#modalRoot .modal')).toHaveCount(0);
});
