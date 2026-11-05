'use strict';
const http=require('node:http'),path=require('node:path'),fs=require('node:fs/promises');
const {createIntegratedStaging}=require('./integrated.cjs');
(async()=>{
 if(process.env.NODE_ENV==='production')throw Error('The isolated staging launcher cannot run in production');
 const args=process.argv.slice(2),arg=(key,fallback)=>{const n=args.indexOf(key);return n<0?fallback:args[n+1]};
 const port=Number(arg('--port',process.env.BOS_STAGE_PORT||4180)),host=arg('--host','127.0.0.1');
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid port');
 if(!['127.0.0.1','0.0.0.0'].includes(host))throw Error('Unsupported staging bind host');
 // The managed preview daemon is mounted at /site, not a user-supplied Host header.
 const managed=host==='0.0.0.0'&&process.cwd()==='/site'&&port===4173;
 if(host==='0.0.0.0'&&!managed)throw Error('Public binding is forbidden outside the managed isolated preview');
 const origin=managed?'http://terminal.local:4173':`http://127.0.0.1:${port}`;
 const state=path.resolve(__dirname,'../../.client-portal-stage');await fs.mkdir(state,{recursive:true,mode:0o700});
 const stage=await createIntegratedStaging({dataDir:path.join(state,'db'),privateDir:path.join(state,'private'),origin});
 const {startNotificationWorker,createLocalNotificationTransport}=require('../server/notifications.cjs');
 const notifications=startNotificationWorker({db:stage.db,environment:'staging',transport:createLocalNotificationTransport({environment:'staging',isolated:true,privateDir:path.join(state,'private')}),intervalMs:30000});
 const server=http.createServer(async(req,res)=>{try{
  const chunks=[];let size=0;for await(const part of req){size+=part.length;if(size>23*1024*1024){res.writeHead(413);res.end('Too large');return}chunks.push(part)}
  const headers=new Headers();for(const [k,v]of Object.entries(req.headers))if(v!==undefined)headers.set(k,Array.isArray(v)?v.join(','):v);
  // IP is supplied by the trusted local HTTP listener, never an arbitrary forwarded header.
  headers.delete('x-forwarded-for');headers.delete('x-real-ip');headers.set('x-stage-peer-ip',req.socket.remoteAddress||'local');
  const incoming=new Request(origin+req.url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});incoming.portalClientIp=req.socket.remoteAddress||'local';const r=await stage.handle(incoming);
  res.statusCode=r.status;for(const [k,v]of r.headers)if(k!=='set-cookie')res.setHeader(k,v);const cookies=r.headers.getSetCookie();if(cookies.length)res.setHeader('set-cookie',cookies);res.end(Buffer.from(await r.arrayBuffer()));
 }catch(e){console.error('isolated_request_error',e.name);res.statusCode=500;res.end('{"ok":false,"error":"Ошибка изолированной среды"}')}
 });
 server.listen(port,host,()=>console.log('Isolated synthetic client portal ready. Client: /client/ Staff: /staff/; credentials and OTP stay in private local files.'));
 const stop=()=>server.close(async()=>{await notifications.stop();await stage.close();process.exit(0)});process.once('SIGINT',stop);process.once('SIGTERM',stop);
})().catch(e=>{console.error('Staging startup failed:',e.message);process.exitCode=1});
