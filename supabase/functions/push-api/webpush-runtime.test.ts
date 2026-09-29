import { createECDH, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import webpush from 'npm:web-push@3.6.7';

Deno.test('real web-push dependency prepares encrypted provider requests without sending',()=>{
  const receiver=createECDH('prime256v1');receiver.generateKeys();
  const keys=webpush.generateVAPIDKeys();
  const endpoint='https://fcm.googleapis.com/fcm/send/runtime-test';
  const text=JSON.stringify({v:1,title:'Runtime test',body:'private-test-payload'});
  const request=webpush.generateRequestDetails({endpoint,keys:{p256dh:receiver.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}},text,{
    vapidDetails:{subject:'https://zuev1ilya11-afk.github.io/business-os-vk/',publicKey:keys.publicKey,privateKey:keys.privateKey},
    TTL:60,urgency:'high',contentEncoding:'aes128gcm',topic:'v211runtime'
  });
  if(request.endpoint!==endpoint||request.method!=='POST')throw new Error('Incorrect provider request');
  if(request.headers['Content-Encoding']!=='aes128gcm'||!request.headers.Authorization?.startsWith('vapid '))throw new Error('Missing encryption/auth headers');
  if(!request.body||request.body.length<100||request.body.includes(Buffer.from('private-test-payload')))throw new Error('Payload is not encrypted');
  if(keys.publicKey.length!==87||keys.privateKey.length!==43)throw new Error('Invalid VAPID generation');
});
