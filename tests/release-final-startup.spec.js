const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const {fullStack}=require('./helpers/full-stack.cjs');

test('late attention enhancement preserves a newer finance navigation',async({page})=>{
 await fullStack(page,'owner');await page.goto('/?force_vk_auth=1');await expect(page.locator('#authGate')).toBeHidden();await page.evaluate(()=>BOS_LOAD_ROLE_MODULES('owner'));
 const source=fs.readFileSync(path.join(__dirname,'..','dispatcher-attention-v123.js'),'utf8');
 await page.evaluate(source=>{
  show('home');delete window.BOS_DISPATCHER_ATTENTION_V123;
  const native=window.setTimeout,callbacks=[];window.setTimeout=(fn,delay,...args)=>delay===0?(callbacks.push(()=>fn(...args)),0):native(fn,delay,...args);
  try{(0,eval)(source)}finally{window.setTimeout=native}
  show('finance');callbacks.forEach(fn=>fn());
 },source);
 await expect(page.locator('#financePage')).toBeVisible();expect(await page.evaluate(()=>state.page)).toBe('finance');
});

test('late attention enhancement preserves a dispatcher form draft',async({page})=>{
 await fullStack(page,'dispatcher');await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.evaluate(()=>BOS_LOAD_ROLE_MODULES('dispatcher'));
 const source=fs.readFileSync(path.join(__dirname,'..','dispatcher-attention-v123.js'),'utf8');
 await page.evaluate(source=>{
  show('home');delete window.BOS_DISPATCHER_ATTENTION_V123;
  const native=window.setTimeout,callbacks=[];window.setTimeout=(fn,delay,...args)=>delay===0?(callbacks.push(()=>fn(...args)),0):native(fn,delay,...args);
  try{(0,eval)(source)}finally{window.setTimeout=native}
  openOrderForm('11');document.querySelector('#orderForm [name=comment]').value='Черновик пользователя';callbacks.forEach(fn=>fn());
 },source);
 await expect(page.locator('#orderForm')).toBeVisible();await expect(page.locator('#orderForm [name=comment]')).toHaveValue('Черновик пользователя');
});
