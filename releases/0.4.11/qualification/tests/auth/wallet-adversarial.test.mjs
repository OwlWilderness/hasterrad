import test from 'node:test';import assert from 'node:assert/strict';import {join} from 'node:path';import {privateKeyToAccount} from 'viem/accounts';
import {createApp} from '../../server/app.mjs';import {browser,fixture,scratch} from './helpers.mjs';
const account=privateKeyToAccount('0x'+'1'.padStart(64,'0'));
test('wrong-chain RPC, timeout/error and real wrong-key signature fail closed; new nonce replaces old and rate is bounded',async t=>{
 let mode='chain';const methods=[];const rpc=await fixture(async(req,res)=>{let body='';for await(const x of req)body+=x;const payload=JSON.parse(body);methods.push(payload.method);res.setHeader('content-type','application/json');if(mode==='timeout')await new Promise(r=>setTimeout(r,120));res.end(JSON.stringify(mode==='error'?{jsonrpc:'2.0',id:payload.id,error:{code:-32000,message:'fixture RPC failure'}}:{jsonrpc:'2.0',id:payload.id,result:payload.method==='eth_chainId'?(mode==='chain'?'0x2':'0x1'):'0x'}));});t.after(()=>rpc.close());
 const origin='http://127.0.0.1:18998';const app=await createApp({origin,dev:true,dbPath:join(scratch(),'auth.sqlite'),wallet:{rpcUrl:rpc.origin,timeout:40}});await app.listen(18998);t.after(()=>app.close());
 const challenge=async b=>{const nonce=(await b.post('/api/wallet/nonce')).json().nonce;const m=await b.post('/api/wallet/message',{nonce,address:account.address,chainId:1});return {message:m.text,signature:await account.signMessage({message:m.text})};};
 for(mode of ['chain','error','timeout','valid']){const b=await browser(origin);const proof=await challenge(b);if(mode==='valid')proof.signature=await privateKeyToAccount('0x'+'2'.padStart(64,'0')).signMessage({message:proof.message});const bad=await b.post('/api/wallet/verify',proof);assert.equal(bad.status,401,mode);assert.equal(bad.cookie,undefined);assert.equal((await b.get('/api/session')).json().authenticated,false);}
 mode='valid';const b=await browser(origin),old=await challenge(b),fresh=await challenge(b);assert.equal((await b.post('/api/wallet/verify',old)).status,401);assert.equal((await b.post('/api/wallet/verify',fresh)).status,200);
 const limited=await browser(origin);for(let i=0;i<10;i++)assert.equal((await limited.post('/api/wallet/nonce')).status,200);assert.equal((await limited.post('/api/wallet/nonce')).status,429);
 assert.ok(methods.every(x=>['eth_chainId','eth_getCode','eth_call'].includes(x)));
});
