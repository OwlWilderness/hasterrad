import test from 'node:test';
import assert from 'node:assert/strict';
import {AuthSession} from '../../hasterrad-game/source/public/assets/auth-session.mjs';

const address='0x0000000000000000000000000000000000000001';
function fixture(){
 const calls=[];
 const anonymous={authenticated:false,csrf:'fixture-csrf',providers:{wallet:true,remilianet:false,urbit:false},wallet:{chainId:1}};
 const auth=new AuthSession({fetcher:async(path,opts)=>{
   calls.push(path);
   if(path==='/api/session')return {ok:true,json:async()=>anonymous};
   if(path==='/api/wallet/nonce')return {ok:true,json:async()=>({nonce:'synthetic-nonce'})};
   if(path==='/api/wallet/message')return {ok:true,text:async()=> 'synthetic SIWE message'};
   if(path==='/auth/logout')return {ok:true,json:async()=>anonymous};
   throw Error('unexpected request');
 }});
 return {auth,calls};
}
test('RainbowKit nonce may arrive before wallet connection; message binds current account after connection',async()=>{
 const {auth,calls}=fixture();await auth.refresh();
 const nonce=await auth.getNonce();assert.equal(nonce,'synthetic-nonce');
 auth.observe({status:'connected',address,chainId:1});
 const message=await auth.createMessage({nonce,address,chainId:1});
 assert.equal(message,'synthetic SIWE message');
 assert.deepEqual(calls,['/api/session','/api/wallet/nonce','/api/wallet/message']);
});
test('nonce cannot be used after disconnect, account change, or sign out',async()=>{
 for(const state of ['disconnect','change','logout']){
  const {auth,calls}=fixture();await auth.refresh();const nonce=await auth.getNonce();
  auth.observe({status:'connected',address,chainId:1});
  if(state==='disconnect')auth.observe({status:'disconnected'});
  if(state==='change')auth.observe({status:'connected',address:'0x0000000000000000000000000000000000000002',chainId:1});
  if(state==='logout')await auth.logout();
  await assert.rejects(auth.createMessage({nonce,address,chainId:1}));
  assert.equal(calls.includes('/api/wallet/message'),false,state);
 }
});
