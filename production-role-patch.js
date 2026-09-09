(()=>{
  function applyLiveRole(){
    const role=String(state.user?.role||'');
    try{
      if(role==='master'){
        if(typeof dispatcherPreviewUser!=='undefined')dispatcherPreviewUser=null;
        if(typeof previewRole!=='undefined')previewRole='master';
        if(typeof previewUser!=='undefined')previewUser=state.user;
      }else if(role==='dispatcher'){
        if(typeof previewRole!=='undefined')previewRole='owner';
        if(typeof previewUser!=='undefined')previewUser=null;
        if(typeof dispatcherPreviewUser!=='undefined')dispatcherPreviewUser=state.user;
      }else{
        if(typeof dispatcherPreviewUser!=='undefined')dispatcherPreviewUser=null;
        if(typeof previewRole!=='undefined')previewRole='owner';
        if(typeof previewUser!=='undefined')previewUser=null;
      }
    }catch(_){ }
  }

  const baseReloadData=reloadData;
  reloadData=async function(keepPage=true){
    await baseReloadData(keepPage);
    applyLiveRole();
    show(keepPage?state.page:'home');
  };

  applyLiveRole();
  if(state.orders?.length||state.users?.length){try{show(state.page||'home')}catch(_){}}
})();
