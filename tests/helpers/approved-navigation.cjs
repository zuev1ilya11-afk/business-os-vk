// Use original navigation, filters, secondary actions and stage mutations.
async function navigate(page,destination){const e=page.locator(`#app > nav [data-page="${destination}"]`);if(await e.isVisible())await e.click();else{await page.locator('#app > nav [data-page=more]').click();await page.locator(`[data-bos-destination="${destination}"]`).click()}}
async function secondary(card){const e=card.locator('.bosOpsSecondaryActions');if(await e.count()&&!await e.evaluate(e=>e.open)){await e.locator('summary').scrollIntoViewIfNeeded();await e.locator('summary').click()}}
async function filterSelect(page,id,value){await page.locator('#'+id).waitFor({state:'attached'});await page.getByRole('button',{name:'Фильтры',exact:true}).click();await page.locator(`[data-original-id="${id}"]`).selectOption(value);await page.getByRole('button',{name:'Применить',exact:true}).click()}
async function confirmStage(page,button,stage){await button.click();await page.locator('.bosStageTask').getByRole('button',{name:stage==='departed'?'Подтвердить: выехал':'Подтвердить: начал работу',exact:true}).click()}
module.exports={navigate,secondary,filterSelect,confirmStage};
