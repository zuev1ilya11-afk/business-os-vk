// Execute the exact packaged HTTP checks against the packaged API and real
// disk-backed PostgreSQL locally. Docker launch remains a server-side gate.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),vm=require('node:vm');
const {execFileSync,spawn}=require('node:child_process'),{stripTypeScriptTypes}=require('node:module'),{webcrypto}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite'),{postgresAdapter}=require('../../tests/helpers/help-postgres.cjs');
const root=__dirname,secret='isolated-local-fixture-key-not-production';
function runPython(file,phase){return new Promise((resolve,reject)=>{const p=spawn('python3',[file],{stdio:['pipe','pipe','pipe']});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('exit',code=>code===0?resolve(JSON.parse(out)):reject(Error('Probe '+phase+' failed: '+err)));p.stdin.end(JSON.stringify({secret,phase}));})}
test('packaged signed HTTP probes validate CAS, server rights and restart persistence',async()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bos-help-probe-'));let server,pg;
 try{
  execFileSync('python3',['-m','zipfile','-e',path.join(root,'bos293.pyz'),path.join(temporary,'package')]);
  const pkg=path.join(temporary,'package'),sql=n=>fs.readFileSync(path.join(pkg,n),'utf8'),dir=path.join(temporary,'database');
  pg=new PGlite(dir);await pg.exec('create role anon; create role authenticated; create role service_role bypassrls; create table business_staff(id text primary key,external_id text,role text,is_active boolean);');
  for(const role of ['owner','manager','master','dispatcher','inactive'])await pg.query('insert into business_staff values($1,$2,$3,$4)',[role,'preview_'+role,role==='inactive'?'owner':role,role!=='inactive']);
  await pg.exec(sql('schema.sql'));await pg.exec(sql('seed.sql'));
  const code=stripTypeScriptTypes(sql('master-memo-api.ts').replace(/^import .*?;\s*/gm,''),{mode:'transform'});
  async function start(){
   let handle;const adapter=postgresAdapter(pg);
   vm.runInNewContext(code,{createClient:()=>adapter,Deno:{env:{get:k=>({VK_APP_SECRET:secret,SUPABASE_URL:'http://127.0.0.1:9000',SUPABASE_SERVICE_ROLE_KEY:'fixture'}[k])},serve:f=>handle=f},crypto:webcrypto,Request,Response,Headers,URL,URLSearchParams,TextEncoder,TextDecoder,Uint8Array,btoa,atob,console});
   server=http.createServer(async(req,res)=>{try{let body='';for await(const chunk of req)body+=chunk;const result=await handle(new Request('http://127.0.0.1:9000'+req.url,{method:req.method,headers:req.headers,body}));res.writeHead(result.status,Object.fromEntries(result.headers));res.end(await result.text());}catch(e){res.writeHead(500);res.end(JSON.stringify({error:String(e)}));}});
   await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(9000,'127.0.0.1',resolve)});
  }
  await start();const before=await runPython(path.join(pkg,'probe_requests.py'),'before');assert.equal(before.ok,true);assert.equal(before.checks,24);
  await pg.exec(sql('seed.sql'));await new Promise(resolve=>server.close(resolve));server=null;await pg.close();pg=new PGlite(dir);
  await start();const after=await runPython(path.join(pkg,'probe_requests.py'),'after');assert.equal(after.ok,true);assert.equal(after.checks,7);
  console.log('Packaged HTTP checks:',before.checks+after.checks,'passed through actual API and persisted PostgreSQL');
 }finally{if(server)await new Promise(resolve=>server.close(resolve));if(pg)await pg.close();fs.rmSync(temporary,{recursive:true,force:true});}
});
