import test from 'node:test';import assert from 'node:assert/strict';import {join} from 'node:path';
import {createApp} from '../../server/app.mjs';import {browser,fixture,request,scratch} from './helpers.mjs';
test('Urbit callback accepts only literal exact path; verifier redirect/nonship/error/timeout are terminal and cannot choose verifier',async t=>{
 let mode='valid',calls=0;const verifier=await fixture(async(req,res)=>{calls++;if(mode==='timeout')await new Promise(r=>setTimeout(r,100));res.setHeader('content-type','text/plain');if(mode==='redirect'){res.statusCode=302;res.setHeader('location','http://attacker.invalid/~/name');}if(mode==='error')res.statusCode=500;res.end(mode==='nonship'?'hello':'~zod');});t.after(()=>verifier.close());
 const origin='http://127.0.0.1:19001',app=await createApp({origin,dev:true,dbPath:join(scratch(),'auth.sqlite'),urbit:{publicOrigin:'https://rp.example.test',verifierOrigin:verifier.origin,ship:'~zod',timeout:25}});await app.listen(19001);t.after(()=>app.close());
 const start=async b=>new URL((await b.get('/auth/urbit/start')).headers.location).searchParams.get('redirect');
 const b=await browser(origin);let callback=await start(b);
 assert.equal((await request(origin,'/other/../'+callback.slice(1),{headers:{host:'rp.example.test',cookie:'urbauth-~zod=fixture'}})).status,400);assert.equal(calls,0);
 for(mode of ['redirect','nonship','error','timeout']){callback=await start(await browser(origin));const first=await request(origin,callback,{headers:{host:'rp.example.test',cookie:'urbauth-~zod=fixture'}});assert.ok([401,502].includes(first.status),mode);assert.equal(first.headers.location,undefined);assert.equal((await request(origin,callback,{headers:{host:'rp.example.test',cookie:'urbauth-~zod=fixture'}})).status,401);}
 mode='valid';callback=await start(await browser(origin));assert.equal((await request(origin,callback+'&verifier=http://attacker.invalid',{headers:{host:'rp.example.test',cookie:'urbauth-~zod=fixture'}})).status,400);
 callback=await start(await browser(origin));assert.equal((await request(origin,callback,{headers:{host:'rp.example.test',cookie:'urbauth-~nec=fixture; game=secret'}})).status,401);
 assert.equal(calls,4);
});
