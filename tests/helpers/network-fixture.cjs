const path=require('node:path');
module.exports=async function openNetworkFixture(page){
 // Transport checks must not count the localhost demo's independent bootstrap.
 await page.route('**/transport-route-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><body>Transport fixture</body></html>'}));
 await page.goto('/transport-route-fixture');
 await page.addScriptTag({path:path.join(__dirname,'..','..','network-direct-v86.js')});
 await page.addScriptTag({path:path.join(__dirname,'..','..','config.js')});
};
