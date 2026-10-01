const fs=require('node:fs'),crypto=require('node:crypto');
const path='dispatcher-report-patch.js',s=fs.readFileSync(path,'utf8');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const target='3227e0672c77c7bc91775acab2c5b373f5d4de5374b86bfd478661cefab5cf41';
if(hash(s)!==target){
 if(hash(s)!=='d247281b37902d3a3c422c912671e8c4dd755f530c8973d7db80adaae0c9c647')throw Error('Dispatcher source changed');
 const next=s.replaceAll('??(o.master_payout||payout(o.amount))||0','??(o.master_payout||payout(o.amount)||0)');
 if(hash(next)!==target)throw Error('Unexpected parser repair');
 fs.writeFileSync(path,next);
}
