const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function runtime({profile=false,preview=false}={}){
  const employee={id:'m',vk_user_id:'staff_m',full_name:'Master',phone:'old'};
  const state={user:{id:'owner',role:'owner'},users:[employee],masters:[{...employee}],orders:[],masterSchedule:[],page:'team'};
  const fresh=structuredClone(state);
  fresh.users[0].phone=fresh.masters[0].phone='new';
  let renderedPhone='old',profilePhone='old';
  const modal=profile?{dataset:{bosEmployeeProfileId:'staff_m'}}:null;
  const ctx={state,previewUser:preview?employee:null,document:{hidden:false,body:{classList:{contains:()=>true}},getElementById:()=>null,querySelector:()=>modal,querySelectorAll:()=>[],addEventListener(){}},setInterval(){},getComputedStyle:()=>({display:'none'}),CustomEvent:class{},api:async()=>({ok:true,...fresh}),show(){renderedPhone=ctx.previewUser?.phone||state.users[0].phone},openEmployeeProfile(){profilePhone=state.users[0].phone},dispatchEvent(){},addEventListener(){},isMasterPreview:()=>preview};
  ctx.window=ctx;
  vm.runInNewContext(fs.readFileSync('employee-live-refresh-v27.js','utf8'),ctx);
  return {ctx,state,fresh,rendered:()=>({renderedPhone,profilePhone})};
}
test('refresh updates both employee modal and underlying team',async()=>{
  const r=runtime({profile:true});
  assert.equal(await r.ctx.BOS_REFRESH_EMPLOYEE_DATA(),true);
  assert.deepEqual(r.rendered(),{renderedPhone:'new',profilePhone:'new'});
});
test('refresh replaces stale master preview employee',async()=>{
  const r=runtime({preview:true});
  await r.ctx.BOS_REFRESH_EMPLOYEE_DATA();
  assert.equal(r.ctx.previewUser.phone,'new');
  assert.equal(r.rendered().renderedPhone,'new');
});
test('refresh does not overwrite a mutation completed while bootstrap was in flight',async()=>{
  const r=runtime();let complete;
  r.ctx.api=()=>new Promise(resolve=>complete=resolve);
  const refresh=r.ctx.BOS_REFRESH_EMPLOYEE_DATA();
  r.state.users[0].phone='saved-later';
  complete({ok:true,...r.fresh});
  await refresh;
  assert.equal(r.state.users[0].phone,'saved-later');
});

test('refresh preserves an unsaved inline dispatch date',async()=>{
  const r=runtime();
  r.ctx.document.querySelectorAll=()=>[{tagName:'INPUT',type:'date',value:'2099-09-12',defaultValue:'2099-09-10'}];
  assert.equal(await r.ctx.BOS_REFRESH_EMPLOYEE_DATA(),false);
  assert.equal(r.state.users[0].phone,'old');
});
test('a default select option does not prevent background refresh',async()=>{
  const r=runtime();
  r.ctx.document.querySelectorAll=()=>[{tagName:'SELECT',value:'all',options:[{value:'all',selected:true,defaultSelected:false}]}];
  assert.equal(await r.ctx.BOS_REFRESH_EMPLOYEE_DATA(),true);
  assert.equal(r.state.users[0].phone,'new');
});
