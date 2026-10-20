// A portable preview of the actual application sources. All data stays in memory.
const fs=require('node:fs'),path=require('node:path'),{stripTypeScriptTypes}=require('node:module');
const {database,employee,token}=require('../tests/helpers/edge.cjs');
const {workbook}=require('../tests/helpers/lemana-xlsx.cjs');
const root=path.resolve(__dirname,'..');process.chdir(root);
const read=p=>fs.readFileSync(p,'utf8'),script=s=>'<script>'+s.replace(/<\/script/gi,'<\\/script')+'</script>';
const seed={business_staff:[employee('owner','owner',{full_name:'Владелец · тест',city:'Тестовый город'}),employee('m','master',{full_name:'Тестовый мастер',city:'Тестовый город'})],orders:[
 {id:'11',order_number:'MANUAL-001',source:'Телефон',external_source:'mini_app',client:'Синтетическая ручная заявка',phone:'+79990000001',address:'Тестовый адрес',work:'Тестовая ручная работа',status:'В работе',amount:1250,original_amount:1250,master_payout:321},
 {id:'12',order_number:'OLD-042',source:'Лемана Про',external_source:'lemana_pro',external_id:'OLD-042',client:'Синтетическая существующая заявка',phone:'+79990000002',address:'Тестовый адрес',work:'',status:'Назначена',amount:1000,original_amount:1000,master_staff_id:'m',master_payout:552.5,scheduled_date:'2026-10-21',scheduled_time:'12:30:00'}
]};
// No real login/hash is needed in the portable preview.
seed.business_staff.forEach(x=>{delete x.login;delete x.password_hash});
const row=(number,status='Назначена дата')=>[number,'Синтетический клиент','+79990000003','Тестовый адрес','Тестовая категория',1000,'20.10.2026 10:30','21.10.2026 12:30','','Тестовый мастер',status,'Тестовый магазин'];
const file=Buffer.from(workbook([row('NEW-0042'),row('OLD-042'),row('MANUAL-001'),row('ERROR-001','Неизвестный статус')])).toString('base64');
const shared=['order-payroll.js','order-work-items.js','lemana-import.js','vendor/lemana-xlsx.js'].map(read).join('\n;\n');
const ts=p=>stripTypeScriptTypes(read(p).replace(/^import .*?;\s*/gm,'').replace(/^export /gm,''),{mode:'transform'});
let backend=shared+'\n;const previewHandlers={};\n';
for(const slug of ['mini-app-api','profile-self-api','order-meta-api']){
 const src=read('supabase/functions/'+slug+'/index.ts');
 backend+=`(()=>{const createClient=()=>previewDb;const Deno={env:{get:k=>({VK_APP_SECRET:'audit-test-secret-not-production',SUPABASE_URL:'https://preview.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic'}[k])},serve:fn=>previewHandlers[${JSON.stringify(slug)}]=fn};\n`;
 if(src.includes('hands-details.ts'))backend+=ts('supabase/functions/_shared/hands-details.ts');
 if(src.includes('lemana-api.ts'))backend+=ts('supabase/functions/_shared/lemana-api.ts');
 backend+=ts('supabase/functions/'+slug+'/index.ts')+'\n})();\n';
}
const bootstrap=`(()=>{
 window.BOS_LOCAL_DEV=true;window.BOS_LOAD_ROLE_MODULES=async()=>true;window.vkBridge={send:async()=>({})};
 const previewDb=(${database.toString()})(${JSON.stringify(seed)});${backend}
 const originalRpc=previewDb.rpc;previewDb.rpc=async(name,p)=>{if(name!=='bos_import_lemana_order')return originalRpc(name,p);
 if(BOS_LEMANA_IMPORT.classify(p.p_order.order_number,previewDb.tables.orders).kind!=='new')return {data:{kind:'skipped'},error:null};
 const order={id:String(Date.now())+'-'+previewDb.tables.orders.length,...structuredClone(p.p_order)};previewDb.tables.orders.push(order);return {data:{kind:'created',order},error:null};};
 localStorage.setItem('bos_vk_session_v2',${JSON.stringify(token('100',4102444800))});sessionStorage.removeItem('bos_vk_session_v2');
 window.fetch=async(input,options={})=>{await new Promise(r=>setTimeout(r,0));const url=new URL(typeof input==='string'?input:input.url,location.href),slug=url.pathname.split('/').pop(),handler=previewHandlers[slug];
 if(!handler)return new Response(JSON.stringify({ok:false,error:'Сервис не включён в автономный предпросмотр'}),{status:404,headers:{'Content-Type':'application/json'}});
 const headers=new Headers(options.headers);headers.set('X-BOS-Session',${JSON.stringify(token('100',4102444800))});return handler(new Request('https://preview.invalid',{...options,method:'POST',headers}));};
 window.BOS_PREVIEW_FILE=()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(file)}),c=>c.charCodeAt(0));const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const a=document.createElement('a');a.href=url;a.download='synthetic-lemana.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
 if(navigator.serviceWorker)navigator.serviceWorker.register=async()=>{throw Error('Offline preview')};
 })();`;
let html=read('index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
html=html.replace(/<link\b[^>]*>/gi,tag=>{const src=/href="([^"?]+)/.exec(tag)?.[1];return /rel="stylesheet"/.test(tag)?'<style>'+read(src)+'</style>':''});
const logo='data:image/svg+xml;base64,'+Buffer.from(read('brand-logo.svg')).toString('base64');
html=html.replace(/brand-logo\.svg\?build=[^"']+/g,logo);
const shell=JSON.parse(read('scripts/startup-assets.json')).shell;
const loader=read('pwa-register.js');
const eager=[...loader.match(/const eagerScripts=\[([\s\S]*?)\];/)[1].matchAll(/'\.\/([^']+\.js)'/g)].map(m=>m[1]);
const roles=[...loader.match(/const roleScripts=\{([\s\S]*?)\n  \};/)[1].matchAll(/'\.\/([^']+\.js)'/g)].map(m=>m[1]);
const sources=[...new Set(['build-version.js',...shell,...eager,...roles,'finance-data.js','finance-expenses.js','finance-page.js'])];
html=html.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="connect-src \'none\'; worker-src \'none\'; frame-src \'none\'; form-action \'none\'; img-src data: blob:;">');
const banner='<aside id="demoBar" style="position:fixed;top:0;left:0;right:0;z-index:1000001;background:#173047;padding:8px;display:flex;gap:8px;flex-wrap:wrap;font:12px sans-serif;color:white"><span>Предпросмотр · синтетические данные · рабочая база не подключена</span><button onclick="openOrderForm()">Форма с количеством</button><button onclick="openLemanaImport()">Импорт</button><button onclick="BOS_PREVIEW_FILE()">Скачать тестовый XLSX</button></aside><style>body{padding-top:70px!important}#demoBar button{font:12px sans-serif;padding:5px 9px;min-height:30px}#modalRoot .modal{margin-top:75px;max-height:calc(100dvh - 95px)!important}@media(max-width:520px){body{padding-top:130px!important}#modalRoot .modal{margin-top:130px;max-height:calc(100dvh - 150px)!important}}</style>';
html=html.replace('</body>',()=>banner+script(bootstrap)+sources.map(n=>script(read(n))).join('\n')+script("addEventListener('load',()=>setTimeout(()=>{show('orders');},50));")+'</body>');
fs.mkdirSync('docs/lemana',{recursive:true});fs.writeFileSync('docs/lemana/preview.html',html);
console.log('Built docs/lemana/preview.html from '+sources.length+' actual application scripts');
