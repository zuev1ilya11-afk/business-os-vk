// Reproduce schema fingerprints in a disposable PostgreSQL engine, never production.
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(process.env.BOS_PGLITE_MODULE||'@electric-sql/pglite');
const {schema}=require('../../tests/helpers/lemana-schema.cjs');
(async()=>{const db=new PGlite();const dir=path.join(__dirname,'package');try{
 await db.exec(schema);await db.exec(fs.readFileSync('supabase/migrations/20261020140000_manual_order_intake.sql','utf8'));
 await db.exec(fs.readFileSync(path.join(dir,'migration.sql'),'utf8'));
 const value=(await db.query(fs.readFileSync(path.join(dir,'schema.sql'),'utf8'))).rows[0].json_build_object;
 fs.writeFileSync(path.join(dir,'schema-expected.json'),JSON.stringify(value,null,2)+'\n');
 await db.exec(fs.readFileSync(path.join(dir,'pause.sql'),'utf8'));
 const pause=(await db.query(fs.readFileSync(path.join(dir,'pause-schema.sql'),'utf8'))).rows[0].json_build_object;
 fs.writeFileSync(path.join(dir,'pause-expected.json'),JSON.stringify(pause,null,2)+'\n');
 console.log('Schema and pause fingerprints generated on synthetic database');
}finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
