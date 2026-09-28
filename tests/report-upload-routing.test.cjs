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

  // A transient first HTTP 500 must not force the master to submit the whole
  // report for a second time. Drop the remembered report route and continue
  // through the direct fallback in the same submit attempt.
  assert.match(chunk,/status===500/);
  assert.ok(chunk.includes("clearPreferredTarget?.('report-api')"));
  assert.ok(chunk.includes('if(url===REPORT_PROXY)break'));

  // The later mobile/layout patch must not replace the chunk uploader with
  // the removed report-file-upload route.
  assert.doesNotMatch(mobileFix,/form\.onsubmit\s*=\s*e=>submit\(e,id\)/);
  assert.match(mobileFix,/form\.classList\.add\('reportFixedV27'\)/);
});
