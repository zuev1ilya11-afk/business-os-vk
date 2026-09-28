const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {spawnSync}=require('node:child_process');
test('build is deterministic, discovers new assets and rejects stale generated files',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bos-build-'));
 try{
  fs.mkdirSync(path.join(root,'scripts'));
  fs.copyFileSync('scripts/build-version.cjs',path.join(root,'scripts/build-version.cjs'));
  const write=(name,text)=>fs.writeFileSync(path.join(root,name),text);
  const read=name=>fs.readFileSync(path.join(root,name),'utf8');
  const run=(...args)=>spawnSync(process.execPath,[path.join(root,'scripts/build-version.cjs'),...args],{cwd:root,encoding:'utf8'});
  const manifest=()=>{const ctx={self:{}};vm.runInNewContext(read('build-version.js'),ctx);return ctx.self.BOS_BUILD};
  write('sw.js',"const BUILD_ID='OLD';");
  write('index.html','<meta name="bos-build-id" content="OLD"><script src="app.js?v=manual"></script>');
  write('app.js','window.app=1;');
  assert.equal(run().status,0);const first=manifest().id;
  assert.ok(read('index.html').includes('app.js?build='+first));
  assert.equal(run('--check').status,0);
  assert.equal(run().status,0);assert.equal(manifest().id,first);
  write('app.js','window.app=2;');
  const stale=run('--check');assert.equal(stale.status,1);
  assert.match(stale.stderr,/Stale build artifact/);assert.match(stale.stderr,/Run npm run build/);
  assert.equal(manifest().id,first,'check must not modify output');
  write('added.js','window.added=true;');
  write('index.html',read('index.html')+'<script src="./added.js"></script>');
  assert.equal(run().status,0);const next=manifest();
  assert.notEqual(next.id,first);assert.ok(next.assets['added.js']);
  assert.ok(read('index.html').includes('./added.js?build='+next.id));
  assert.equal(run('--check').status,0);
  fs.unlinkSync(path.join(root,'build-version.js'));
  assert.equal(run('--check').status,1);assert.equal(run().status,0);
  assert.equal(manifest().id,next.id);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
