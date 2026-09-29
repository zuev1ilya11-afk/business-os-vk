import webpush from 'npm:web-push@3.6.7';

Deno.test('real web-push dependency prepares encrypted provider requests without sending',async()=>{
  const receiver=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const publicBytes=new Uint8Array(await crypto.subtle.exportKey('raw',receiver.publicKey));
  const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const keys=webpush.generateVAPIDKeys();
  const endpoint='https://fcm.googleapis.com/fcm/send/runtime-test';
  const request=webpush.generateRequestDetails({endpoint,keys:{p256dh:encode(publicBytes),auth:encode(crypto.getRandomValues(new Uint8Array(16)))}},JSON.stringify({v:1,title:'Runtime test',body:'private-test-payload'}),{
    vapidDetails:{subject:'https://zuev1ilya11-afk.github.io/business-os-vk/',publicKey:keys.publicKey,privateKey:keys.privateKey},
    TTL:60,urgency:'high',contentEncoding:'aes128gcm',topic:'v211runtime'
  });
  if(request.endpoint!==endpoint||request.method!=='POST')throw new Error('Incorrect provider request');
  if(request.headers['Content-Encoding']!=='aes128gcm'||!String(request.headers.Authorization||'').startsWith('vapid '))throw new Error('Missing encryption/auth headers');
  if(!request.body||request.body.byteLength<100||new TextDecoder().decode(new Uint8Array(request.body)).includes('private-test-payload'))throw new Error('Payload is not encrypted');
  if(keys.publicKey.length!==87||keys.privateKey.length!==43)throw new Error('Invalid VAPID generation');
});
