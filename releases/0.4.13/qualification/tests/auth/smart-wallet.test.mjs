import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {readFileSync} from 'node:fs';import {join} from 'node:path';
import {createPublicClient,http,encodeFunctionData,getContractAddress,keccak256,serializeErc6492Signature,serializeErc8010Signature} from 'viem';import {mainnet} from 'viem/chains';import {privateKeyToAccount} from 'viem/accounts';
import {createApp} from '../../server/app.mjs';import {browser,scratch,fixture} from './helpers.mjs';
import {homedir} from 'node:os';import {configFromEnv} from '../../server/main.mjs';
const artifact=JSON.parse(readFileSync(new URL('./smart-fixture.json',import.meta.url))),account=privateKeyToAccount('0x'+'1'.padStart(64,'0'));
const deployed='0x0000000000000000000000000000000000000111',factory='0x0000000000000000000000000000000000000222';
// Real local EVM; state injected by test-only anvil_setCode, no transaction or live RPC.
test('real EVM: ERC1271, deployed/counterfactual ERC6492, EIP7702 authority and retained proof revocation',async t=>{
 const probe=await fixture((req,res)=>res.end());const port=new URL(probe.origin).port;await probe.close();
 const child=spawn(process.env.ANVIL_BIN??join(homedir(),'.foundry/bin/anvil'),['--host','127.0.0.1','--port',port,'--chain-id','1','--hardfork','prague','--accounts','0','--silent'],{stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',x=>stderr+=x);
 t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}});
 const client=createPublicClient({chain:mainnet,transport:http('http://127.0.0.1:'+port,{retryCount:0,timeout:500})});let ready=false;for(let i=0;i<50;i++){try{await client.getChainId();ready=true;break;}catch{await new Promise(r=>setTimeout(r,40));}}assert.ok(ready,stderr);
 const setCode=(address,code)=>client.request({method:'anvil_setCode',params:[address,code]});
 await setCode(deployed,'0x'+artifact.SmartFixture.evm.deployedBytecode.object);await setCode(factory,'0x'+artifact.SmartFactory.evm.deployedBytecode.object);
 const salt='0x'+'00'.repeat(32),counterfactual=getContractAddress({from:factory,opcode:'CREATE2',salt,bytecodeHash:keccak256('0x'+artifact.SmartFixture.evm.bytecode.object)}),factoryData=encodeFunctionData({abi:artifact.SmartFactory.abi,functionName:'make',args:[salt]});
 let now=Date.now();const origin='http://127.0.0.1:19061',dbPath=join(scratch(),'auth.sqlite');let app=await createApp({origin,dev:true,dbPath,clock:()=>now,wallet:{rpcUrl:'http://127.0.0.1:'+port}});await app.listen(19061);t.after(()=>app.close());
 const login=async(address,wrapped=false,signer=account)=>{const b=await browser(origin),nonce=(await b.post('/api/wallet/nonce')).json().nonce,message=(await b.post('/api/wallet/message',{nonce,address,chainId:1})).text;let signature=await signer.signMessage({message});if(wrapped)signature=serializeErc6492Signature({address:factory,data:factoryData,signature});return {b,proof:{message,signature}};};
 const verify=async x=>x.b.post('/api/wallet/verify',x.proof);
 const contract=await login(deployed);assert.equal((await verify(contract)).status,200,'ERC1271 accepted by real EVM');
 const wrapped=await login(deployed,true);assert.equal((await verify(wrapped)).status,200,'deployed wrapped signature');
 const cf=await login(counterfactual,true);assert.equal((await verify(cf)).status,200,'counterfactual factory CREATE2 via eth_call');assert.equal((await client.getCode({address:counterfactual}))??'0x','0x','simulation never persists deployment');
 const bad=await login(deployed,false,privateKeyToAccount('0x'+'2'.padStart(64,'0')));assert.equal((await verify(bad)).status,401);
 const badWrapped=await login(counterfactual,true,privateKeyToAccount('0x'+'2'.padStart(64,'0')));assert.equal((await verify(badWrapped)).status,401,'counterfactual wrong owner');
 await setCode(account.address,'0xef0100'+deployed.slice(2));const delegated=await login(account.address);assert.equal((await verify(delegated)).status,200,'delegated ERC1271 execution');
 // Restart retains original proof, bounds read-side validity to 60s, and refuses authority change.
 await app.close();app=await createApp({origin,dev:true,dbPath,clock:()=>now,wallet:{rpcUrl:'http://127.0.0.1:'+port}});await app.listen(19061);
 assert.equal((await delegated.b.get('/api/session')).json().authenticated,true);
 await setCode(deployed,'0x60006000fd');
 assert.equal((await contract.b.get('/api/session')).json().authenticated,true,'read-only identity cache bounded to 60 seconds');
 const contractRow=app.store.lookup(contract.b.cookie.split('=')[1]);assert.equal(await app.context.checkWalletSession(contractRow,{fresh:true}),false,'future privileged guard bypasses read cache');
 now+=60001;
 const revokedLogin=await login(account.address);assert.equal((await verify(revokedLogin)).status,401,'delegated rejection cannot fall back to ECDSA login');
 assert.equal((await delegated.b.get('/api/session')).json().authenticated,false,'no ECDSA fallback after delegated contract rejects');
 assert.equal((await contract.b.get('/api/session')).json().authenticated,false,'contract proof invalidated');
 await setCode(account.address,'0x');
 const eoa=await login(account.address);assert.equal((await verify(eoa)).status,200,'EOA still supported by official viem path');
 const unsupported=await login(account.address);unsupported.proof.signature=serializeErc8010Signature({authorization:{address:deployed,chainId:1,nonce:0,r:'0x01',s:'0x01',yParity:0},signature:unsupported.proof.signature});assert.equal((await verify(unsupported)).status,422,'unqualified ERC8010 explicitly unsupported (not a real authorization)');
 const oversized=await login(account.address);oversized.proof.signature='0x'+'00'.repeat(6001);assert.equal((await verify(oversized)).status,422);
 // A proof-storage failure cannot commit a partially authenticated session.
 const storage=await login(account.address);app.store.db.exec("CREATE TRIGGER fixture_fail_proof BEFORE INSERT ON wallet_proofs BEGIN SELECT RAISE(ABORT,'fixture proof failure'); END;");assert.equal((await verify(storage)).status,500);app.store.db.exec('DROP TRIGGER fixture_fail_proof');assert.equal((await storage.b.get('/api/session')).json().authenticated,false);
 child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));now+=60001;assert.equal((await eoa.b.get('/api/session')).json().authenticated,false,'RPC outage recheck revokes persisted proof');
});
test('validated nonsecret burner config preserves chain one',async()=>{
 for(const mode of ['disabled','localNetworksOnly','allNetworks'])assert.equal(configFromEnv({HASTERRAD_BURNER_WALLET_MODE:mode}).burnerWalletMode,mode);
 assert.equal(configFromEnv({}).burnerWalletMode,'disabled');
 await assert.rejects(createApp({dev:true,origin:'http://127.0.0.1:19062',dbPath:join(scratch(),'invalid.sqlite'),burnerWalletMode:'enabled'}),/invalid_burner_wallet_mode/);
 const app=await createApp({dev:true,origin:'http://127.0.0.1:19062',dbPath:join(scratch(),'auth.sqlite'),burnerWalletMode:'allNetworks'});try{await app.listen(19062);assert.equal((await browser('http://127.0.0.1:19062')).csrf.length,64);const data=(await (await browser('http://127.0.0.1:19062')).get('/api/session')).json();assert.equal(data.wallet.burnerWalletMode,'allNetworks');assert.equal(data.wallet.chainId,1);}finally{await app.close();}
});
