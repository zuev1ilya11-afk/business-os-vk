// Cold backup/restore of the EXISTING partial PGlite preview. Not a production dump.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {previewDatabase}=require('../../tests/helpers/intake-preview-db.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function checkTarget(root){
 if(!path.isAbsolute(root)||!path.basename(root).startsWith('bos-staging-')||fs.existsSync(root)||
    fs.realpathSync(path.dirname(root))!==path.dirname(root)||
    ![os.tmpdir(),'/workspace/scratch'].some(p=>root.startsWith(p+path.sep)))throw Error('NEW_SCRATCH_TARGET_REQUIRED');
}
function seeds(){
 const base={client:'Синтетический клиент',phone:null,address:'Тестовый адрес',city:'Тестовый город',
  work:'Монтаж шторы',amount:2000,original_amount:2000,source:'Лемана Про',external_source:'staging-fixture',
  work_items:[{name:'Монтаж шторы',quantity:2,unit:'шт.'}],received_date:'2026-10-30',status:'Новая'};
 const cases=[{}, {status:'Назначена',master_staff_id:'m'},
  {status:'Назначена',master_staff_id:'m',scheduled_date:'2026-11-01',scheduled_time:'12:00',master_contact_status:'agreed'},
  {status:'Назначена',master_staff_id:'m',master_contact_status:'waiting_delivery'},
  {status:'Назначена',master_staff_id:'m',scheduled_date:'2026-10-01'},
  {status:'В работе',master_staff_id:'m',report_review_status:'pending'},
  {status:'Выполнена',master_staff_id:'m',report_review_status:'approved'},
  {received_date:'2026-09-01'}, {received_date:null}];
 return cases.map((fields,i)=>({...base,...fields,external_id:'staging-'+i,order_number:'TEST-'+(i+1)}));
}
async function seed(db){
 for(const row of seeds()){
  const found=await db.from('orders').select('id').eq('external_source',row.external_source).eq('external_id',row.external_id).maybeSingle();
  if(found.error)throw Error('SEED_LOOKUP_FAILED');
  if(!found.data){const inserted=await db.from('orders').insert(row).select('*').single();if(inserted.error)throw Error('SEED_FAILED')}
 }
}
async function rehearse(root){
 checkTarget(root);fs.mkdirSync(root,{mode:0o700});
 const live=path.join(root,'fixture'),backup=path.join(root,'cold-backup'),restored=path.join(root,'restored');
 fs.mkdirSync(live,{mode:0o700});
 let connection;
 try{
  connection=await previewDatabase(path.join(live,'database'));
  await seed(connection.db);await seed(connection.db);
  const before=(await connection.db.from('orders').select('*').order('id')).data;
  if(before.length!==9)throw Error('SEED_DUPLICATED');
  // Entire DB is closed before copying. Never hot-copy a running Postgres directory.
  await connection.pg.close();connection=null;
  fs.mkdirSync(path.join(live,'files'),{mode:0o700});
  const photo=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z9ZkAAAAASUVORK5CYII=','base64');
  fs.writeFileSync(path.join(live,'files','photo.png'),photo,{mode:0o600});
  fs.writeFileSync(path.join(live,'files','act.txt'),'СИНТЕТИЧЕСКИЙ АКТ. Не документ клиента.',{mode:0o600});
  fs.writeFileSync(path.join(live,'test-config.json'),JSON.stringify({environment:'staging-fixture',outbound:false}),{mode:0o600});
  fs.cpSync(live,backup,{recursive:true,errorOnExist:true,force:false});
  // A later change must remain in the original when recovering to another target.
  connection=await previewDatabase(path.join(live,'database'));
  await connection.db.from('orders').update({comment:'created after backup'}).eq('external_id','staging-0');
  await connection.pg.close();connection=null;
  fs.cpSync(backup,restored,{recursive:true,errorOnExist:true,force:false});
  connection=await previewDatabase(path.join(restored,'database'));
  const after=(await connection.db.from('orders').select('*').order('id')).data;
  if(JSON.stringify(before)!==JSON.stringify(after))throw Error('RESTORED_SQL_DIFFERS');
  await connection.pg.close();connection=null;
  for(const name of ['files/photo.png','files/act.txt','test-config.json']){
   if(sha(fs.readFileSync(path.join(backup,name)))!==sha(fs.readFileSync(path.join(restored,name))))throw Error('RESTORED_FILE_DIFFERS');
  }
  connection=await previewDatabase(path.join(live,'database'));
  const original=await connection.db.from('orders').select('*').eq('external_id','staging-0').single();
  if(original.data.comment!=='created after backup')throw Error('RESTORE_OVERWROTE_ORIGINAL');
  await connection.pg.close();connection=null;
  const result={scope:'partial-pglite-fixture-only',rows:9,repeated_seed_no_duplicates:true,cold_backup:true,
   restored_into_separate_target:true,sql_records_equal:true,synthetic_files_and_config_equal:true,
   original_post_backup_change_preserved:true,real_postgres_auth_storage_restore:false};
  fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});return result;
 }finally{if(connection)await connection.pg.close()}
}
if(require.main===module){
 const args=process.argv.slice(2),valid=args.length===4&&args[0]==='--environment'&&args[1]==='staging'&&args[2]==='--workdir';
 if(!valid){console.error('Usage: node deploy/staging/rehearse-data.cjs --environment staging --workdir /tmp/bos-staging-data-UNIQUE');process.exitCode=1}
 else rehearse(path.resolve(args[3])).then(r=>console.log(JSON.stringify(r,null,2))).catch(()=>{console.error('DATA_REHEARSAL_FAILED; inspect local target, never overwrite production');process.exitCode=1});
}
module.exports={checkTarget,rehearse,seeds};
