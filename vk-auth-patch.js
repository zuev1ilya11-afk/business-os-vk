(()=>{
  // Legacy compatibility shim. The active authentication flow is owned by mandatory-auth-v29.js.
  // Do not install fetch routers or create parallel VK sessions here.
  window.BOS_LEGACY_VK_AUTH_DISABLED=true;
})();
