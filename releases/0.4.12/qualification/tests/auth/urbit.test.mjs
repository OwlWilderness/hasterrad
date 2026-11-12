import test from 'node:test';import assert from 'node:assert/strict';import {join} from 'node:path';
import {createApp} from '../../server/app.mjs';import {browser,fixture,request,scratch} from './helpers.mjs';
test('Urbit fresh completion secret defeats original two-browser start-state exploit, native tilde cookie and trusted verifier',async t=>{
 let seen=[];const verifier=await fixture((req,res)=>{seen.push({url:req.url,host:req.headers.host,cookie:req.headers.cookie});res.setHeader('content-type','text/plain');res.end(req.headers.cookie==='urbauth-~zod=0v4.fixture'?'~nec':'not a ship');});t.after(()=>verifier.close());
 const origin='http://127.0.0.1:18992';const app=await createApp({origin,dev:true,dbPath:join(scratch(),'auth.sqlite'),urbit:{publicOrigin:'https://rp.example.test',verifierOrigin:verifier.origin,ship:'~zod'}});await app.listen(18992);t.after(()=>app.close());
 const attacker=await browser(origin),victim=await browser(origin);
 assert.equal((await attacker.get('/api/session')).json().providers.urbit,true);
 const start=await attacker.get('/auth/urbit/start');assert.equal(start.status,303);
 const target=new URL(start.headers.location);assert.equal(target.origin,'https://rp.example.test');assert.equal(target.pathname,'/~/login');
 const callback=target.searchParams.get('redirect'),state=new URL(callback,target).searchParams.get('state');
 assert.equal((await request(origin,callback,{headers:{host:'wrong.test',cookie:'urbauth-~zod=0v4.fixture'}})).status,421);
 assert.equal((await request(origin,'/hasterrad-auth/extra?state='+state,{headers:{host:'rp.example.test'}})).status,421);
 const approved=await request(origin,callback,{headers:{host:'rp.example.test',cookie:'unrelated=secret; urbauth-~zod=0v4.fixture; other=bad'}});assert.equal(approved.status,303);
 assert.deepEqual(seen,[{url:'/~/name',host:'rp.example.test',cookie:'urbauth-~zod=0v4.fixture'}]);
 const completion=new URL(approved.headers.location);assert.ok(completion.searchParams.get('code'));assert.notEqual(completion.searchParams.get('code'),state);
 assert.equal((await attacker.get('/auth/urbit/complete?code='+state)).status,401);
 assert.equal((await attacker.get('/api/session')).json().authenticated,false);
 assert.equal((await victim.get(completion.pathname+completion.search)).status,401);
 assert.equal((await victim.get('/api/session')).json().authenticated,false);
 assert.equal((await request(origin,callback,{headers:{host:'rp.example.test',cookie:'urbauth-~zod=0v4.fixture'}})).status,401);
 // A separate normal browser retains BOTH the API binding and callback secret.
 const normal=await browser(origin);const begin=await normal.get('/auth/urbit/start');const cb=new URL(begin.headers.location).searchParams.get('redirect');
 const verified=await request(origin,cb,{headers:{host:'rp.example.test',cookie:'urbauth-~zod=0v4.fixture'}});const done=new URL(verified.headers.location);const completePath=done.pathname+done.search;
 const results=await Promise.all([normal.get(completePath),normal.get(completePath)]);assert.deepEqual(results.map(x=>x.status).sort(),[303,401]);normal.cookie=results.find(x=>x.status===303).cookie;
 const session=(await normal.get('/api/session')).json();normal.csrf=session.csrf;assert.equal(session.user.id,'~nec');assert.equal(session.user.provider,'urbit');
 const old=normal.cookie;assert.equal((await normal.post('/auth/logout')).status,200);assert.equal((await request(origin,'/api/session',{headers:{cookie:old}})).json().authenticated,false);
});
