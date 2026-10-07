import {readFile} from 'node:fs/promises';
import {createHmac,timingSafeEqual} from 'node:crypto';
const origin='http://127.0.0.1:9000';
let phase='ready',status=null;
async function request(path,body,session,authorization) {
  const headers={'content-type':'application/json'};
  if(session)headers['x-bos-session']=session;
  if(authorization)headers.authorization=authorization;
  const r=await fetch(origin+path,{method:body?'POST':'GET',headers,
    body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(25000)});
  status=r.status;
  return {status:r.status,body:await r.json()};
}
function check(ok){if(!ok)throw Error('probe assertion failed')}
function checkSession(token,fixture,secret) {
  const p=String(token||'').split('.');check(p.length===3&&p[0]===fixture.external_id&&Number(p[1])>Date.now()/1000);
  const expected=createHmac('sha256',secret).update(p[0]+'.'+p[1]).digest();
  const actual=Buffer.from(p[2],'base64url');check(actual.length===expected.length&&timingSafeEqual(actual,expected));
}
try {
  if(process.argv[2]==='--ready') {
    const r=await request('/__bos_ready');check(r.status===200&&r.body.ready===true);
    console.log(JSON.stringify({ready:true}));
  }else{
    const c=JSON.parse(await readFile(process.argv[2],'utf8'));const f=c.fixture;
    phase='jwt_denials';
    for(const slug of c.protected_slugs)for(const auth of [undefined,'Bearer invalid']) {
      const r=await request('/functions/v1/'+slug,{action:'health'},undefined,auth);check(r.status===401);
    }
    phase='bos_anon_denied';
    let r=await request('/functions/v1/mini-app-api',{action:'bootstrap'});check(r.status===401&&r.body.ok===false);
    phase='bos_bad_password';
    r=await request('/functions/v1/password-session-api',{action:'login',login:f.login,password:f.password+'x'});
    check(r.status===401&&r.body.ok===false);
    phase='bos_password_login';
    r=await request('/functions/v1/password-session-api',{action:'login',login:f.login,password:f.password});
    check(r.status===200&&r.body.ok===true&&r.body.user?.id===f.id);
    const session=r.body.session_token;checkSession(session,f,c.vk_secret);
    phase='bos_session_refresh';
    r=await request('/functions/v1/password-session-api',{action:'refresh'},session);
    check(r.status===200&&r.body.ok===true&&r.body.user?.id===f.id);checkSession(r.body.session_token,f,c.vk_secret);
    phase='bos_invalid_session_denied';
    r=await request('/functions/v1/mini-app-api',{action:'bootstrap'},session+'x');check(r.status===401);
    phase='bos_bootstrap';
    r=await request('/functions/v1/mini-app-api',{action:'bootstrap'},session);
    check(r.status===200&&r.body.ok===true&&r.body.user?.id===f.id&&r.body.orders?.length===114);
    const containsSecret=x=>x&&typeof x==='object'&&(Object.keys(x).some(k=>k==='password_hash'||k==='password')||Object.values(x).some(containsSecret));
    check(!containsSecret(r.body));
    console.log(JSON.stringify({jwt_required_denied:c.protected_slugs.length,bos_anon_denied:true,
      bos_bad_password_denied:true,bos_password_login:true,bos_session_refresh:true,
      bos_signature_verified:true,bos_invalid_session_denied:true,bos_bootstrap_orders:114,
      bos_credentials_hidden:true}));
  }
}catch{
  console.log(JSON.stringify({phase,http:status}));process.exitCode=1;
}
