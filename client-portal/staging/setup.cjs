'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {openDatabase,migrate}=require('../server/database.cjs');
const {passwordHash}=require('./sql-adapter.cjs');
const root=path.resolve(__dirname,'../..');
const migrations=[
 '20260920133158_add_master_workflow_fields.sql','20260923172733_master_workflow_v2_contact_events.sql',
 '20260929160000_capture_live_order_guards.sql','20261001174717_report_uncompleted_items.sql',
 '20261002101000_master_contact_confirmation.sql','20261004100840_manual_order_completion.sql',
 '20261004183000_master_contact_journal.sql','20261004191357_finance_expenses.sql',
 '20261020140000_manual_order_intake.sql','20261020180000_lemana_import_work_items.sql',
 '20261031180000_claim_financial_snapshots.sql'
];
async function setupStaging({dataDir,privateDir,origin='http://127.0.0.1:4180',websiteEnabled=false}){
 if(!dataDir||!privateDir)throw Error('Explicit isolated data and private directories required');
 await fs.mkdir(privateDir,{recursive:true,mode:0o700});
 let credentials;const file=path.join(privateDir,'access.json');
 try{credentials=JSON.parse(await fs.readFile(file,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;credentials={secret:crypto.randomBytes(48).toString('base64url'),otpPepper:crypto.randomBytes(48).toString('base64url'),staff:{}};for(const role of ['owner','manager','dispatcher','master'])credentials.staff[role]={login:'stage_'+role,password:crypto.randomBytes(18).toString('base64url')};await fs.writeFile(file,JSON.stringify(credentials),{mode:0o600,flag:'wx'})}
 const db=await openDatabase({environment:'staging',isolated:true,dataDir});
 const exists=await db.query("SELECT to_regclass('public.stage_migrations') AS name");
 if(!exists.rows[0].name){const other=await db.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'");if(other.rows[0].n)throw Error('Refusing to initialize nonempty database without isolated marker');await db.exec(await fs.readFile(path.join(__dirname,'base.sql'),'utf8'))}
 for(const name of migrations){if((await db.query('SELECT 1 FROM stage_migrations WHERE name=$1',[name])).rows.length)continue;await db.exec(await fs.readFile(path.join(root,'supabase/migrations',name),'utf8'));await db.query('INSERT INTO stage_migrations(name) VALUES($1)',[name])}
 await migrate(db);
 if(websiteEnabled){await require('../server/website-migrate.cjs').migrateWebsite(db);await require('../server/website-seed.cjs').seedWebsite(db);}
 await db.exec('GRANT USAGE ON SCHEMA public TO service_role;GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;');
 const names={owner:'Тестовый владелец',manager:'Тестовый руководитель',dispatcher:'Тестовый диспетчер',master:'Алексей · тестовый мастер'};const ids={};
 for(const [i,role]of ['owner','manager','dispatcher','master'].entries()){
  const id='00000000-0000-4000-8000-'+String(i+1).padStart(12,'0');ids[role]=id;const c=credentials.staff[role];
  await db.query('INSERT INTO business_staff(id,external_id,full_name,role,is_active,phone,city,login,password_hash,specialization) VALUES($1,$2,$3,$4,true,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING',[id,'stage_'+role,names[role],role,'+7999000000'+(i+1),'Санкт-Петербург',c.login,passwordHash(c.password),role==='master'?'Монтаж карнизов и мелкий ремонт':'']);
 }
 const catalog=[['curtain_rod','Карнизы и шторы','Установка карниза','Монтаж с учётом длины, материала стены и высоты.','пог. м'],['curtains','Карнизы и шторы','Навеска штор','Проверим комплектность и согласуем объём работ.','шт.'],['plumbing','Сантехника','Установка сантехники','Опишите оборудование и состояние коммуникаций.','шт.'],['electrical','Электрика','Мелкие электромонтажные работы','Состав работ и стоимость после осмотра.','шт.'],['handyman','Мелкий ремонт','Помощь по дому','Крепления, сборка и другие небольшие задачи.','час']];
 for(const [id,category,name,description,unit]of catalog)await db.query("INSERT INTO client_catalog(id,category,name,description,unit,price_type,price,conditions,city,published,confirmed,available) VALUES($1,$2,$3,$4,$5,'clarify',NULL,'Стоимость после уточнения задачи','Санкт-Петербург',true,false,true) ON CONFLICT(id) DO NOTHING",[id,category,name,description,unit]);
 await db.query('INSERT INTO client_public_masters(staff_id,name,specialization) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[ids.master,'Алексей · тестовый мастер','Карнизы, мелкий ремонт']);
 const config={websiteEnabled,environment:'staging',origin,isolated:true,managedPreview:process.cwd()==='/site'&&origin==='http://terminal.local:4173',otpPepper:credentials.otpPepper,staffSecret:credentials.secret,smsTransport:'test',privateDir,operator:null,legalDocuments:JSON.parse(await fs.readFile(path.join(root,'client-portal/legal/documents.json'),'utf8')).documents};
 return {db,config,credentials,staffIds:ids,close:()=>db.close()};
}
module.exports={setupStaging,migrations};
