const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const src=fs.readFileSync(require('node:path').join(__dirname,'../dispatcher-permissions.js'),'utf8');
test('dispatcher capability allows only supported roles, independently of preview flags',()=>{
 const ctx={window:{},isDispatcherPreview:()=>true,isMasterPreview:()=>false};
 vm.runInNewContext(src,ctx);
 const {canUseDispatcherWorkspace:can,isDispatcherWorkspaceActive:active}=ctx.window.BOS_PERMISSIONS;
 for(const role of ['owner','manager','dispatcher'])assert.equal(can({role}),true);
 for(const user of [null,{}, {role:'master'},{role:'unknown'}]){assert.equal(can(user),false);assert.equal(active(user),false)}
 ctx.isMasterPreview=()=>true;
 assert.equal(can({role:'owner'}),true);
 assert.equal(active({role:'owner'}),false);
});
