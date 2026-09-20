(()=>{
  // Keep visual decoration deliberately static in VK WebView.
  // Dynamic MutationObserver decoration conflicted with role-preview-patch,
  // repeatedly rewriting role/nav text on iOS VK and producing the "waterfall".
  function loadDarkPhase3(){
    if(document.getElementById('bosDarkPhase3Css')) return;
    const link=document.createElement('link');
    link.id='bosDarkPhase3Css';
    link.rel='stylesheet';
    link.href='dark-business-os-phase3.css?v=20260921-v1';
    document.head.appendChild(link);
  }
  function decorateOnce(){
    loadDarkPhase3();
    const badge=document.getElementById('roleBadge');
    if(badge){
      const raw=(badge.textContent||'').replace(/^[👑🛠️🎧📊]\s*/,'').trim()||'Владелец';
      badge.textContent=raw;
    }
    const profile=document.getElementById('profileBtn');
    if(profile && !profile.textContent.trim()) profile.textContent='БО';
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',decorateOnce,{once:true});
  else decorateOnce();
})();