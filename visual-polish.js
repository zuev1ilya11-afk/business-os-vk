(()=>{
  function decorateNav(){
    const map={home:['🏠','Главная'],orders:['📋','Заявки'],dispatch:['🗓️','График'],team:['👥','Команда']};
    document.querySelectorAll('nav button').forEach(b=>{
      const x=map[b.dataset.page];if(!x)return;
      const key=x.join('|');
      if(b.dataset.bosNavDecorated===key)return;
      b.innerHTML=`<span class="navEmoji" aria-hidden="true">${x[0]}</span><span>${x[1]}</span>`;
      b.dataset.bosNavDecorated=key;
    });
  }
  function decorateRole(){
    const badge=document.getElementById('roleBadge');if(!badge)return;
    const raw=badge.textContent.replace(/^[👑🛠️🎧📊]\s*/,'').trim();
    const e=raw.includes('Мастер')?'🛠️':raw.includes('Диспетчер')?'🎧':raw.includes('Руковод')?'📊':'👑';
    const next=e+' '+raw;
    if(badge.textContent!==next)badge.textContent=next;
  }
  function decorateProfile(){
    const p=document.getElementById('profileBtn');if(!p)return;
    if(p.dataset.bosProfileDecorated==='1')return;
    p.textContent='👤';p.dataset.bosProfileDecorated='1';
  }
  let scheduled=false;
  function run(){scheduled=false;decorateNav();decorateRole();decorateProfile()}
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(run)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run,{once:true});else run();
  setTimeout(run,500);
  const o=new MutationObserver(schedule);
  o.observe(document.body,{subtree:true,childList:true});
})();