const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {spawnSync}=require('node:child_process');

test('packaging preserves classic script order, excludes duplicates and invalidates changed sources',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bos-bundles-'));
 try{
  fs.mkdirSync(path.join(root,'scripts'));
  for(const name of ['build-version.cjs','bundle-assets.cjs'])fs.copyFileSync('scripts/'+name,path.join(root,'scripts',name));
  const write=(name,text)=>fs.writeFileSync(path.join(root,name),text);
  const read=name=>fs.readFileSync(path.join(root,name),'utf8');
  const run=(...args)=>spawnSync(process.execPath,[path.join(root,'scripts/build-version.cjs'),...args],{cwd:root,encoding:'utf8'});
  const manifest=()=>{const ctx={self:{}};vm.runInNewContext(read('build-version.js'),ctx);return ctx.self.BOS_BUILD};
  write('scripts/startup-assets.json',JSON.stringify({shell:['first.js','second.js']}));
  write('first.js','var calls=[]; function record(value){calls.push(value)}; record("first");');
  write('second.js','record("second"); // final comment without a newline');
  write('late.js','record("late");');
  write('pwa-register.js',"(()=>{const eagerScripts=['./first.js','./late.js'];})();");
  write('sw.js',"const BUILD_ID='OLD';");
  const html='<meta name="bos-build-id" content="OLD">'+['build-version.js','first.js','second.js','pwa-register.js'].map(name=>'<script defer src="'+name+'"></script>').join('');
  write('index.html',html);
  assert.equal(run().status,0);
  const ctx={};vm.runInNewContext(read('startup-shell.bundle.js'),ctx);vm.runInNewContext(read('startup-eager.bundle.js'),ctx);
  assert.equal(JSON.stringify(ctx.calls),JSON.stringify(['first','second','late']));
  const first=manifest();
  assert.ok(first.assets['startup-shell.bundle.js']);assert.ok(first.assets['startup-eager.bundle.js']);
  for(const name of ['first.js','second.js','late.js'])assert.equal(first.assets[name],undefined,'do not precache both source and bundle');
  assert.equal(first.assetBundles['first.js'],'startup-shell.bundle.js');assert.equal(first.assetBundles['late.js'],'startup-eager.bundle.js');
  assert.equal(run('--check').status,0);assert.equal(run().status,0);assert.equal(manifest().id,first.id);
  write('second.js','record("changed");');
  assert.equal(run('--check').status,1);assert.equal(manifest().id,first.id);
  assert.equal(run().status,0);assert.notEqual(manifest().id,first.id);
  const next=manifest().id;
  write('startup-shell.bundle.js','accidentally stale bundle');
  assert.equal(run('--check').status,1);assert.equal(run().status,0);assert.equal(manifest().id,next);
  write('index.html',html.replace('first.js','unknown.js'));
  const invalid=run();assert.equal(invalid.status,1);assert.match(invalid.stderr,/script order differs/);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
