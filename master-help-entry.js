(()=>{
'use strict';
if(window.BOS_MASTER_HELP_ENTRY)return;
window.BOS_MASTER_HELP_ENTRY=true;
let loading=null,active=null,activeBack=null;
// Register before the existing Android navigation module. Its target is window too.
window.addEventListener('popstate',event=>{if(active?.open)activeBack?.(event)},true);
const asset=name=>window.BOS_ASSET_URL?window.BOS_ASSET_URL('./'+name):'./'+name;
function loadFile(name,css=false){return new Promise((resolve,reject)=>{
 const el=document.createElement(css?'link':'script');
 if(css){el.rel='stylesheet';el.href=asset(name)}else{el.src=asset(name);el.async=false}
 el.onload=resolve;el.onerror=()=>{el.remove();reject(new Error('Не удалось загрузить подсказки. Проверьте соединение и повторите.'))};
 document.head.appendChild(el);
})}
function load(){
 if(!loading)loading=Promise.all([loadFile('master-help.css',true),loadFile('master-help-data.js').then(()=>loadFile('master-help-store.js')).then(()=>loadFile('master-help-editor.js')).then(()=>loadFile('master-help.js'))]).catch(e=>{loading=null;throw e});
 return loading;
}
window.openMasterHelp=function(topic='home'){
 if(active?.open){window.BOS_MASTER_HELP_VIEW?.(active,topic);return}
 // Native close events are queued; remove a closed window before immediate reopen.
 if(active){active.remove();active=null;activeBack=null}
 const previous=document.activeElement,position={x:scrollX,y:scrollY},historyState=history.state,historyUrl=location.href;
 const dialog=document.createElement('dialog');dialog.id='bosMasterHelp';dialog.className='bosHelp';dialog.setAttribute('aria-label','Подсказки по работе');
 // Basic loading presentation remains usable even if the stylesheet fails.
 dialog.style.cssText='background:#101d30;color:#edf4ff;border:1px solid #344a66;border-radius:20px;padding:20px;max-width:calc(100vw - 16px)';
 const loadingText=document.createElement('p');loadingText.setAttribute('role','status');loadingText.textContent='Загружаем подсказки…';dialog.append(loadingText);
 const close=document.createElement('button');close.type='button';close.textContent='Закрыть помощь';close.onclick=()=>{if(window.BOS_MASTER_HELP_CAN_CLOSE?.(dialog)!==false)dialog.close()};dialog.append(close);
 const key=event=>{
  if(event.key==='Tab'&&dialog.open){
   const targets=[...dialog.querySelectorAll('button,a[href],input,select,textarea,summary,[tabindex]:not([tabindex="-1"])')].filter(el=>!el.disabled&&el.getClientRects().length);
   const first=targets[0],last=targets[targets.length-1],focused=document.activeElement;
   if(first&&((event.shiftKey&&(focused===first||!dialog.contains(focused)))||(!event.shiftKey&&(focused===last||!dialog.contains(focused))))){event.preventDefault();(event.shiftKey?last:first).focus()}
  }
  if(event.key==='Escape'&&dialog.open){event.preventDefault();event.stopImmediatePropagation();
   if(!window.BOS_MASTER_HELP_ESCAPE?.(dialog))dialog.close();
  }
 };
 window.addEventListener('keydown',key,true);
 const back=event=>{if(!dialog.open)return;event.stopImmediatePropagation();history.pushState(historyState,'',historyUrl);if(window.BOS_MASTER_HELP_CAN_CLOSE?.(dialog)!==false)dialog.close()};
 activeBack=back;
 const fit=()=>{
  const viewport=window.visualViewport;if(!dialog.open||!dialog.querySelector('.bhBody'))return;
  if(viewport&&viewport.height<innerHeight-100){
   dialog.style.height=Math.floor(viewport.height)+'px';dialog.style.maxHeight=Math.floor(viewport.height)+'px';dialog.style.top=viewport.offsetTop+'px';dialog.style.bottom='auto';dialog.style.margin='0 auto';
   if(dialog.contains(document.activeElement))document.activeElement.scrollIntoView({block:'nearest'});
  }else for(const key of ['height','max-height','top','bottom','margin'])dialog.style.removeProperty(key);
 };
 window.visualViewport?.addEventListener('resize',fit);window.visualViewport?.addEventListener('scroll',fit);
 dialog.addEventListener('cancel',event=>{event.preventDefault();if(window.BOS_MASTER_HELP_CAN_CLOSE?.(dialog)!==false)dialog.close()});
 dialog.addEventListener('close',()=>{
  window.removeEventListener('keydown',key,true);window.visualViewport?.removeEventListener('resize',fit);window.visualViewport?.removeEventListener('scroll',fit);if(active===dialog){active=null;activeBack=null}dialog.remove();
  if(!active){if(previous?.isConnected)previous.focus({preventScroll:true});window.scrollTo(position.x,position.y);}
 },{once:true});
 document.body.append(dialog);active=dialog;dialog.showModal();
 const render=()=>load().then(()=>window.BOS_HELP_STORE.load()).then(()=>{if(dialog.open){dialog.removeAttribute('style');window.BOS_MASTER_HELP_VIEW(dialog,topic);fit()}}).catch(error=>{
  if(!dialog.open)return;loadingText.textContent=error.message;
  if(!dialog.querySelector('[data-help-retry]')){const retry=document.createElement('button');retry.type='button';retry.dataset.helpRetry='';retry.textContent='Повторить загрузку';retry.onclick=()=>{retry.remove();loadingText.textContent='Загружаем подсказки…';render()};dialog.insertBefore(retry,close)}
 });
 render();
};
const originalMemo=window.openMasterMemoItem;
window.openMasterMemoItem=function(kind){return kind==='tips'?window.openMasterHelp():originalMemo?.apply(this,arguments)};
const master=()=>typeof state!=='undefined'&&(state.user?.role==='master'||typeof isMasterPreview==='function'&&isMasterPreview());
function add(target,topic,label){
 if(!target||target.querySelector(':scope > [data-bos-help]'))return;
 const button=document.createElement('button');button.type='button';button.className='secondary bosHelpEntry';button.dataset.bosHelp=topic;button.textContent=label;
 button.style.cssText='min-height:44px;margin:8px 0;white-space:normal';button.addEventListener('click',()=>window.openMasterHelp(topic));target.prepend(button);
}
function decorate(){
 const role=typeof state!=='undefined'?state.user?.role:'';
 if(['owner','manager'].includes(role)){
  const modal=document.querySelector('#modalRoot .modal');
  if(modal&&/профиль|business os/i.test(modal.querySelector('h2')?.textContent||'')&&!modal.querySelector('[data-bos-help=home]'))add(modal,'home','Подсказки по работе');
  add(document.querySelector('.bosTeamMemo'),'home','Подсказки по работе');
 }
 if(!master())return;
 add(document.querySelector('#masterContactResultForm'),'contact','Как заполнить?');
 add(document.querySelector('#masterOrderAgree179Form,#masterAgreementForm'),'agreement','Как согласовать?');
 add(document.querySelector('#masterReportForm'),'report','Как отправить?');
 add(document.querySelector('#bosMasterWorkCalendar,.bosScheduleEditorTask'),'profile','Как настроить?');
 add(document.querySelector('#masterMoneyV130')||document.querySelector('.bosProfileAccrual'),'money','Как проверить начисления?');
 const card=document.querySelector('#modalRoot .bosCompactMasterCard');
 if(card)add(card,'home','Помощь по заявке');
}
let queued=false;
const observer=new MutationObserver(()=>{if(!queued){queued=true;requestAnimationFrame(()=>{queued=false;decorate()})}});
for(const id of ['content','modalRoot']){const root=document.getElementById(id);if(root)observer.observe(root,{childList:true,subtree:true})}

decorate();
})();
