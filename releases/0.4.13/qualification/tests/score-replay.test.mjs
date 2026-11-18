import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {createApp} from '../../hasterrad-game/source/api/server/app.mjs';
import {Scores} from '../../hasterrad-game/source/api/server/scores.mjs';
const require=createRequire(import.meta.url);
const core=require('../../hasterrad-game/source/api/public/assets/asteroids-core.js');
const origin='https://hasterrad.quantumtekh.com';
function req(port,path,{session,body}={}){return new Promise((resolve,reject)=>{
 const headers={Host:new URL(origin).host,Connection:'close'};
 if(session)headers.Cookie=`__Host-hasterrad_session=${session.token}`;
 if(body){headers.Origin=origin;headers['Content-Type']='application/json';headers['X-CSRF-Token']=session?.row.csrf??'';}
 const r=http.request({host:'127.0.0.1',port,path,method:body?'POST':'GET',headers},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,json:JSON.parse(text)}));});r.on('error',reject);r.end(body?JSON.stringify(body):undefined);
});}
function login(app){const init=app.store.bootstrap(),issued=app.store.issue('fixture',init.row),flow=app.store.claim(issued.secret,'fixture',init.row);return app.store.finish(flow,{provider:'urbit',id:'~zod',displayName:'~zod'});}
function noInputRun(seed){const game=core.createGame();game.state.width=780;game.state.height=620;game.start(seed);
 let ticks=0;while(game.state.mode==='playing'&&ticks<36000){game.step(1/120,core.decodeInput([0,-1,0]));ticks++;}
 assert.equal(game.state.mode,'gameover','fixture must actually finish');
 return {ticks,frames:[[0,0,-1,0,780,620]],score:game.state.score,wave:game.state.wave,duration_ms:Math.round(game.state.time*1000)};
}
test('only a server-seeded, replayable complete run enters the top five',async()=>{
 const root=mkdtempSync(join(tmpdir(),'score-replay-'));let now=Date.now();
 const app=await createApp({origin,dbPath:join(root,'auth.sqlite'),scoreDbPath:join(root,'scores.sqlite3'),clock:()=>now}),{port}=await app.listen();
 try{
  const session=login(app),start=await req(port,'/api/runs/start',{session,body:{version:'hasterrad-3',mode:'classic',width:780,height:620}});
  assert.equal(start.status,201,JSON.stringify(start.json));
  assert.ok(Number.isInteger(start.json.seed));
  const path=`/api/runs/${start.json.run_id}/finish`,valid=noInputRun(start.json.seed);
  assert.equal((await req(port,path,{session,body:valid})).status,400,'a run cannot complete faster than its replayed duration');
  now+=valid.duration_ms+2000;
  const another=login(app);
  assert.equal((await req(port,path,{session:another,body:valid})).status,404,'a different session cannot submit this run');
  assert.equal((await req(port,path,{session,body:{...valid,frames:[[0,64,-1,0,780,620]]}})).status,400,'unknown control flags are rejected');
  assert.equal((await req(port,path,{session,body:{...valid,frames:[[0,0,-1,0,780,620],[0,0,-1,0,780,620]]}})).status,400,'repeated or out-of-order ticks are rejected');
  assert.equal((await req(port,path,{session,body:{...valid,frames:[[0,0,-1,0,5000,620]]}})).status,400,'arena dimensions are bounded');
  assert.equal((await req(port,path,{session,body:{large:1,medium:2,small:4,wave:1,duration_ms:9000,saucerLarge:0,saucerSmall:0}})).status,400,'counters alone cannot enter the board');
  assert.equal((await req(port,path,{session,body:{...valid,score:valid.score+100000}})).status,400,'a forged score fails replay');
  assert.equal((await req(port,path,{session,body:{...valid,ticks:valid.ticks-1}})).status,400,'a run that has not ended cannot rank');
  assert.deepEqual((await req(port,'/api/leaderboard')).json.board,[]);
  const saved=await req(port,path,{session,body:valid});assert.equal(saved.status,200,JSON.stringify(saved.json));
  assert.equal(saved.json.score,valid.score);assert.equal(saved.json.verified,true);
  assert.equal((await req(port,path,{session,body:valid})).status,200,'retry is idempotent');
  assert.deepEqual((await req(port,'/api/leaderboard')).json.board,[{name:'~zod',provider:'urbit',score:valid.score,level:valid.wave}]);
 }finally{await app.close();}
});

test('session revocation while a replay runs prevents the score from committing',async()=>{
 const root=mkdtempSync(join(tmpdir(),'score-revoked-'));let now=Date.now();
 const scores=new Scores(join(root,'scores.sqlite3'),join(root,'auth.sqlite'),()=>now),row={id:'fixture-session'},user={provider:'urbit',id:'~zod',displayName:'~zod'};
 try{
  const start=scores.start(row,user,{mode:'classic',version:'hasterrad-3',width:780,height:620});
  const proof=noInputRun(start.seed);now+=proof.duration_ms+2000;
  await assert.rejects(scores.finish(row,user,start.run_id,proof,()=>{throw Error('session_revoked');}),/session_revoked/);
  assert.deepEqual((await scores.board()).board,[]);
 }finally{scores.close();}
});
