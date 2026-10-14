const {test}=require('@playwright/test');
for(const phase of ['order','report','profile'])test('capture actual master screens: '+phase,async({page})=>{
 test.skip(!process.env.BOS_CAPTURE_HELP,'Run explicitly when updating lesson illustrations.');test.setTimeout(60000);
 await require('../scripts/qa/capture-master-help.cjs')(page,phase);
});
