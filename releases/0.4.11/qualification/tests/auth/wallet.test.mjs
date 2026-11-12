import test from 'node:test';import assert from 'node:assert/strict';import {join} from 'node:path';
import {privateKeyToAccount} from 'viem/accounts';import {parseSiweMessage} from 'viem/siwe';
import {createApp} from '../../server/app.mjs';import {browser,fixture,request,scratch} from './helpers.mjs';
// Public, disposable secp256k1 vector scalar 1; never funded, never broadcasts.
const account=privateKeyToAccount('0x'+'1'.padStart(64,'0'));
test('pinned viem SIWE real signature, canonical bytes, browser/chain binding, atomic replay, durable restart and logout generation',async t=>{
 let code='0x',methods=[];
 const rpc=await fixture(async(req,res)=>{let data='';for await(const part of req)data+=part;const payload=JSON.parse(data);const respond=x=>{methods.push(x.method);assert.ok(['eth_chainId','eth_getCode','eth_call'].includes(x.method));if(x.method==='eth_call')return {jsonrpc:'2.0',id:x.id,error:{code:3,message:'fixture has no EVM'}};return {jsonrpc:'2.0',id:x.id,result:x.method==='eth_chainId'?'0x1':code};};res.setHeader('content-type','application/json');res.end(JSON.stringify(Array.isArray(payload)?payload.map(respond):respond(payload)));});t.after(()=>rpc.close());
 const origin='http://127.0.0.1:18994',dbPath=join(scratch(),'auth.sqlite');let now=Date.now();
 let app=await createApp({origin,dev:true,dbPath,clock:()=>now,wallet:{rpcUrl:rpc.origin}});await app.listen(18994);t.after(()=>app.close());
 const b=await browser(origin),thief=await browser(origin);assert.equal((await b.get('/api/session')).json().authenticated,false);
 const challenge=async(target=b)=>{const n=await target.post('/api/wallet/nonce');assert.equal(n.status,200,n.text);const nonce=n.json().nonce;const m=await target.post('/api/wallet/message',{nonce,address:account.address,chainId:1});assert.equal(m.status,200,m.text);assert.match(m.headers['content-type'],/^text\/plain/);return {nonce,message:m.text,signature:await account.signMessage({message:m.text})};};
 let proof=await challenge();const parsed=parseSiweMessage(proof.message);assert.equal(parsed.domain,'127.0.0.1:18994');assert.equal(parsed.uri,origin+'/auth/wallet');assert.equal(parsed.chainId,1);assert.equal(parsed.nonce,proof.nonce);
 assert.match(parsed.statement,/no gas/i,'no-gas assurance belongs in the signed request, not the wallet chooser');
 assert.match(parsed.statement,/does not authorize a transaction or spending/i);
 assert.equal((await b.post('/api/wallet/message',{nonce:proof.nonce,address:account.address,chainId:2})).status,400);
 assert.equal((await thief.post('/api/wallet/verify',{message:proof.message,signature:proof.signature})).status,401);
 assert.equal((await b.post('/api/wallet/verify',{message:proof.message+' ',signature:proof.signature})).status,401);
 assert.equal((await b.post('/api/wallet/verify',{message:proof.message,signature:'0x'+'00'.repeat(65)})).status,401);
 // Failed verification retires the challenge, including after restart.
 assert.equal((await b.post('/api/wallet/verify',{message:proof.message,signature:proof.signature})).status,401);
 proof=await challenge();const before=b.cookie,oldCsrf=b.csrf;
 const verifies=await Promise.all([b.post('/api/wallet/verify',{message:proof.message,signature:proof.signature}),b.post('/api/wallet/verify',{message:proof.message,signature:proof.signature})]);assert.deepEqual(verifies.map(x=>x.status).sort(),[200,401]);
 const winner=verifies.find(x=>x.status===200);b.cookie=winner.cookie;b.csrf=winner.json().csrf;assert.equal(winner.json().user.provider,'ethereum');assert.equal(winner.json().user.address,account.address);const authenticated=b.cookie;
 await app.close();app=await createApp({origin,dev:true,dbPath,clock:()=>now,wallet:{rpcUrl:rpc.origin}});await app.listen(18994);
 assert.equal((await b.get('/api/session')).json().authenticated,true);
 // Logout using the PRE-VERIFY cookie must revoke a descendant whose cookie arrived late.
 const logout=await request(origin,'/auth/logout',{method:'POST',headers:{cookie:before,origin,'content-type':'application/json','x-csrf-token':oldCsrf},body:'{}'});assert.equal(logout.status,200);
 assert.equal((await request(origin,'/api/session',{headers:{cookie:authenticated}})).json().authenticated,false);
 b.cookie=logout.cookie;b.csrf=logout.json().csrf;assert.equal((await b.post('/api/wallet/verify',{message:proof.message,signature:proof.signature})).status,401);
 proof=await challenge();now+=300001;assert.equal((await b.post('/api/wallet/verify',{message:proof.message,signature:proof.signature})).status,401);now-=300001;
 proof=await challenge();code='0xef0100'+'00'.repeat(20);assert.equal((await b.post('/api/wallet/verify',{message:proof.message,signature:proof.signature})).status,401);code='0x';
 proof=await challenge();assert.equal((await b.post('/api/wallet/verify',{message:proof.message,signature:'0x'+'01'.repeat(100)})).status,401);
 assert.ok(methods.length>=2);assert.ok(methods.every(x=>['eth_chainId','eth_getCode','eth_call'].includes(x)));
});
