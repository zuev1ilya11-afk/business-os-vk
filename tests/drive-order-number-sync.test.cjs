const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {createHash,createHmac}=require('node:crypto');
const {edge,database,employee,secret}=require('./helpers/edge.cjs');

test('Drive archive uses the same visible Hands order number as the app',async()=>{
  const db=database({
    business_staff:[employee('d','dispatcher')],
    orders:[{
      id:'uuid-1',
      external_id:'hands:1644',
      report_uploaded_at:'2026-09-21T10:00:00Z',
      report_type:'work',
      report_upload_token:'audit',
      report_act_url:'https://files.test/act.pdf',
      report_photo_urls:JSON.stringify(['https://files.test/photo.jpg'])
    }]
  });
  let archived=false;
  const fetch=async(url,init={})=>{
    if(String(url).startsWith('https://files.test/'))return new Response('file',{status:200,headers:{'content-type':String(url).endsWith('.pdf')?'application/pdf':'image/jpeg'}});
    if(String(url).startsWith('https://script.google.com/')){
      archived=true;
      const p=new URLSearchParams(init.body);
      assert.equal(p.get('order_id'),'uuid-1');
      assert.equal(p.get('order_no'),'1644');
      const signingKey=createHash('sha256').update(secret).digest('hex');
      const expected=createHmac('sha256',signingKey).update(`${p.get('archive_ts')}|uuid-1|audit|1644`).digest('base64url');
      assert.equal(p.get('order_no_sign'),expected);
      return new Response(JSON.stringify({ok:true,order_id:'uuid-1',order_no:'1644',drive_folder_id:'folder-1644',drive_folder_url:'https://drive.test/1644'}),{status:200,headers:{'content-type':'application/json'}});
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  const r=await edge('drive-archive-api',db,{fetch})({order_id:'uuid-1'},'staff_d');
  assert.equal(r.status,200);
  assert.equal(r.body.drive_order_no,'1644');
  assert.ok(archived);
});

test('Drive bridge renames a legacy internal-id folder to the app order number',()=>{
  const source=fs.readFileSync('google-apps-script/ReportUpload.gs','utf8');
  const folder={name:'Заявка uuid-1',setName(name){this.name=name;return this}};
  const iterator=items=>{let i=0;return{hasNext:()=>i<items.length,next:()=>items[i++]}};
  const root={
    getFoldersByName(name){
      if(name==='Заявка 1644')return iterator([]);
      if(name==='Заявка uuid-1')return iterator([folder]);
      return iterator([]);
    },
    createFolder(name){throw new Error(`Should rename legacy folder, not create ${name}`)}
  };
  const result=vm.runInNewContext(source+';reportOrderFolder_("1644","uuid-1")',{DriveApp:{getFolderById:()=>root}});
  assert.equal(result,folder);
  assert.equal(folder.name,'Заявка 1644');
});
