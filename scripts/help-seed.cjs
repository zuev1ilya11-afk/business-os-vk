// Explicit initial migration only; never used to replace edited server content.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),c={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'master-help-data.js'),'utf8'),c);
const quote=v=>"'"+String(v).replaceAll("'","''")+"'",rows=[];
for(const kind of ['lessons','talk','faq','problems'])c.window.BOS_MASTER_HELP_DATA[kind].forEach((x,i)=>rows.push(`(${quote(x.id)},${quote(kind)},${quote(JSON.stringify(x))}::jsonb,${i})`));
const sql='-- Generated initial content. Existing IDs and edits are never overwritten.\nINSERT INTO public.master_help_materials(id,kind,content,sort_order) VALUES\n'+rows.join(',\n')+'\nON CONFLICT (id) DO NOTHING;\n';
const target=path.join(root,'deploy/help-editor/seed.sql');
if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8')!==sql)throw Error('Help seed differs from initial content')}else fs.writeFileSync(target,sql);
