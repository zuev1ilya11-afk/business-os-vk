'use strict';
// Explicit local operator action. Never reachable over HTTP or imported by production.
const fs=require('node:fs/promises'),path=require('node:path');
const readline=require('node:readline/promises');
(async()=>{
 if(process.env.NODE_ENV==='production'||!process.stdin.isTTY||!process.stdout.isTTY)throw Error('Access details can only be opened in a local interactive staging terminal');
 const privateDir=path.resolve(__dirname,'../../.client-portal-stage/private');
 const rl=readline.createInterface({input:process.stdin,output:process.stdout});
 try{
  const answer=(await rl.question('Тестовый вход: 1 — последний код клиента, 2 — сотрудник: ')).trim();
  if(answer==='1'){
   const files=await fs.readdir(path.join(privateDir,'otp'));const codes=[];
   for(const name of files.filter(x=>/^[a-f0-9-]+\.json$/.test(x))){const item=JSON.parse(await fs.readFile(path.join(privateDir,'otp',name),'utf8'));if(Date.parse(item.expires_at)>Date.now())codes.push(item)}
   codes.sort((a,b)=>Date.parse(b.expires_at)-Date.parse(a.expires_at));
   if(!codes.length){console.log('Нет действующего кода. Сначала запросите его в тестовом кабинете.');return}
   console.log('Только для локальной тестовой формы:',codes[0].phone,'код:',codes[0].code);
  }else if(answer==='2'){
   const role=(await rl.question('Роль: owner / manager / dispatcher / master: ')).trim();
   const access=JSON.parse(await fs.readFile(path.join(privateDir,'access.json'),'utf8')).staff[role];
   if(!access)throw Error('Неизвестная роль');console.log('Логин:',access.login,'\nПароль:',access.password);
  }else throw Error('Выберите 1 или 2');
  console.log('Не копируйте эти данные в Git, переписку или скриншоты.');
 }finally{rl.close()}
})().catch(e=>{console.error(e.code==='ENOENT'?'Сначала запустите локальную тестовую версию.':e.message);process.exitCode=1});
