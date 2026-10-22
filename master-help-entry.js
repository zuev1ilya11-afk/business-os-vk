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
 if(!loading)loading=Promise.all([loadFile('master-help.css',true),loadFile('master-help-data.js'),loadFile('master-help.js')]).catch(e=>{loading=null;throw e});
 return loading;
}
window.openMasterHelp=function(topic='home'){
 if(active?.open){window.BOS_MASTER_HELP_VIEW?.(active,topic);return}
 const previous=document.activeElement,position={x:scrollX,y:scrollY},historyState=history.state,historyUrl=location.href;
 const dialog=document.createElement('dialog');dialog.id='bosMasterHelp';dialog.className='bosHelp';dialog.setAttribute('aria-label','Подсказки по работе');
 // Basic loading presentation remains usable even if the stylesheet fails.
 dialog.style.cssText='background:#101d30;color:#edf4ff;border:1px solid #344a66;border-radius:20px;padding:20px;max-width:calc(100vw - 16px)';
 const loadingText=document.createElement('p');loadingText.setAttribute('role','status');loadingText.textContent='Загружаем подсказки…';dialog.append(loadingText);
 const close=document.createElement('button');close.type='button';close.textContent='Закрыть помощь';close.onclick=()=>dialog.close();dialog.append(close);
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
 const back=event=>{if(!dialog.open)return;event.stopImmediatePropagation();history.pushState(historyState,'',historyUrl);dialog.close()};
 activeBack=back;
 dialog.addEventListener('cancel',event=>{event.preventDefault();dialog.close()});
 dialog.addEventListener('close',()=>{
  window.removeEventListener('keydown',key,true);activeBack=null;if(active===dialog)active=null;dialog.remove();
  if(previous?.isConnected)previous.focus({preventScroll:true});window.scrollTo(position.x,position.y);
 },{once:true});
 document.body.append(dialog);active=dialog;dialog.showModal();
 const render=()=>load().then(()=>{if(dialog.open){dialog.removeAttribute('style');window.BOS_MASTER_HELP_VIEW(dialog,topic)}}).catch(error=>{
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
 if(!master())return;
 add(document.querySelector('#masterContactResultForm'),'contact','Как заполнить?');
 add(document.querySelector('#masterOrderAgree179Form,#masterAgreementForm'),'agreement','Как согласовать?');
 add(document.querySelector('#masterReportForm'),'report','Как отправить?');
 add(document.querySelector('#bosMasterWorkCalendar,.bosScheduleEditorTask'),'profile','Как настроить?');
 add(document.querySelector('#masterMoneyV130')||document.querySelector('.bosProfileAccrual'),'money','Как проверить начисления?');
 const card=document.querySelector('#modalRoot .bosCompactMasterCard');
 if(card)add(card.querySelector('.bosOrderExtraActions')||card,'home','Помощь по заявке');
}
let queued=false;
const observer=new MutationObserver(()=>{if(!queued){queued=true;requestAnimationFrame(()=>{queued=false;decorate()})}});
for(const id of ['content','modalRoot']){const root=document.getElementById(id);if(root)observer.observe(root,{childList:true,subtree:true})}
decorate();
})();
