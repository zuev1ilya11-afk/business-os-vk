const {test}=require('node:test');
const assert=require('node:assert/strict');
const {edge,database,employee,attachmentUrl}=require('./helpers/edge.cjs');

for(const [mime,extension] of [['image/jpeg','jpg'],['image/png','png'],['image/webp','webp'],['application/pdf','pdf'],['IMAGE/JPEG','jpg']]){
 test(`Drive archive uses ${extension} for ${mime} act, measurement and photo without changing bytes`,async()=>{
  const bytes=Buffer.from([0,1,2,128,254,255]);
  const db=database({business_staff:[employee('d','dispatcher')],orders:[{
   id:'o',status:'В работе',report_review_status:'pending',updated_at:'2026-09-30',report_type:'measurement',
   report_upload_token:'r1',report_uploaded_at:'2026-09-30',
   report_act_url:attachmentUrl('o','r1','act.pdf'),report_measurement_url:attachmentUrl('o','r1','measurement.pdf'),
   report_photo_urls:JSON.stringify([attachmentUrl('o','r1','photo.jpg')])
  }]});
  let sent;
  const result=await edge('drive-archive-api',db,{fetch:async(url,init)=>{
   if(String(url).startsWith('https://script.google.com/')){
    sent=new URLSearchParams(init.body);
    return Response.json({ok:true,drive_folder_url:'https://drive.test/report'});
   }
   return new Response(bytes,{headers:{'Content-Type':mime+'; charset=binary'}});
  }})({order_id:'o',expected_report_token:'r1',expected_report_uploaded_at:'2026-09-30'},'staff_d');
  assert.equal(result.status,200);
  assert.equal(sent.get('act_name'),'act.'+extension);
  assert.equal(sent.get('measurement_name'),'measurement.'+extension);
  const photo=JSON.parse(sent.get('photos_json'))[0];
  assert.equal(photo.name,'photo_1.'+extension);
  for(const encoded of [sent.get('act_data'),sent.get('measurement_data'),photo.data])assert.deepEqual(Buffer.from(encoded,'base64'),bytes);
  assert.equal(sent.get('act_mime'),mime+'; charset=binary');
  assert.equal(db.tables.orders[0].report_review_status,'pending');
 });
}
