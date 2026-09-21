const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

function read(name){return fs.readFileSync(path.join(__dirname,'..',name),'utf8')}

for(const file of ['manager-memo-editor-v45.js','master-memo-runtime-v21.js']){
  test(`${file} supports selecting and uploading multiple memo files`,()=>{
    const src=read(file);
    assert.match(src,/type="file"[^>]*multiple|name="file"[^>]*type="file"[^>]*multiple/);
    assert.match(src,/files=\[\.\.\.form\.elements\.file\.files\]/);
    assert.match(src,/files\.find\(file=>file\.size>10\*1024\*1024\)/);
    assert.match(src,/for\(let i=0;i<files\.length;i\+\+\)/);
    assert.match(src,/file_data:await (?:file64|readFile64)\(file\)/);
  });
}
