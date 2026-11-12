import test from 'node:test';
import assert from 'node:assert/strict';
import {createWalletConnectors} from './src/connectors.mjs';

test('actual wallet factories preserve configuration gaps without a project ID',()=>{
 const result=createWalletConnectors({chainId:1,targetNetworks:[1],projectId:'',burnerWalletMode:'disabled'});
 assert.deepEqual(result.available,['base','safe']);
 assert.deepEqual(result.gaps.map(x=>x.id),['metaMask','walletConnect','ledger','rainbow']);
 assert.equal(result.connectors.length,2);
 assert.equal(result.showBurner,false);
});
test('actual factories retain all six wallet choices with synthetic configuration, without connecting',()=>{
 // Deliberately synthetic fixture. No provider creation, RPC, signing or login.
 const result=createWalletConnectors({chainId:1,targetNetworks:[1],projectId:'0123456789abcdef0123456789abcdef',burnerWalletMode:'disabled'});
 assert.deepEqual(result.available,['metaMask','walletConnect','ledger','base','rainbow','safe']);
 assert.equal(result.gaps.length,0);
 assert.ok(result.connectors.length>=6);
});
