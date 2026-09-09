(()=>{
  // Keep visual decoration deliberately static in VK WebView.
  // Dynamic MutationObserver decoration conflicted with role-preview-patch,
  // repeatedly rewriting role/nav text on iOS VK and producing the "waterfall".
  function decorateOnce(){
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