// Temporary feature-branch generator; all product registration is already committed.
const fs=require('node:fs');
const migration='supabase/migrations/'+fs.readdirSync('supabase/migrations').find(x=>x.endsWith('_order_control_tasks_v2.sql'));
let sql=fs.readFileSync(migration,'utf8');
const from="(actor.role<>'master' or x.assignee_id=actor.id)";
const to="(actor.role<>'master' or (x.assignee_id=actor.id and bos_control_private.current_task(x)))";
if(!sql.includes(to)){
 if(sql.split(from).length!==3)throw Error('Expected both list predicates');
 sql=sql.split(from).join(to);fs.writeFileSync(migration,sql);
}
