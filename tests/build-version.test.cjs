const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
test('published shell, worker and every asset share the generated build',()=>{
 const ctx={self:{}};vm.runInNewContext(fs.readFileSync('build-version.js','utf8'),ctx);
 const {id,assets}=ctx.self.BOS_BUILD;
 assert.match(id,/^[a-f0-9]{20}$/);
 const html=fs.readFileSync('index.html','utf8');
 assert.ok(html.includes(`name="bos-build-id" content="${id}"`));
 assert.ok(fs.readFileSync('sw.js','utf8').includes(`const BUILD_ID='${id}';`));
 for(const [name,digest] of Object.entries(assets))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(name)).digest('hex'),digest,name);
 for(const match of html.matchAll(/(?:src|href)="([^"?]+\.(?:js|css))([^\"]*)"/g))assert.equal(match[2],'?build='+id,match[1]);
 const loader=fs.readFileSync('pwa-register.js','utf8');
 assert.ok(loader.includes('script.src=window.BOS_ASSET_URL(src)'));
 assert.ok(!loader.includes('?v='));
});
