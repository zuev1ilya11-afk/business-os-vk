const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

test('legacy Apps Script endpoint is health-only and cannot expose owner access',()=>{
  const source=fs.readFileSync('google-apps-script/Code.gs','utf8');
  assert.ok(!source.includes("mode:'public-dev'"));
  assert.ok(!source.includes("role:'owner'"));
  assert.ok(!source.includes('owner-local'));
  assert.ok(!source.includes('createOrder_(user'));
  assert.ok(!source.includes('updateOrder_(user'));

  const responses=[];
  const context={
    ContentService:{
      MimeType:{JAVASCRIPT:'javascript'},
      createTextOutput(text){
        const value={text,setMimeType(){return value;}};
        responses.push(value);
        return value;
      },
    },
  };
  vm.runInNewContext(source,context);
  context.doGet({parameter:{action:'bootstrap',callback:'cb'}});
  assert.match(responses.at(-1).text,/LEGACY_ENDPOINT_DISABLED/);
  context.doGet({parameter:{action:'health',callback:'cb'}});
  assert.match(responses.at(-1).text,/disabled-legacy/);
});
