// Test-process guard only. Inherited by Playwright's Node driver and workers.
// Chromium additionally uses the unreachable proxy in playwright.config.js.
const net=require('node:net'),dns=require('node:dns');
const local=host=>['localhost','127.0.0.1','::1','[::1]'].includes(String(host||'localhost').toLowerCase());
function denied(){const e=new Error('Offline test: external network disabled');e.code='ENETUNREACH';throw e}
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
 const first=Array.isArray(args[0])?args[0][0]:args[0];
 if(typeof first==='object'){if(first.path)return connect.apply(this,args);if(!local(first.host))denied()}
 else if(typeof first==='number'&&typeof args[1]==='string'&&!local(args[1]))denied();
 else if(typeof first==='string'&&!first.startsWith('/')&&!first.startsWith('\\\\.\\pipe\\'))denied();
 return connect.apply(this,args);
};
const lookup=dns.lookup;dns.lookup=function(host,...rest){if(!local(host))denied();return lookup.call(this,host,...rest)};
const lookupPromise=dns.promises.lookup;dns.promises.lookup=async function(host,...rest){if(!local(host))denied();return lookupPromise.call(this,host,...rest)};
const originalFetch=globalThis.fetch;globalThis.fetch=function(input,...rest){const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(!local(u.hostname))denied();return originalFetch(input,...rest)};
