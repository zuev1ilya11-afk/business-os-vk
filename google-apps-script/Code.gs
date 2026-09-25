const LEGACY_VERSION='2026-09-24-disabled';

function doGet(e){
  const params=e&&e.parameter?e.parameter:{};
  const cb=safeCallback_(params.callback||'callback');
  const action=String(params.action||'health');
  if(action==='health'){
    return jsonp_(cb,{ok:true,mode:'disabled-legacy',version:LEGACY_VERSION});
  }
  return jsonp_(cb,{ok:false,error:'LEGACY_ENDPOINT_DISABLED'});
}

function round2_(n){
  return Math.round(Number(n||0)*100)/100;
}

function masterPayout_(amount){
  const n=Number(amount||0);
  return round2_(n*0.85*0.65);
}

function managerPayout_(amount){
  const n=Number(amount||0);
  return round2_(n*0.85*0.94*0.20);
}

function dispatcherPayout_(amount){
  const n=Number(amount||0);
  return round2_(n*0.85*0.94*0.15);
}

function safeCallback_(v){
  return /^[A-Za-z_$][0-9A-Za-z_$\.]*$/.test(String(v||''))?String(v):'callback';
}

function jsonp_(cb,obj){
  return ContentService
    .createTextOutput(cb+'('+JSON.stringify(obj)+');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}
