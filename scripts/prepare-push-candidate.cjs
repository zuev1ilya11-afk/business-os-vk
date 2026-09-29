// One-time feature-branch preparation. Removed before merge.
const fs=require('node:fs');
const edit=(path,fn)=>fs.writeFileSync(path,fn(fs.readFileSync(path,'utf8')));
edit('index.html',s=>s.includes('<script src="./web-push-v211.js')?s:s.replace(/(<script src="\.\/profile-logout-v96\.js[^\n]*\n)/,'$1<script src="./web-push-v211.js"></script>\n'));
if(!fs.readFileSync('index.html','utf8').includes('<script src="./web-push-v211.js'))throw Error('Push entrypoint missing');
edit('supabase/functions/push-api/index.ts',s=>{
 s=s.replace("'https://business-os-public-xo8i66.v2.appdeploy.ai'","'https://business-os-public-xo8i66.v2.appdeploy.ai','https://business-os-api-gateway.netlify.app'");
 const old="if(request.endpoint!==row.endpoint)throw new Error('INVALID_PUSH_ENDPOINT');";
 const replacement="const endpoint=request.endpoint;\n        if(typeof endpoint!=='string'||endpoint!==row.endpoint||!request.body)throw new Error('INVALID_PUSH_ENDPOINT');\n        const encrypted=new Uint8Array(request.body.byteLength);\n        encrypted.set(request.body);";
 if(s.includes(old))s=s.replace(old,replacement).replace("fetch(request.endpoint,{method:'POST',headers:request.headers,body:request.body,","fetch(endpoint,{method:'POST',headers:request.headers,body:encrypted.buffer,");
 if(!s.includes('body:encrypted.buffer'))throw Error('Sender body integration missing');
 return s;
});
edit('tests/push-api-v211.test.cjs',s=>s.replace("f.sent[0].init.body.toString()","Buffer.from(f.sent[0].init.body).toString()"));
edit('docs/web-push-v211.md',s=>s.replace('`netlify/functions/proxy.mts` and both existing AppDeploy gateways need `push-api` added to their service allowlists. No other routing or authentication behavior changes.','The existing network layer retries explicit gateway service-miss responses against the next candidate, including direct Supabase. Push-specific regressions cover signed-header preservation and no replay of an uncertain test request. Updating live gateway allowlists is optional; no existing gateway is replaced.').replace('3. Add the single service name to each live gateway after reading its current source. Do not replace live handlers with older repository exports.','3. Verify the existing gateway service-miss fallback to the new direct Edge endpoint. Do not replace live gateways or handlers with older repository exports. Allowlist updates may be deployed separately.'));
