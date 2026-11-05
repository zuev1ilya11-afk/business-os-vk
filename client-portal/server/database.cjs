'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
async function migrate(db) {
 const exists=await db.query("select to_regclass('public.client_schema_version') as name");
 let version=0;if(exists.rows[0].name){const v=await db.query('select max(version) as version from client_schema_version');version=Number(v.rows[0].version);if(![1,2,3,4,5].includes(version))throw Error('Unsupported client schema version');}
 for(const [target,name] of [[1,'20261105150000_client_portal.sql'],[2,'20261105153000_client_documents.sql'],[3,'20261105154000_client_notification_leases.sql'],[4,'20261105155000_client_price_events.sql'],[5,'20261105160000_client_message_attachments.sql']])if(version<target)await db.exec(await fs.readFile(path.join(__dirname,'../../supabase/migrations',name),'utf8'));
}
async function openDatabase(config) {
 if(config.environment!=='production'){
  if(!config.isolated || !config.dataDir)throw Error('Isolated data directory required');
  const {PGlite}=require('@electric-sql/pglite');return new PGlite(config.dataDir);
 }
 if(!config.databaseUrl)throw Error('Dedicated client database connection required');
 const {Pool}=require('pg');
 const pool=new Pool({connectionString:config.databaseUrl,max:5,ssl:config.databaseTls===false?false:{rejectUnauthorized:true}});
 return {query:(...a)=>pool.query(...a),exec:sql=>pool.query(sql),close:()=>pool.end(),transaction:async fn=>{const c=await pool.connect();try{await c.query('begin');const result=await fn({query:(...a)=>c.query(...a),exec:sql=>c.query(sql)});await c.query('commit');return result}catch(e){await c.query('rollback');throw e}finally{c.release()}}};
}
module.exports={migrate,openDatabase};
