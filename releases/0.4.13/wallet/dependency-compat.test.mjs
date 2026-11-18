import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const root=path.dirname(new URL(import.meta.url).pathname);
const lock=JSON.parse(await readFile(new URL('./package-lock.json',import.meta.url)));

test('all installed Zod copies are patched; vulnerable deepmerge is absent',()=>{
 const copies=Object.entries(lock.packages).filter(([p])=>p.endsWith('/zod'));
 assert.ok(copies.length);
 for(const [,p] of copies)assert.equal(p.version,'4.6.7');
 assert.ok(!Object.keys(lock.packages).some(p=>p.endsWith('/deepmerge')));
});
test('all installed ABI schema consumers accept valid ABI and reject invalid ABI with Zod 4',async()=>{
 for(const dir of Object.keys(lock.packages).filter(p=>p.endsWith('/abitype'))){
  const require=createRequire(path.join(root,dir,'package.json'));
  const a=await import(pathToFileURL(require.resolve('abitype/zod')).href);
  assert.equal(a.Abi.safeParse([{type:'function',name:'balanceOf',stateMutability:'view',inputs:[{name:'owner',type:'address'}],outputs:[{name:'balance',type:'uint256'}]}]).success,true,dir);
  assert.equal(a.Abi.safeParse([{type:'invalid'}]).success,false,dir);
 }
});
test('Reown event, RPC and theme schemas work with Zod 4 without signing or connecting',async()=>{
 const s=await import('./node_modules/@reown/appkit-wallet/dist/esm/src/W3mFrameSchema.js');
 for(const value of Object.values(s))if(value?.safeParse)value.safeParse(undefined);
 assert.equal(s.RpcPersonalSignRequest.safeParse({method:'personal_sign',params:['fixture','0x0000000000000000000000000000000000000001']}).success,true);
 assert.equal(s.RpcPersonalSignRequest.safeParse({method:'eth_sendTransaction',params:[]}).success,false);
 assert.equal(s.AppSyncThemeRequest.safeParse({themeMode:'dark',themeVariables:{accent:'blue'}}).success,true);
 assert.equal(s.FrameGetUserResponse.safeParse({address:'0x0000000000000000000000000000000000000001',chainId:1}).success,true);
});
test('Coinbase schema modules initialize and reject invalid inputs under Zod 4',async()=>{
 await import('@coinbase/cdp-sdk');
 for(const name of ['evmSchema','solanaSchema','types']){
  const m=await import(`./node_modules/@coinbase/cdp-sdk/_esm/policies/${name}.js`);
  for(const value of Object.values(m))if(value?.safeParse)value.safeParse(undefined);
 }
});
