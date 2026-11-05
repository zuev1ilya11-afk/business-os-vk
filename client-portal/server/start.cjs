'use strict';
// Production entry point. No imports from staging, no synthetic schema/credentials,
// no test delivery. Migrations are a separately approved release operation.
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {createPortal,configCheck,openDatabase}=require('./api.cjs');
async function start(){
 if(process.env.NODE_ENV!=='production')throw Error('Use the isolated staging launcher for development');
 const required=name=>{const value=process.env[name];if(!value)throw Error('Missing configuration: '+name);return value};
 const legal=JSON.parse(await fs.readFile(required('CLIENT_LEGAL_FILE'),'utf8'));
 const config={environment:'production',isolated:false,origin:required('CLIENT_ORIGIN'),databaseUrl:required('CLIENT_DATABASE_URL'),databaseTls:process.env.CLIENT_DATABASE_TLS!=='local',privateDir:required('CLIENT_PRIVATE_DIR'),otpPepper:required('CLIENT_OTP_PEPPER'),staffSecret:required('VK_APP_SECRET'),smsTransport:required('CLIENT_SMS_TRANSPORT'),smsGatewayUrl:required('CLIENT_SMS_GATEWAY_URL'),smsGatewayToken:required('CLIENT_SMS_GATEWAY_TOKEN'),smsDailyLimit:Number(required('CLIENT_SMS_DAILY_LIMIT')),smsCostKopecks:Number(required('CLIENT_SMS_MAX_PRICE_KOPECKS')),smsBudgetKopecks:Number(required('CLIENT_SMS_DAILY_BUDGET_KOPECKS')),staffOrigins:JSON.parse(process.env.CLIENT_STAFF_ORIGINS||'[]'),trustedProxyAddresses:JSON.parse(process.env.CLIENT_TRUSTED_PROXY_ADDRESSES||'[]'),legalDocuments:legal.documents,operator:legal.operator,onError:e=>process.stderr.write(JSON.stringify({service:'client-api',event:'request_error',...e})+'\n')};
 configCheck(config);
 if(!path.isAbsolute(config.privateDir))throw Error('Absolute private storage path required');
 const dbUrl=new URL(config.databaseUrl);if(config.databaseTls===false&&!['localhost','127.0.0.1','[::1]'].includes(dbUrl.hostname))throw Error('Unencrypted PostgreSQL allowed only over local loopback');
 if(!config.trustedProxyAddresses.every(x=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(x)))throw Error('Only local reverse proxy is supported');
 const db=await openDatabase(config);const version=await db.query('select max(version) as version from client_schema_version');if(Number(version.rows[0].version)!==5)throw Error('Apply reviewed client migrations before starting API');
 const portal=await createPortal({db,config});const server=http.createServer(portal.handler);server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;const port=Number(process.env.CLIENT_API_PORT||4181);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid API port');
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
 process.stdout.write('Client API started on loopback; external delivery uses configured gateway.\n');
 for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>server.close(()=>db.close().then(()=>process.exit(0))));
 return {server,db};
}
if(require.main===module)start().catch(e=>{process.stderr.write('Client API startup refused: '+e.message+'\n');process.exitCode=1});
module.exports={start};
