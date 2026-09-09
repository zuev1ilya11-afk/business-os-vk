const {test,expect}=require('@playwright/test');

test('find reachable Google Apps Script deployment URL',async({request})=>{
  const starts=['6l6V','616V','6I6V'];
  const mids1=['WQGlj0','WQGIj0','WQGljO','WQGIjO'];
  const mids2=['DuIzdmi','Dulzdmi'];
  const ends=['Erl1sWEumzQ','ErI1sWEumzQ','Er1IsWEumzQ'];
  const found=[];
  for(const a of starts)for(const b of mids1)for(const c of mids2)for(const d of ends){
    const id=`AKfycbx${a}_jjZdb${b}DcR4Uf4wvMc8hA24${c}-Ek76QH1mQS0tm3Q_${d}`;
    const url=`https://script.google.com/macros/s/${id}/exec`;
    const r=await request.post(url,{form:{action:'ping'},timeout:10000});
    if(r.status()!==404){
      const text=await r.text();
      console.log('GAS_CANDIDATE',r.status(),id,text.slice(0,200));
      found.push({id,status:r.status(),text});
    }
  }
  expect(found.length).toBeGreaterThan(0);
});
