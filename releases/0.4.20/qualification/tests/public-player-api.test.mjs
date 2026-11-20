import test from 'node:test';
import assert from 'node:assert/strict';
import {historyFixture} from './personal-history-fixture.mjs';

test('Public player details expose only verified Classic score and level for current top-five members', async t=>{
 const {origin,owner,other,seed}=await historyFixture(t);
 for(let i=0;i<12;i++)seed(owner,`private-run-${String(i).padStart(2,'0')}`,i<3?100:100+i,1700000000,'verified',i+1);
 seed(owner,'most-recent',5,1700000003,'verified',98);
 seed(owner,'never-finished',999999,1700000001,'unfinished');
 seed(owner,'never-verified',999999,1700000002,'legacy');
 seed(other,'other',130,1700000000);
 const board=async()=>(await (await fetch(`${origin}/api/leaderboard`)).json()).board;
 const [,player]=await board();
 assert.equal(player.score,111);
 assert.match(player.playerKey,/^[A-Za-z0-9_-]{43}$/);
 assert.deepEqual(Object.keys(player).sort(),['level','name','playerKey','provider','score']);
 const read=(key,query='')=>fetch(`${origin}/api/leaderboard/players/${key}${query}`);
 const response=await read(player.playerKey);
 assert.equal(response.status,200);
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.deepEqual(await response.json(),{scores:[{score:5,level:98},...Array.from({length:9},(_,i)=>({score:111-i,level:12-i}))]});
 assert.equal((await read(player.playerKey,'?cursor=ignored')).status,400);
 assert.equal((await read('x'.repeat(43))).status,404);
 for(const [i,ship] of ['~bud','~mar','~sev','~net'].entries())seed({id:ship,provider:'urbit',displayName:'Other'},`o-${i}`,200,1700000000);
 assert.ok(!(await board()).some(row=>row.playerKey===player.playerKey));
 assert.equal((await read(player.playerKey)).status,404);
});
