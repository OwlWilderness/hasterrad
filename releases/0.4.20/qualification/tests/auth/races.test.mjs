import test from 'node:test';import assert from 'node:assert/strict';import {join} from 'node:path';
import {privateKeyToAccount} from 'viem/accounts';
import {createApp} from '../../server/app.mjs';import {Store} from '../../server/store.mjs';import {browser,fixture,request,scratch} from './helpers.mjs';
const account=privateKeyToAccount('0x'+'1'.padStart(64,'0'));
test('two service instances share atomic nonce consumption; in-flight signature cannot restore logout and store failure is atomic',async t=>{
 let entered,release;const arrived=new Promise(r=>entered=r);let delay=false;
 const rpc=await fixture(async(req,res)=>{let body='';for await(const x of req)body+=x;const data=JSON.parse(body);if(delay){entered();await new Promise(r=>release=r);delay=false;}res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:data.id,result:data.method==='eth_chainId'?'0x1':'0x'}));});t.after(()=>rpc.close());
 const dir=scratch(),dbPath=join(dir,'auth.sqlite'),origin='http://127.0.0.1:18996';const a=await createApp({origin,dev:true,dbPath,wallet:{rpcUrl:rpc.origin}}),b=await createApp({origin,dev:true,dbPath,wallet:{rpcUrl:rpc.origin}});await a.listen(18996);await b.listen(18997);t.after(()=>a.close());t.after(()=>b.close());
 const player=await browser(origin);const proof=async()=>{const n=(await player.post('/api/wallet/nonce')).json().nonce;const m=await player.post('/api/wallet/message',{nonce:n,address:account.address,chainId:1});return {message:m.text,signature:await account.signMessage({message:m.text})};};
 let signed=await proof();const other=()=>request('http://127.0.0.1:18997','/api/wallet/verify',{method:'POST',headers:{host:'127.0.0.1:18996',origin,cookie:player.cookie,'x-csrf-token':player.csrf,'content-type':'application/json'},body:JSON.stringify(signed)});
 const results=await Promise.all([player.post('/api/wallet/verify',signed),other()]);assert.deepEqual(results.map(x=>x.status).sort(),[200,401]);player.cookie=results.find(x=>x.status===200).cookie;player.csrf=results.find(x=>x.status===200).json().csrf;
 let logout=await player.post('/auth/logout');player.csrf=logout.json().csrf;
 signed=await proof();delay=true;const pending=player.post('/api/wallet/verify',signed);await arrived;logout=await player.post('/auth/logout');player.csrf=logout.json().csrf;release();const late=await pending;assert.equal(late.status,401);assert.equal(late.cookie,undefined);assert.equal((await player.get('/api/session')).json().authenticated,false);
 signed=await proof();a.store.db.exec("CREATE TRIGGER fixture_fail_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT,'fixture store failure'); END;");const failed=await player.post('/api/wallet/verify',signed);assert.equal(failed.status,500);assert.equal(failed.cookie,undefined);a.store.db.exec('DROP TRIGGER fixture_fail_session');assert.equal((await player.get('/api/session')).json().authenticated,false);assert.equal((await player.post('/api/wallet/verify',signed)).status,401);
});
test('transactional generation/expiry checks persist across new store connections and rollback preserves nonce phase',()=>{
 let now=1000;const path=join(scratch(),'auth.sqlite');const a=new Store(path,()=>now),b=new Store(path,()=>now);try{
  const session=a.bootstrap();const flow=a.issue('urbit',session.row);const claimed=b.claim(flow.secret,'urbit');const completion=b.completion(claimed,{provider:'urbit',id:'~zod',displayName:'~zod'});const saved=a.flow(completion,'urbit');
  const logout=a.logout(session.row);assert.throws(()=>b.finish(saved,saved.data.user));assert.equal(b.valid(b.lookup(logout.token)),true);
  const newFlow=b.issue('urbit',logout.row);now+=300001;assert.throws(()=>a.claim(newFlow.secret,'urbit'));
 }finally{a.close();b.close();}
});
