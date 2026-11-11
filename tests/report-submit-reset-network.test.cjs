const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function transport(status){
 const source=fs.readFileSync('report-chunk-upload-v23.js','utf8'),calls=[];
 const context={once:async(url)=>{calls.push(url);if(calls.length===1){const e=new Error('uncertain failure');e.status=status;throw e}return {ok:true}},clearReportRoute(){},clearSession(){},retryable:()=>true,window:{},REPORT_PROXY:'proxy',REPORT_DIRECT:'direct',setTimeout};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('async function request('),source.indexOf('function dataUrl(')),context);
 return {calls,request:context.request};
}
for(const status of [500,502,504,undefined])test(`finalize ${status}: return uncertainty to reconciliation before any transport retry`,async()=>{
 const {calls,request}=transport(status);await assert.rejects(request({action:'finalizeMasterReport'}),/uncertain failure/);assert.deepEqual(calls,['proxy']);
});
test('file upload still uses its existing 500 fallback',async()=>{
 const {calls,request}=transport(500);assert.equal((await request({action:'uploadReportFile'})).ok,true);assert.deepEqual(calls,['proxy','direct']);
});
