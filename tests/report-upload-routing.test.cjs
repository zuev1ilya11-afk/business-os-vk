const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('master report submit keeps the working chunked report-api uploader',()=>{
  const chunk=fs.readFileSync('report-chunk-upload-v23.js','utf8');
  const mobileFix=fs.readFileSync('report-upload-fix-v27.js','utf8');
  const api=fs.readFileSync('supabase/functions/report-api/index.ts','utf8');

  assert.match(chunk,/functions\/v1\/report-api/);
  assert.match(chunk,/action:'uploadReportFile'/);
  assert.match(chunk,/action:'finalizeMasterReport'/);
  assert.match(api,/uploadReportFile/);
  assert.match(api,/finalizeMasterReport/);

  // The later mobile/layout patch must not replace the chunk uploader with
  // the removed report-file-upload route.
  assert.doesNotMatch(mobileFix,/form\.onsubmit\s*=\s*e=>submit\(e,id\)/);
  assert.match(mobileFix,/form\.classList\.add\('reportFixedV27'\)/);
});
