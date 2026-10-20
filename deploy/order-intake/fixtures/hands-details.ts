// Observed specialist /orders/ contract, 2026-10-01. The user confirmed that
// an explicit apartment label is supplied in directions ("Как добраться").
// Never infer it from the street/building address or an unlabelled number.
const cleanDetail=(value:unknown)=>typeof value==='string'?value.trim():'';
export function apartmentFromDirections(value:unknown){
  const text=cleanDetail(value);
  const labels=[...text.matchAll(/(?:^|[^\p{L}\p{N}_])(?:квартира|кв\.?)(?=\s|№|\d)/giu)];
  // Several apartment references or alternatives are ambiguous: retain the text.
  if(labels.length!==1)return '';
  const tail=text.slice(labels[0].index!+labels[0][0].length);
  const match=tail.match(/^\s*(?:№\s*)?(\d+(?:[а-яёa-z]|\/[\dа-яёa-z]+)?)(?=$|[\s,;.)])/iu);
  if(!match||/^\s*(?:или|и|[-–—,.])\s*\d/iu.test(tail.slice(match[0].length)))return '';
  return match[1];
}
const commentKeys=['comment','directions','shop_name','payment_status'];
function renderComment(source:Record<string,string>){
  return [source.comment,source.directions&&`Как добраться: ${source.directions}`,
    source.shop_name&&`Магазин: ${source.shop_name}`,source.payment_status&&`Оплата: ${source.payment_status}`].filter(Boolean).join('\n');
}
export function handsDetailsPatch(remote:any,current:any=null,legacyComment=''){
  const previous=current?.hands_comment_source||{},source={...previous};
  let supplied=false;
  for(const key of commentKeys){
    const value=cleanDetail(remote?.[key]);
    // Missing, null and temporarily empty upstream fields cannot erase data.
    if(value){source[key]=value;supplied=true}
  }
  const patch:any=supplied?{hands_comment_source:source}:{};
  const overrides={...(current?.hands_detail_overrides||{})};
  const apartment=apartmentFromDirections(source.directions),existingApartment=cleanDetail(current?.apartment);
  // Preserve any pre-existing local value whose origin cannot be established.
  if(apartment&&existingApartment&&!current?.hands_comment_source&&existingApartment!==apartment)overrides.apartment=true;
  if(apartment&&!overrides.apartment)patch.apartment=apartment;
  const rendered=renderComment(source),existing=cleanDetail(current?.comment);
  // Before source snapshots existed we cannot distinguish a stale import from
  // a local correction. Preserve ambiguous text instead of silently losing it.
  if(current&&!current.hands_comment_source&&existing&&existing!==rendered&&existing!==cleanDetail(legacyComment))overrides.comment=true;
  if(supplied&&!overrides.comment)patch.comment=rendered;
  if(JSON.stringify(overrides)!==JSON.stringify(current?.hands_detail_overrides||{}))patch.hands_detail_overrides=overrides;
  return patch;
}

export function manualDetailsPatch(body:any,current:any=null){
  const patch:any={},overrides={...(current?.hands_detail_overrides||{})};
  const edited=body.edited_detail_fields??[];
  if(!Array.isArray(edited)||edited.some((key:any)=>!['apartment','comment'].includes(key)||!Object.hasOwn(body,key)))throw new Error('Некорректные поля заявки');
  for(const [key,max] of [['apartment',120],['comment',10000]] as const){
    if(!Object.hasOwn(body,key))continue;
    if(body[key]!==null&&typeof body[key]!=='string')throw new Error('Некорректный текст поля заявки');
    const value=String(body[key]??'').trim();
    if(value.length>max)throw new Error(`${key==='apartment'?'Квартира':'Комментарий'}: не более ${max} символов`);
    patch[key]=value;
    if(value!==String(current?.[key]??'').trim()||edited.includes(key))overrides[key]=true;
  }
  if(JSON.stringify(overrides)!==JSON.stringify(current?.hands_detail_overrides||{}))patch.hands_detail_overrides=overrides;
  return patch;
}

const cleanWork=(value:any)=>value===null||value===undefined?'':String(value).trim().replace(/\s+/g,' ');
const workCollections=['works','services','work_items','jobs'];
const unitLabel=(value:any)=>{
  const raw=cleanWork(value),key=raw.toUpperCase();
  return ({PIECE:'шт.',PCS:'шт.',FIX:'шт.',METER:'м',METERS:'м',KM:'км'} as Record<string,string>)[key]||raw;
};
function specificWorkName(work:any){
  // Provider payloads can expose a generic category in `name` and the actual
  // selected operation in one of the more specific fields. Never replace
  // "Замер" or "Подрезка карниза" with the parent "карнизы" category.
  for(const value of [work?.work_name,work?.service_name,work?.title,work?.service?.title,work?.service?.name,work?.name]){
    const text=cleanWork(value);if(text)return text;
  }
  return '';
}
function workLine(work:any){
  const name=specificWorkName(work);if(!name)return '';
  const quantity=cleanWork(work?.quantity??work?.count??work?.qty??work?.volume??work?.units_count);
  const number=Number(quantity.replace(',','.'));
  const unit=unitLabel(work?.unit_name??work?.unit??work?.measure??work?.measurement_unit);
  return name+(quantity&&Number.isFinite(number)&&number>=0?' × '+quantity+(unit?' '+unit:''):'');
}
export function handsWorkText(remote:any){
  const lines:string[]=[];
  // Some Hands payload variants split main and additional operations between
  // different arrays. Read all known work collections and de-duplicate exact
  // lines so measurement/cutting/minimum-charge rows are not lost.
  for(const key of workCollections){
    const rows=Array.isArray(remote?.[key])?remote[key]:[];
    for(const work of rows){
      const line=workLine(work);
      if(line&&!lines.some(existing=>existing.toLocaleLowerCase('ru-RU')===line.toLocaleLowerCase('ru-RU')))lines.push(line);
    }
  }
  return lines.length?lines.join('\n'):cleanWork(remote?.title||remote?.work||remote?.description)||'Заказ Hands';
}

// Accepted reports may receive missing descriptive data, never amounts/statuses.
export async function updateAcceptedHandsDetails(db:any,remote:any,current:any,legacyComment=''){
  const patch=handsDetailsPatch(remote,current,legacyComment);
  for(const key of Object.keys(patch))if(JSON.stringify(patch[key])===JSON.stringify(current[key]))delete patch[key];
  if(!Object.keys(patch).length)return;
  patch.updated_at=new Date().toISOString();
  let update=db.from('orders').update(patch).eq('id',current.id);
  for(const key of ['status','report_review_status','updated_at'])update=current[key]==null?update.is(key,null):update.eq(key,current[key]);
  const result=await update.select('id').maybeSingle();
  if(result.error)throw result.error;if(!result.data)throw new Error('ORDER_CHANGED');
}
