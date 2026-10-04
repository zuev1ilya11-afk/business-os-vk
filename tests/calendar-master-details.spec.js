const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const {employee}=require('./helpers/edge.cjs');

async function fixture(page,role='owner',width=1600){
 await page.clock.install({time:new Date('2026-10-01T09:00:00Z')});
 await page.setViewportSize({width,height:1000});
 const data=await fullStack(page,role),{db,master}=data;
 master.full_name='Дмитрий';db.tables.business_staff.find(m=>m.id===master.id).full_name='Дмитрий';
 const masters=[master,...['Филипп','Тимур','Александр','Сергей'].map((name,i)=>employee('m'+(i+2),'master',{full_name:name}))];
 db.tables.business_staff.push(...masters.slice(1),employee('inactive','master',{is_active:false,full_name:'Отключённый мастер'}));
 const types={1:['full','full','full','partial','off'],2:['full','partial','partial','partial','off'],3:['full','partial','off','off','off'],4:['full','full','partial','off','off'],6:['full'],7:['partial','partial','off','off'],8:['full','full','partial','partial']};
 for(const [day,kinds]of Object.entries(types))kinds.forEach((kind,i)=>db.tables.staff_schedule.push({id:`s${day}_${i}`,staff_id:masters[i].id,work_date:`2026-10-${day.padStart(2,'0')}`,is_working:kind!=='off',work_start:kind==='full'?'10:00':kind==='partial'?'14:00':null,work_end:kind==='off'?null:'20:00'}));
 const base={...db.tables.orders[0],scheduled_date:'2026-10-01',scheduled_time:'10:00',time_slot:'10:00–11:00'};
 db.tables.orders=[0,0,1,2,3,null].map((i,j)=>({...base,id:String(101+j),master_staff_id:i===null?null:masters[i].id,master_name:i===null?'':masters[i].full_name,client:'Клиент '+j}));
 db.tables.orders[3].status='Выполнена';
 db.tables.orders.push({...base,id:'199',status:'Отменена'});
 return {...data,masters};
}
async function openCalendar(page){
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 await page.waitForFunction(()=>window.BOS_UNIFIED_SCHEDULE_V102);
 await page.locator('nav [data-page="dispatch"]').click();
 await expect(page.locator('.usManagement')).toBeVisible();
}
const cell=(page,day)=>page.locator(`.usTeamDay[data-date="2026-10-${String(day).padStart(2,'0')}"]`);

for(const [role,width]of [['owner',1600],['dispatcher',390]])test(`${role}: monthly calendar shows every master, majority colors and correct order details`,async({page})=>{
 const {db}=await fixture(page,role,width);await openCalendar(page);
 for(const [day,kind]of [[1,'full'],[2,'partial'],[3,'off'],[4,'partial'],[5,'unknown'],[6,'full'],[7,'partial'],[8,'partial']])await expect(cell(page,day)).toHaveClass(new RegExp(`\\b${kind}\\b`));
 const first=cell(page,1);await expect(first.locator('.usPerson')).toHaveCount(5);
 await expect(first.locator('.usDayCount')).toHaveText('6 заяв.');
 expect(await first.locator('.usPersonCount').allTextContents()).toEqual(['2','1','1','1','0']);
 expect(await first.locator('.usPersonTime').allTextContents()).toEqual(['10–20','10–20','10–20','14–20','вых.']);
 await expect(first).not.toContainText('Отключённый мастер');await expect(first.locator('.usOtherOrders')).toHaveText('Другие: 1');
 await expect(cell(page,5).locator('.usPerson.unknown')).toHaveCount(5);await expect(cell(page,5).locator('.usDayCount')).toHaveText('0 заяв.');
 if(width===1600){expect((await cell(page,8).boundingBox()).height).toBeLessThanOrEqual(165);expect(await page.locator('.usMonthScroll').evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1)}
 await first.locator('.usPerson').first().focus();await page.keyboard.press('Enter');
 await expect(page.locator('#modalRoot')).toContainText('Заявки мастера');await expect(page.locator('#modalRoot .usTime')).toHaveText('10:00–20:00');await expect(page.locator('#modalRoot [data-schedule-order]')).toHaveCount(2);
 await expect(page.locator('#modalRoot')).not.toContainText('Клиент 2');await page.locator('[data-schedule-order="101"]').click();
 await expect(page.locator('#modalRoot')).toContainText('Клиент 0');await page.evaluate(()=>closeModal());
 await first.locator('.usDayHead').click();await expect(page.locator('#modalRoot .usMasterRow')).toHaveCount(5);
 await expect(page.locator('#modalRoot [data-schedule-order]')).toHaveCount(6);await expect(page.locator('#modalRoot')).not.toContainText('№ 199');await page.evaluate(()=>closeModal());
 // Live refresh must update the day color and counts, not leave a stale visual.
 await first.locator('.usPerson').first().focus();await page.evaluate(()=>window.__calendarFocus=document.activeElement);
 const secondMasterRow=db.tables.staff_schedule.find(r=>r.staff_id==='m2'&&r.work_date==='2026-10-01');secondMasterRow.is_working=false;
 db.tables.orders=db.tables.orders.filter(o=>o.id!=='101');await page.evaluate(()=>BOS_REFRESH_NOW());
 expect(await page.evaluate(()=>window.__calendarFocus.isConnected&&window.__calendarFocus===document.activeElement)).toBe(true);
 await expect(first).toHaveClass(/partial/);await expect(first.locator('.usDayCount')).toHaveText('5 заяв.');
 await page.locator('.usMonthHead button').last().click();await expect(page.locator('.usMonthHead h3')).toContainText('ноябрь');
 await expect(page.locator('.usTeamDay')).toHaveCount(30);await page.locator('.usMonthHead button').first().click();await expect(first.locator('.usDayCount')).toHaveText('5 заяв.');
 for(const width of [320,390,1280]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);await expect(first.locator('.usPerson').last()).toBeVisible()}
 const scroller=page.locator('.usMonthScroll'),sunday=cell(page,4).locator('.usDayHead');
 await expect(async()=>{await scroller.evaluate(el=>el.scrollLeft=el.scrollWidth);await sunday.scrollIntoViewIfNeeded();
 const geometry=await sunday.evaluate(el=>{const parent=el.closest('.usMonthScroll'),box=el.getBoundingClientRect(),frame=parent.getBoundingClientRect();return {scroll:parent.scrollLeft,left:box.left-frame.left,right:frame.right-box.right,frameRight:frame.right,viewport:innerWidth}});
 expect(geometry.scroll).toBeGreaterThan(0);expect(geometry.left).toBeGreaterThanOrEqual(0);expect(geometry.right).toBeGreaterThanOrEqual(0);expect(geometry.frameRight).toBeLessThanOrEqual(geometry.viewport);}).toPass({timeout:3000});
 await sunday.click();await expect(page.locator('#modalRoot .usMasterRow')).toHaveCount(5);await page.evaluate(()=>closeModal());
 expect(db.calls.filter(c=>['orders','staff_schedule'].includes(c.table)&&['update','insert','upsert','delete'].includes(c.mode))).toHaveLength(0);
});

test('distinct masters with the same name keep their own schedules and counts',async({page})=>{
 const {db,masters}=await fixture(page);
 db.tables.business_staff.find(m=>m.id===masters[1].id).full_name='Дмитрий';
 // A schedule record ID must never be mistaken for its master's ID.
 db.tables.staff_schedule.unshift({id:masters[0].id,staff_id:'m5',work_date:'2026-10-01',is_working:false});
 db.tables.orders[0].master_name='Филипп';
 await openCalendar(page);
 const first=cell(page,1);await expect(first.locator('.usPerson')).toHaveCount(5);
 expect(await first.locator('.usPersonName').allTextContents()).toEqual(['Дмитрий','Дмитрий','Тимур','Александр','Сергей']);
 expect(await first.locator('.usPersonCount').allTextContents()).toEqual(['2','1','1','1','0']);
 await expect(first.locator('.usPerson').first()).toContainText('10–20');
 // Compact labels must keep nonzero minutes and the full name accessible.
 await page.evaluate(()=>{const r=state.masterSchedule.find(r=>r.staff_id==='m2'&&r.work_date==='2026-10-01');r.work_start='10:30';r.work_end='19:45';show('dispatch')});
 await expect(first.locator('.usPersonTime').nth(1)).toHaveText('10:30–19:45');
 await expect(first.locator('.usPerson').nth(1)).toHaveAccessibleName(/Дмитрий.*10:30–19:45/);
 // Legacy orders with a master alias still match, even without the staff FK.
 await page.evaluate(()=>{const o=state.orders.find(o=>o.id==='101');o.master_staff_id=null;show('dispatch')});
 await expect(first.locator('.usPersonCount').first()).toHaveText('2');
});

test('large teams and an empty team do not hide masters or turn missing schedules into days off',async({page})=>{
 const {db}=await fixture(page,'owner',390);
 for(let i=6;i<=20;i++)db.tables.business_staff.push(employee('m'+i,'master',{full_name:i===20?'Александр Константинопольский — монтажник':'Мастер '+i}));
 await openCalendar(page);await expect(cell(page,1).locator('.usPerson')).toHaveCount(20);
 await expect(cell(page,1).locator('.usPerson').last()).toContainText('Александр Константинопольский');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 db.tables.business_staff=db.tables.business_staff.filter(m=>m.role!=='master');await page.evaluate(()=>BOS_REFRESH_NOW());
 await expect(cell(page,1)).toHaveClass(/unknown/);await expect(cell(page,1)).toContainText('Мастеров пока нет');
 await expect(cell(page,1).locator('.usDayCount')).toHaveText('6 заяв.');
});
