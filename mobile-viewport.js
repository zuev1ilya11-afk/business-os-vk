// Recover a phone's layout viewport without changing zoom or desktop/tablet layouts.
(()=>{
'use strict';
let attemptedWidth=0,dismissed=false,pending=false;
function phoneWidth(){
  const width=Number(screen.width),height=Number(screen.height);
  const touch=navigator.maxTouchPoints>0||window.matchMedia('(pointer: coarse)').matches;
  return touch&&width>0&&height>0&&Math.min(width,height)<=600?width:0;
}
function tooWide(width){const layout=document.documentElement.clientWidth;return width>0&&layout>600&&layout>width*1.25}
function clearNotice(){const node=document.getElementById('bosMobileViewportNotice');if(node?.open)node.close();node?.remove()}
function notice(width){
  if(dismissed)return;
  let node=document.getElementById('bosMobileViewportNotice');
  if(!node){
    node=document.createElement('dialog');node.id='bosMobileViewportNotice';
    node.setAttribute('aria-labelledby','bosMobileViewportTitle');
    node.innerHTML='<section><h2 id="bosMobileViewportTitle">Верните мобильный вид</h2><p>Браузер уменьшил страницу до размера экрана телефона. Откройте меню браузера ⋮ и отключите «Версия для ПК» или «Сайт для компьютера».</p><p>После этого вернитесь в приложение. Если масштаб остался прежним, обновите страницу, предварительно сохранив введённые данные.</p><button type="button">Понятно</button></section>';
    node.querySelector('button').onclick=()=>{dismissed=true;clearNotice()};
    node.addEventListener('cancel',event=>{event.preventDefault();dismissed=true;clearNotice()});
    node.addEventListener('keydown',event=>{if(event.key==='Tab'){event.preventDefault();node.querySelector('button').focus()}});
    document.body.appendChild(node);
    node.showModal();
  }
  // A wide desktop viewport is scaled down by the phone. Keep this instruction readable.
  const scale=Math.max(1,document.documentElement.clientWidth/width);
  node.dataset.scale=String(scale);node.style.setProperty('--bos-phone-scale',String(scale));
}
function inspect(){
  pending=false;
  const width=phoneWidth();
  if(!tooWide(width)){clearNotice();return}
  if(attemptedWidth!==width){
    attemptedWidth=width;
    let meta=document.querySelector('meta[name="viewport"]');
    if(!meta){meta=document.createElement('meta');meta.name='viewport';document.head.appendChild(meta)}
    meta.content='width='+width+',initial-scale=1,viewport-fit=cover';
    // Wait for layout after the metadata change. Some desktop-site modes ignore it.
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      const current=phoneWidth();if(tooWide(current))notice(current);else clearNotice();
    }));
  }else notice(width);
}
function schedule(){if(!pending){pending=true;requestAnimationFrame(inspect)}}
const style=document.createElement('style');
style.textContent='#bosMobileViewportNotice{position:fixed;inset:0;z-index:1000000;display:flex;align-items:center;justify-content:center;overflow:auto;box-sizing:border-box;width:100%;height:100%;max-width:none;max-height:none;margin:0;border:0;padding:calc(20px * var(--bos-phone-scale));background:#0e141c;color:#edf2f8;font-family:system-ui,sans-serif}#bosMobileViewportNotice section{width:100%;max-width:calc(420px * var(--bos-phone-scale));margin:auto;box-sizing:border-box}#bosMobileViewportNotice h2{font-size:calc(24px * var(--bos-phone-scale));line-height:1.25;margin:0 0 calc(18px * var(--bos-phone-scale))}#bosMobileViewportNotice p{font-size:calc(16px * var(--bos-phone-scale));line-height:1.5;margin:0 0 calc(16px * var(--bos-phone-scale))}#bosMobileViewportNotice button{display:block;box-sizing:border-box;width:100%;min-height:calc(48px * var(--bos-phone-scale));margin-top:calc(22px * var(--bos-phone-scale));padding:calc(10px * var(--bos-phone-scale));border:0;border-radius:calc(12px * var(--bos-phone-scale));background:#a8cfff;color:#112033;font:inherit;font-size:calc(16px * var(--bos-phone-scale));cursor:pointer}';
document.head.appendChild(style);
// Keyboard and pinch-zoom resize events must never reset the user's viewport.
window.addEventListener('orientationchange',schedule);
window.addEventListener('pageshow',schedule);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});else schedule();
})();
