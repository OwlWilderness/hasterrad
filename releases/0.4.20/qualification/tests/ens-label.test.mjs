import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const {confirmedEnsName}=await import('../../hasterrad-game/source/api/server/ens.mjs');
const address='0x1234567890abcdef1234567890abcdef1234abcd';
test('uses a .eth reverse name only when its forward address matches',async()=>{
  const client={getEnsName:async()=> 'pilot.eth',getEnsAddress:async()=>address.toUpperCase()};
  assert.equal(await confirmedEnsName(client,address),'pilot.eth');
});
test('rejects stale and unrelated reverse names',async()=>{
  for(const name of ['pilot.eth','pilot.xyz','<script>.eth']){
    const client={getEnsName:async()=>name,getEnsAddress:async()=> '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'};
    assert.equal(await confirmedEnsName(client,address),null);
  }
});
test('ENS client disables untrusted offchain gateway lookups',()=>{
  const wallet=readFileSync(fileURLToPath(new URL('../../hasterrad-game/source/api/server/wallet.mjs',import.meta.url)),'utf8');
  assert.match(wallet,/ensClient=createPublicClient\(\{chain:mainnet,ccipRead:false,/);
  assert.match(wallet,/confirmedEnsName\(ensClient,address\)/);
});
test('RPC failures leave the address fallback available',async()=>{
  assert.equal(await confirmedEnsName({getEnsName:async()=>{throw Error('offline');}},address),null);
});
