import test from 'node:test';import assert from 'node:assert/strict';import {join} from 'node:path';
import {createApp} from '../../server/app.mjs';import {browser,request,scratch} from './helpers.mjs';
test('development exception cannot issue insecure cookies on a public HTTPS origin',async()=>{
 let app;try{app=await createApp({origin:'https://hasterrad.quantumtekh.com',dev:true,dbPath:join(scratch(),'auth.sqlite')});assert.fail('public origin incorrectly accepted development insecure cookie mode');}catch(error){assert.equal(error.code,'dev_requires_loopback_origin');}finally{if(app)await app.close();}
});
test('production cookie flags, Host/forwarded headers, request shape/size and session TTL boundaries',async t=>{
 let now=Date.now();const origin='https://hasterrad.quantumtekh.com',url='http://127.0.0.1:18995';const app=await createApp({origin,dbPath:join(scratch(),'auth.sqlite'),clock:()=>now});await app.listen(18995);t.after(()=>app.close());
 const get=(path,headers={})=>request(url,path,{headers:{host:'hasterrad.quantumtekh.com',...headers}});
 const boot=await get('/api/session');assert.equal(boot.status,200);assert.match(boot.headers['set-cookie'][0],/^__Host-hasterrad_session=[a-f0-9]{64}; HttpOnly; SameSite=Lax; Path=\/; Max-Age=86400; Secure$/);assert.equal(boot.headers['cache-control'],'no-store');assert.equal(boot.headers['referrer-policy'],'no-referrer');assert.equal(boot.headers['access-control-allow-origin'],undefined);
 assert.equal((await request(url,'/api/session')).status,421);assert.equal((await get('/api/session',{'x-forwarded-host':'attacker.invalid'})).status,421);assert.equal((await get('/api/session',{'x-forwarded-proto':'https'})).status,421);
 const mutate=(body,headers={})=>request(url,'/auth/logout',{method:'POST',headers:{host:'hasterrad.quantumtekh.com',origin,'content-type':'application/json',cookie:boot.cookie,'x-csrf-token':boot.json().csrf,...headers},body});
 assert.equal((await mutate('{}',{'x-csrf-token':'é'.repeat(64)})).status,403);
 assert.equal((await mutate('[]')).status,400);assert.equal((await mutate('{broken')).status,400);assert.equal((await mutate('{"extra":true}')).status,400);assert.equal((await mutate('{}',{'content-type':'text/plain'})).status,415);assert.equal((await mutate(' '.repeat(17000))).status,413);
 now+=1800001;const expired=await get('/api/session',{cookie:boot.cookie});assert.notEqual(expired.json().csrf,boot.json().csrf);
 now+=86400000;assert.equal((await mutate('{}')).status,403);
});
