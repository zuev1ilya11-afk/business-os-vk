// Keep image URLs content-versioned without changing permanent content/step IDs.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..'),file=path.join(root,'master-help-data.js'),context={window:{}};
vm.runInNewContext(fs.readFileSync(file,'utf8'),context);
for(const lesson of context.window.BOS_MASTER_HELP_DATA.lessons)for(const step of lesson.steps){
 if(!step.image)continue;const name=step.image.split('?')[0];
 step.image=name+'?sha='+crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex').slice(0,16);
}
fs.writeFileSync(file,'// Initial read-only content. Server revisions take precedence. IDs must never be regenerated.\nwindow.BOS_MASTER_HELP_DATA='+JSON.stringify(context.window.BOS_MASTER_HELP_DATA,null,2)+';\n');
console.log('Versioned on-demand illustrations; existing IDs preserved. Regenerate help seed if images changed.');
