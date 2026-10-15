// Only called after master-memo-api has verified the session and active staff record.
const HELP_TABLE='master_help_materials';
const HELP_KINDS=['lessons','talk','faq','problems'];
const HELP_READERS=['owner','manager','master','dispatcher','admin'];
const helpId=(x:any)=>typeof x==='string'&&/^[a-z][a-z0-9_-]{1,79}$/.test(x);
function stable(value:any):string{return value&&typeof value==='object'?Array.isArray(value)?'['+value.map(stable).join(',')+']':'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}':JSON.stringify(value)}
function field(value:any,name:string,required=true,max=12000){
 if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw Error('Проверьте поле «'+name+'»');
 return value;
}
function optional(value:any,name:string){return value===undefined?undefined:field(value,name,false)}
function actions(value:any){if(!Array.isArray(value)||!value.length||value.length>50)throw Error('Добавьте от 1 до 50 действий');return value.map(x=>field(x,'Действие'))}
function validateHelp(kind:string,id:string,input:any,previous:any){
 if(!input||typeof input!=='object'||Array.isArray(input)||input.id!==id)throw Error('Неверный идентификатор материала');
 const out:any={id};
 if(kind==='faq'){
  out.question=field(input.question,'Вопрос',true,300);out.answer=field(input.answer,'Ответ');
  if(!['price','work','payment','problem'].includes(input.category))throw Error('Выберите существующую категорию');
  out.category=input.category;if(input.note!==undefined)out.note=optional(input.note,'Примечание');
 }else{
  out.title=field(input.title,'Название',true,300);
  if(kind==='lessons'){
   if(!Array.isArray(input.steps)||!input.steps.length||input.steps.length>50)throw Error('Добавьте от 1 до 50 шагов');
   const ids=new Set();out.steps=input.steps.map((s:any)=>{
    if(!s||!helpId(s.id)||ids.has(s.id))throw Error('Неверный идентификатор шага');ids.add(s.id);
    const old=previous?.steps?.find((x:any)=>x.id===s.id),step:any={id:s.id,title:field(s.title,'Название шага',true,300),text:field(s.text,'Текст шага')};
    for(const k of ['warning','detail'])if(s[k]!==undefined)step[k]=optional(s[k],k==='warning'?'Предупреждение':'Пояснение');
    // The ordinary-fields editor cannot replace images or educational actions.
    for(const k of ['image','alt','branches']){if(stable(s[k])!==stable(old?.[k]))throw Error('Иллюстрации и учебные варианты изменять нельзя');if(old?.[k]!==undefined)step[k]=old[k]}
    return step;
   });
   if(previous?.steps?.some((s:any)=>!ids.has(s.id)))throw Error('Существующие шаги необходимо сохранить');
  }else{
   out.actions=actions(input.actions);
   if(kind==='talk'){out.say=field(input.say,'Готовая фраза');if(input.warning!==undefined)out.warning=optional(input.warning,'Предупреждение')}
  }
 }
 return out;
}
export async function handleHelp(db:any,actor:any,body:any){
 const fail=(status:number,error:string,code?:string)=>({status,body:{ok:false,error,...(code?{code}:{})}});
 const role=String(actor.role||''),canEdit=['owner','manager'].includes(role);
 if(!HELP_READERS.includes(role))return fail(403,'Недостаточно прав');
 if(body.action==='help_list'){
  const items=[];
  for(let offset=0;;offset+=200){const q=await db.from(HELP_TABLE).select('*').order('sort_order').order('created_at').order('id').range(offset,offset+199);if(q.error)throw q.error;items.push(...q.data||[]);if((q.data||[]).length<200)break}
  return {status:200,body:{ok:true,items,can_edit:canEdit}};
 }
 if(!canEdit)return fail(403,'Только владелец или руководитель может управлять подсказками');
 const {id,kind,version}=body;
 if(!helpId(id)||!HELP_KINDS.includes(kind)||!Number.isSafeInteger(version)||version<0||version>2147483645)return fail(400,'Неверные параметры материала');
 if(JSON.stringify(body.content||{}).length>150000)return fail(400,'Материал слишком большой');
 const q=await db.from(HELP_TABLE).select('*').eq('id',id).maybeSingle();if(q.error)throw q.error;
 const old=q.data;
 const conflict=()=>fail(409,'Подсказка уже изменена. Ваш текст сохранён в форме. Откройте актуальную версию для сравнения.', 'HELP_CONFLICT');
 if(old&&old.kind!==kind)return conflict();
 if(!old&&version!==0)return conflict();
 let content;
 try{content=validateHelp(kind,id,body.content,old?.content)}catch(e){return fail(400,e instanceof Error?e.message:'Проверьте поля материала')}
 // Lost HTTP response: the exact retry succeeds without producing another revision.
 if(old&&old.version===version+1&&old.updated_by===actor.id&&stable(old.content)===stable(content))return {status:200,body:{ok:true,item:old,replayed:true}};
 if(old&&old.version!==version)return conflict();
 if(old&&version===0)return conflict();
 const row={id,kind,content,version:version+1,updated_by:actor.id,updated_at:new Date().toISOString()};
 let result;
 try{result=old?await db.from(HELP_TABLE).update(row).eq('id',id).eq('version',version).select().maybeSingle():await db.from(HELP_TABLE).insert(row).select().single()}catch(e){if((e as any)?.code==='23505')return conflict();throw e}
 if(result.error){if(result.error.code==='23505')return conflict();throw result.error}
 if(!result.data)return conflict();
 return {status:200,body:{ok:true,item:result.data}};
}
