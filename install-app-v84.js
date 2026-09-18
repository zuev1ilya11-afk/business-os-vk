(()=>{
'use strict';
if(window.BOS_INSTALL_APP_V84)return;
window.BOS_INSTALL_APP_V84=true;

let deferredPrompt=null;
let syncTimer=null;
let syncAttempt=0;

function isIos(){
  return /iphone|ipad|ipod/i.test(navigator.userAgent)||
    (navigator.platform==='MacIntel'&&Number(navigator.maxTouchPoints||0)>1);
}

function isStandalone(){
  return window.matchMedia?.('(display-mode: standalone)')?.matches===true||
    window.navigator.standalone===true;
}

function closeInstallHelp(){
  document.getElementById('bosInstallHelp')?.remove();
}

function showInstallHelp(){
  closeInstallHelp();
  const overlay=document.createElement('div');
  overlay.id='bosInstallHelp';
  overlay.className='bosInstallHelp';

  const card=document.createElement('div');
  card.className='bosInstallHelpCard';

  const title=document.createElement('h3');
  title.textContent='Установить Business OS';

  const text=document.createElement('p');
  text.textContent=isIos()
    ?'Откройте эту страницу в Safari, нажмите «Поделиться» и выберите «На экран Домой».'
    :'Откройте меню браузера и выберите «Установить приложение» или «Добавить на главный экран».';

  const close=document.createElement('button');
  close.type='button';
  close.className='secondary wide';
  close.textContent='Понятно';
  close.onclick=closeInstallHelp;

  card.append(title,text,close);
  overlay.appendChild(card);
  overlay.addEventListener('click',event=>{if(event.target===overlay)closeInstallHelp()});
  document.body.appendChild(overlay);
}

async function requestInstall(){
  if(isStandalone())return;
  if(deferredPrompt){
    const promptEvent=deferredPrompt;
    deferredPrompt=null;
    try{
      await promptEvent.prompt();
      const choice=await promptEvent.userChoice;
      if(choice?.outcome==='accepted')hideControls();
      else syncControls();
      return;
    }catch(_){
      deferredPrompt=null;
    }
  }
  showInstallHelp();
}

function makeButton(kind){
  const button=document.createElement('button');
  button.type='button';
  button.className=`bosInstallAppBtn bosInstallAppBtn--${kind}`;
  button.dataset.bosInstall='1';
  button.textContent=kind==='header'?'Установить':'Установить приложение';
  button.addEventListener('click',requestInstall);
  return button;
}

function ensureAuthButton(){
  const card=document.querySelector('#authGate .authGateCard');
  if(!card||card.querySelector('.bosInstallAppBtn--auth'))return;
  card.appendChild(makeButton('auth'));
}

function ensureHeaderButton(){
  const header=document.querySelector('#app header');
  const profile=document.getElementById('profileBtn');
  if(!header||!profile||header.querySelector('.bosInstallAppBtn--header'))return;
  header.insertBefore(makeButton('header'),profile);
}

function hideControls(){
  document.querySelectorAll('.bosInstallAppBtn').forEach(button=>{button.hidden=true});
  closeInstallHelp();
}

function syncControls(){
  ensureAuthButton();
  ensureHeaderButton();
  const hide=isStandalone();
  document.querySelectorAll('.bosInstallAppBtn').forEach(button=>{button.hidden=hide});
}

function startSyncRetries(){
  if(syncTimer!==null){
    window.clearTimeout(syncTimer);
    syncTimer=null;
  }
  syncAttempt=0;
  const tick=()=>{
    syncControls();
    syncAttempt+=1;
    if(syncAttempt>=6){
      syncTimer=null;
      return;
    }
    syncTimer=window.setTimeout(tick,Math.min(1200,120*syncAttempt));
  };
  tick();
}

const style=document.createElement('style');
style.textContent=`
.bosInstallAppBtn{border:1px solid rgba(255,255,255,.12);background:rgba(32,164,234,.12);color:inherit;border-radius:10px;padding:8px 11px;font:inherit;font-size:12px;font-weight:700;cursor:pointer}
.bosInstallAppBtn--auth{width:100%;margin-top:10px;padding:11px 14px}
.bosInstallAppBtn--header{margin-left:auto;margin-right:8px;white-space:nowrap}
.bosInstallHelp{position:fixed;inset:0;z-index:1100000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(4,8,14,.76)}
.bosInstallHelpCard{width:min(100%,420px);padding:20px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:#101b2a;box-shadow:0 20px 60px rgba(0,0,0,.4)}
.bosInstallHelpCard h3{margin:0 0 10px}.bosInstallHelpCard p{margin:0 0 16px;line-height:1.5;color:var(--muted,#a9b7c8)}
@media(max-width:520px){.bosInstallAppBtn--header{font-size:0;padding:8px;width:34px;height:34px}.bosInstallAppBtn--header::after{content:'↓';font-size:16px}}
`;
document.head.appendChild(style);

window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault();
  deferredPrompt=event;
  syncControls();
});
window.addEventListener('appinstalled',()=>{
  deferredPrompt=null;
  hideControls();
});
window.addEventListener('pageshow',startSyncRetries);
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden)syncControls();
});

startSyncRetries();
})();
