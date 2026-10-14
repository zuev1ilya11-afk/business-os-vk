const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
test('real PostgreSQL seed is repeatable, retains edits, and exposes no anonymous write access',async()=>{
 const db=new PGlite();try{
 await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
 const schema=fs.readFileSync('deploy/help-editor/schema.sql','utf8'),seed=fs.readFileSync('deploy/help-editor/seed.sql','utf8');
 await db.exec(schema);await db.exec(seed);let rows=(await db.query('select * from master_help_materials')).rows;assert.equal(rows.length,31);
 const id=rows.find(r=>r.kind==='faq').id;await db.query("update master_help_materials set content=jsonb_set(content,'{answer}','\"Правка руководителя\"'),version=2 where id=$1",[id]);
 await db.exec(schema);await db.exec(seed);rows=(await db.query('select * from master_help_materials')).rows;
 assert.equal(rows.length,31);assert.equal(rows.find(x=>x.id===id).content.answer,'Правка руководителя');
 assert.ok(!JSON.stringify(rows).includes('Как и кому оплачивать?'));assert.ok(!JSON.stringify(rows).includes('Можно в следующий раз вызвать вас напрямую?'));
 for(const role of ['anon','authenticated']){
 await db.exec('set role '+role);await assert.rejects(db.query('select * from master_help_materials'),/permission denied/);await assert.rejects(db.query("update master_help_materials set version=999"),/permission denied/);await db.exec('reset role');}
 const results=await Promise.all([3,4].map(v=>db.query('update master_help_materials set version=$1 where id=$2 and version=2 returning id',[v,id])));assert.equal(results.filter(r=>r.rows.length===1).length,1);
 }finally{await db.close()}
});
test('actual signed-session API persists across database restart; stale devices cannot overwrite',async()=>{
 const os=require('node:os'),path=require('node:path');const {edge,employee}=require('./helpers/edge.cjs'),{postgresAdapter}=require('./helpers/help-postgres.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bos-help-pg-'));let db=new PGlite(dir);
 try{
 await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create table business_staff(id text primary key,external_id text,role text,is_active boolean);');
 for(const role of ['owner','manager','master']){const u=employee(role,role);await db.query('insert into business_staff values($1,$2,$3,true)',[u.id,u.external_id,u.role])}
 await db.exec(fs.readFileSync('deploy/help-editor/schema.sql','utf8'));await db.exec(fs.readFileSync('deploy/help-editor/seed.sql','utf8'));
 let call=edge('master-memo-api',postgresAdapter(db));const p={action:'help_save',id:'test-persist',kind:'faq',version:0,content:{id:'test-persist',question:'Сохраняется после перезапуска?',answer:'Да, на сервере',category:'work'}};
 assert.equal((await call(p)).status,200);await db.close();db=new PGlite(dir);call=edge('master-memo-api',postgresAdapter(db));
 const read=await call({action:'help_list'},'staff_master');assert.equal(read.status,200);assert.equal(read.body.items.find(x=>x.id===p.id).content.answer,'Да, на сервере');
 const rs=await Promise.all(['owner','manager'].map(role=>call({...p,version:1,content:{...p.content,answer:role}},employee(role,role).external_id)));
 assert.deepEqual(rs.map(r=>r.status).sort(),[200,409]);assert.equal((await call({...p,id:'forbidden',content:{...p.content,id:'forbidden'}},'staff_master')).status,403);
 await db.exec(fs.readFileSync('deploy/help-editor/seed.sql','utf8'));assert.equal((await db.query('select count(*)::int as n from master_help_materials')).rows[0].n,32);
 }finally{await db.close();fs.rmSync(dir,{recursive:true,force:true})}
});
