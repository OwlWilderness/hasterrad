import test from 'node:test';import assert from 'node:assert/strict';import {join} from 'node:path';import {Store} from '../../server/store.mjs';import {scratch} from './helpers.mjs';
test('retention keeps revoked cookie family through expiry, then removes expired private auth material and old rate buckets',()=>{
 let now=1000;const store=new Store(join(scratch(),'auth.sqlite'),()=>now);try{
  const original=store.bootstrap();const flow=store.issue('wallet',original.row);store.rate('fixture',10);const current=store.logout(original.row);
  assert.equal(typeof store.prune,'function','durable store has expiry retention cleanup');store.prune();assert.ok(store.lookup(original.token));assert.ok(store.lookup(current.token));assert.ok(store.get('SELECT id FROM flows WHERE id=?',(awaitHash(flow.secret))));
  now+=86400001;store.prune();assert.equal(store.get('SELECT count(*) AS n FROM sessions').n,0);assert.equal(store.get('SELECT count(*) AS n FROM flows').n,0);assert.equal(store.get('SELECT count(*) AS n FROM families').n,0);assert.equal(store.get('SELECT count(*) AS n FROM rates').n,0);
 }finally{store.close();}
});
test('anonymous bootstrap of a pre-rotation cookie retains its family so subsequent logout revokes every descendant',()=>{
 const store=new Store(join(scratch(),'auth.sqlite'));try{
  const original=store.bootstrap();const issued=store.issue('urbit',original.row),flow=store.claim(issued.secret,'urbit',original.row);const loggedIn=store.finish(flow,{provider:'urbit',id:'~zod',displayName:'~zod'});
  const bootstrapped=store.bootstrap(original.token);assert.equal(bootstrapped.row.family,original.row.family,'known revoked cookies must not fork a new browser family');
  store.logout(original.row);assert.equal(store.valid(store.lookup(loggedIn.token)),false);assert.equal(store.valid(store.lookup(bootstrapped.token)),false);
 }finally{store.close();}
});
import {hash as awaitHash} from '../../server/store.mjs';
