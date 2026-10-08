const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('report work photos keep inspection-friendly resolution and JPEG quality',()=>{
 const chunk=fs.readFileSync('report-chunk-upload-v23.js','utf8');
 const fallback=fs.readFileSync('master-report-ui-v12.js','utf8');
 assert.match(chunk,/max=photo\?1920:1600/);
 assert.match(chunk,/photo\?\.82:\.78/);
 assert.doesNotMatch(chunk,/max=photo\?800:1000/);
 assert.doesNotMatch(chunk,/photo\?\.42:\.52/);
 assert.match(fallback,/max=photo\?1920:1600/);
 assert.match(fallback,/photo\?\.82:\.78/);
});
