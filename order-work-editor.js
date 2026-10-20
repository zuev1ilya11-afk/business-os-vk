(()=>{
 'use strict';
 window.BOS_ATTACH_WORK_EDITOR=function(form,order,selectedWork,workEditRow){
  const W=window.BOS_WORK_ITEMS,stack=form.querySelector('#bosWorkStack'),description=form.querySelector('#bosWorkDescription');
  let dirty=false;const priorText=form.bosWorkText;
  const units=['шт.','комплект','выезд','пил.','точка','м','пог. м','п.м.','км','м²','час',''];
  function enhance(row,saved){
   if(row.querySelector('.bosWorkNumbers'))return;
   const item=selectedWork(row.querySelector('select')),unit=saved?.unit??item?.u??'шт.';
   const quantity=saved?.quantity??(row.bosOriginalLegacy?'':1),price=saved?.unit_price??(order?null:item?.p);
   row.insertAdjacentHTML('beforeend',`<div class="bosWorkNumbers"><label>Количество<input class="bosWorkQty" inputmode="decimal" value="${esc(String(quantity).replace('.',','))}" placeholder="Не указано" aria-label="Количество"></label><label>Единица<select class="bosWorkUnit" aria-label="Единица измерения">${[...new Set([unit,...units])].map(u=>`<option value="${esc(u)}" ${u===unit?'selected':''}>${esc(u||'без единицы')}</option>`).join('')}</select></label><label>Цена за единицу, ₽<input class="bosWorkPrice" inputmode="decimal" value="${esc(price??'')}" placeholder="Не указана" aria-label="Цена за единицу"></label><div>Сумма позиции<strong class="bosWorkLineTotal">—</strong></div></div>`);
  }
  const rows=()=>[...stack.querySelectorAll('.bosWorkEditRow')];
  if(Array.isArray(order?.work_items)&&order.work_items.length){
   rows().forEach(row=>row.remove());stack.querySelector('#bosAddWork').insertAdjacentHTML('beforebegin',order.work_items.map((x,i)=>workEditRow(x.name,i===0,true)).join(''));
   const generated=W.text(order.work_items),old=String(order.work||'');description.value=old.endsWith(generated)?old.slice(0,old.length-generated.length).trim():'';
  }
  rows().forEach((row,i)=>{row.bosOriginalLegacy=!!order&&!order.work_items?.length&&!!selectedWork(row.querySelector('.bosWorkSelect'));enhance(row,order?.work_items?.[i])});
  function collect(){return W.normalize(rows().map(row=>{
   const s=selectedWork(row.querySelector('.bosWorkSelect'));if(!s||row.bosOriginalLegacy&&!row.bosTouched)return null;
   return {name:s.n,service_id:s.id,quantity:row.querySelector('.bosWorkQty').value,unit:row.querySelector('.bosWorkUnit').value,unit_price:row.querySelector('.bosWorkPrice').value};
  }).filter(Boolean));}
  const footer=document.createElement('div');footer.className='bosWorkSum';footer.innerHTML='<p class="muted">Общая стоимость сохраняется отдельно. Чтобы взять сумму позиций, нажмите кнопку.</p><button type="button" class="secondary bosUseWorkTotal">Использовать сумму позиций</button><p class="bosWorkError newOrderError" role="status"></p>';stack.append(footer);
  function paint(){rows().forEach(row=>{enhance(row);const s=selectedWork(row.querySelector('select'));try{const [v]=W.normalize([{name:s?.n||'Позиция',quantity:row.querySelector('.bosWorkQty').value,unit:row.querySelector('.bosWorkUnit').value,unit_price:row.querySelector('.bosWorkPrice').value}]);row.querySelector('.bosWorkLineTotal').textContent=v.amount==null?'Не указана':money(v.amount)}catch(_){row.querySelector('.bosWorkLineTotal').textContent='—'}})}
  stack.addEventListener('click',e=>{if(e.target.closest('#bosAddWork,.bosRemoveWork')){rows().forEach(row=>enhance(row));dirty=true;paint()}});
  stack.addEventListener('change',e=>{
   const changed=e.target.closest('.bosWorkEditRow');if(changed)changed.bosTouched=true;
   if(e.target.matches('.bosWorkSelect')){const row=e.target.closest('.bosWorkEditRow'),item=selectedWork(e.target);enhance(row);row.querySelector('.bosWorkQty').value='1';const u=row.querySelector('.bosWorkUnit');if(item?.u&&!Array.from(u.options).some(x=>x.value===item.u))u.add(new Option(item.u,item.u));u.value=item?.u??'шт.';row.querySelector('.bosWorkPrice').value=item?.p??'';}
   dirty=true;paint();
  });
  stack.addEventListener('input',e=>{const changed=e.target.closest('.bosWorkEditRow');if(changed)changed.bosTouched=true;dirty=true;paint()});
  footer.querySelector('button').onclick=()=>{try{if(rows().some(row=>row.bosOriginalLegacy&&!row.bosTouched))throw Error('Для суммы позиций укажите количество и цену старых работ');const total=W.total(collect());if(total===null)throw Error('Укажите цену для каждой позиции');const amount=form.elements.original_amount;amount.value=String(total);amount.dispatchEvent(new Event('input',{bubbles:true}));footer.querySelector('[role=status]').textContent='Сумма заявки обновлена: '+money(total)}catch(e){footer.querySelector('[role=status]').textContent=e.message}};
  form.bosWorkItems=()=>{if(order&&!dirty)return undefined;return collect()};
  form.bosWorkText=()=>{if(order&&!dirty)return priorText();return [description.value.trim(),...rows().filter(row=>row.bosOriginalLegacy&&!row.bosTouched).map(row=>selectedWork(row.querySelector('.bosWorkSelect'))?.n),W.text(collect())].filter(Boolean).join('\n')};
  // If only the general description changes, preserve structured rows and the existing quantities.
  if(order?.work_items?.length)form.bosWorkText=()=>[description.value.trim(),W.text(dirty?collect():order.work_items)].filter(Boolean).join('\n');
  paint();
 };
 const style=document.createElement('style');style.textContent='.bosWorkEditRow{min-width:0!important;flex-wrap:wrap}.bosWorkNumbers{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;width:100%;grid-column:1/-1}.bosWorkNumbers label,.bosWorkNumbers>div{display:flex;flex-direction:column;gap:4px;font-size:12px;min-width:0}.bosWorkNumbers input,.bosWorkNumbers select{width:100%;min-width:0!important}.bosWorkLineTotal{padding:12px 0;font-size:14px}.bosWorkSum{grid-column:1/-1}.bosWorkStack,.bosWorkEditRow select{max-width:100%;min-width:0!important}.newOrderField:has(#bosWorkStack){grid-column:1/-1}.bosWorkNumbers input[aria-invalid=true]{border-color:#ed7474}';document.head.append(style);
})();
