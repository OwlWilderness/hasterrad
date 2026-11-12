import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,symlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {createApp} from '../../hasterrad-game/source/api/server/app.mjs';
const require=createRequire(import.meta.url);
const core=require('../../hasterrad-game/source/api/public/assets/asteroids-core.js');
const origin='https://hasterrad.quantumtekh.com';
function req(port,path,{method='GET',session,body,csrf}={}){return new Promise((resolve,reject)=>{
  const headers={Host:new URL(origin).host,Connection:'close'};
  if(session)headers.Cookie=`__Host-hasterrad_session=${session.token}`;
  if(body){headers.Origin=origin;headers['Content-Type']='application/json';headers['X-CSRF-Token']=csrf??session?.row.csrf??'';}
  const r=http.request({host:'127.0.0.1',port,path,method:body?'POST':method,headers},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,json:JSON.parse(text)}));});r.on('error',reject);r.end(body?JSON.stringify(body):undefined);
});}
function login(app,user){const init=app.store.bootstrap();const issued=app.store.issue('fixture',init.row);const flow=app.store.claim(issued.secret,'fixture',init.row);return app.store.finish(flow,user);}
function noInput(seed){const game=core.createGame();game.state.width=780;game.state.height=620;game.start(seed);let ticks=0;
 while(game.state.mode==='playing'&&ticks<72000){game.step(1/120,core.decodeInput([0,-1,0]));ticks++;}
 assert.equal(game.state.mode,'gameover');return {ticks,frames:[[0,0,-1,0,780,620]],score:game.state.score,wave:game.state.wave,duration_ms:Math.round(game.state.time*1000)};
}
test('verified scores persist and the board returns one best run per user',async()=>{
  const root=mkdtempSync(join(tmpdir(),'score-board-')),dbPath=join(root,'auth.sqlite'),scoreDbPath=join(root,'scores.sqlite3');
  let now=Date.now(),savedScore;const config={origin,dbPath,scoreDbPath,clock:()=>now};
  const app=await createApp(config),{port}=await app.listen();
  try{
    assert.deepEqual((await req(port,'/api/leaderboard')).json.board,[]);
    assert.equal((await req(port,'/api/runs/start',{body:{version:'hasterrad-2',mode:'classic'}})).status,401);
    const p=login(app,{provider:'urbit',id:'~zod',displayName:'~zod'});
    let r=await req(port,'/api/runs/start',{session:p,body:{version:'hasterrad-3',mode:'classic',width:780,height:620}});assert.equal(r.status,201);
    const path=`/api/runs/${r.json.run_id}/finish`,proof=noInput(r.json.seed);
    assert.equal((await req(port,path,{session:p,csrf:'wrong',body:proof})).status,403);
    now+=proof.duration_ms+2000;
    assert.equal((await req(port,path,{session:p,body:{...proof,score:999999}})).status,400);
    r=await req(port,path,{session:p,body:proof});assert.equal(r.status,200);assert.equal(r.json.score,proof.score);savedScore=proof.score;
    assert.equal((await req(port,path,{session:p,body:proof})).json.score,proof.score,'retry is idempotent');
    assert.deepEqual((await req(port,'/api/leaderboard')).json.board,[{name:'~zod',provider:'urbit',score:proof.score,level:proof.wave}]);
    assert.equal((await req(port,'/api/me/scores',{session:p})).json.best,proof.score);
  }finally{await app.close();}
  const restarted=await createApp(config),address=await restarted.listen();
  try{assert.equal((await req(address.port,'/api/leaderboard')).json.board[0].score,savedScore);}finally{await restarted.close();}
});

test('Ethereum leaderboard labels use 0x plus four leading and four trailing hex digits',async()=>{
  let now=Date.now();const root=mkdtempSync(join(tmpdir(),'score-wallet-')),app=await createApp({origin,dbPath:join(root,'auth.sqlite'),scoreDbPath:join(root,'scores.sqlite3'),clock:()=>now});
  // Fixture only: wallet cryptographic verification is exercised by the wallet suite.
  app.context.checkWalletSession=async()=>{};
  const {port}=await app.listen();
  try{
    const p=login(app,{provider:'ethereum',id:'ethereum:1:0x1234567890abcdef1234567890abcdef1234abcd',displayName:'0x1234567890abcdef1234567890abcdef1234abcd'});
    const start=await req(port,'/api/runs/start',{session:p,body:{version:'hasterrad-3',mode:'classic',width:780,height:620}});
    assert.equal(start.status,201);
    const board=(await req(port,'/api/leaderboard')).json.board;
    assert.deepEqual(board,[],'an unfinished run is not a high score');
    const proof=noInput(start.json.seed);now+=proof.duration_ms+2000;
    assert.equal((await req(port,`/api/runs/${start.json.run_id}/finish`,{session:p,body:proof})).status,200);
    assert.deepEqual((await req(port,'/api/leaderboard')).json.board,[{name:'0x1234…abcd',provider:'ethereum',score:proof.score,level:proof.wave}]);
    app.context.resolveEns=async()=> 'pilot.eth';
    assert.deepEqual((await req(port,'/api/leaderboard')).json.board,[{name:'pilot.eth',provider:'ethereum',score:proof.score,level:proof.wave}]);
  }finally{await app.close();}
});

test('top five includes the level of each player’s best run, not a different run',async()=>{
  const root=mkdtempSync(join(tmpdir(),'score-five-')),scoreDbPath=join(root,'scores.sqlite3');
  const app=await createApp({origin,dbPath:join(root,'auth.sqlite'),scoreDbPath}),{port}=await app.listen();
  try{
    const db=new DatabaseSync(scoreDbPath);
    for(let i=0;i<6;i++){
      const name=`~aa${String.fromCharCode(98+i)}`,id=`fixture-${i}`;
      db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(id,'urbit','urbit',name,name);
      db.prepare('INSERT INTO scores VALUES(?,?,?,?,?,?,?)').run(`run-${i}`,id,10000-i*1000,i+1,0,9000,i+1);
      db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?)').run(`run-${i}`,id,'fixture',0,100,'fixture-digest',JSON.stringify({verified:true}));
    }
    db.prepare('INSERT INTO scores VALUES(?,?,?,?,?,?,?)').run('lower-run','fixture-0',9999,9,0,9000,2);
    db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?)').run('lower-run','fixture-0','fixture',0,100,'fixture-digest',JSON.stringify({verified:true}));
    db.prepare('INSERT INTO scores VALUES(?,?,?,?,?,?,?)').run('unverified-run','fixture-0',20000,10,0,9000,3);
    db.close();
    const board=(await req(port,'/api/leaderboard')).json.board;
    assert.equal(board.length,5);
    assert.deepEqual(board[0],{name:'~aab',provider:'urbit',score:10000,level:1});
    assert.equal(board[4].score,6000);
  }finally{await app.close();}
});

test('a dangling score-file symlink is rejected before its target is created',async()=>{
  const root=mkdtempSync(join(tmpdir(),'score-link-')),scoreDbPath=join(root,'scores.sqlite3'),target=join(root,'elsewhere.sqlite3');
  symlinkSync(target,scoreDbPath);
  await assert.rejects(createApp({origin,dbPath:join(root,'auth.sqlite'),scoreDbPath}),/score_path_symlink/);
  assert.equal(existsSync(target),false);
});

test('historical version-2 score rows stay readable without touching legacy auth tables',async()=>{
  const root=mkdtempSync(join(tmpdir(),'score-history-')),scoreDbPath=join(root,'scores.sqlite3');
  const db=new DatabaseSync(scoreDbPath);
  db.exec(`PRAGMA user_version=2;
    CREATE TABLE users(id TEXT PRIMARY KEY,provider TEXT NOT NULL,issuer TEXT NOT NULL,subject TEXT NOT NULL,label TEXT NOT NULL,UNIQUE(provider,issuer,subject));
    CREATE TABLE sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,csrf TEXT NOT NULL,expires REAL NOT NULL);
    CREATE TABLE auth(state TEXT PRIMARY KEY,binding TEXT NOT NULL,expires REAL NOT NULL,phase TEXT NOT NULL,subject TEXT);
    CREATE TABLE oidc(state TEXT PRIMARY KEY,binding TEXT NOT NULL,expires REAL NOT NULL,verifier TEXT NOT NULL,nonce TEXT NOT NULL,used INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE runs(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,session_hash TEXT NOT NULL,started REAL NOT NULL,expires REAL NOT NULL,finish_digest TEXT,result TEXT);
    CREATE TABLE scores(run_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,score INTEGER NOT NULL,wave INTEGER NOT NULL,kills INTEGER NOT NULL,duration_ms INTEGER NOT NULL,created REAL NOT NULL);
    CREATE TABLE limits(bucket TEXT PRIMARY KEY,count INTEGER NOT NULL,expires REAL NOT NULL);
    INSERT INTO users VALUES('historical','urbit','urbit','~zod','~zod');
    INSERT INTO scores VALUES('old-run','historical',420,1,4,9000,1);
    INSERT INTO runs VALUES('old-run','historical','historical-session',1,100,'old-digest','not-json');
    INSERT INTO sessions VALUES('sentinel','historical','private',1);`);
  db.close();
  const app=await createApp({origin,dbPath:join(root,'auth.sqlite'),scoreDbPath}),{port}=await app.listen();
  try{assert.deepEqual((await req(port,'/api/leaderboard')).json.board,[],'old unverified rows are retained but cannot rank');}
  finally{await app.close();}
  const check=new DatabaseSync(scoreDbPath,{readOnly:true});
  try{assert.equal(check.prepare('SELECT hash FROM sessions').get().hash,'sentinel');assert.equal(check.prepare('SELECT score FROM scores WHERE run_id=\'old-run\'').get().score,420);assert.equal(check.prepare('PRAGMA user_version').get().user_version,2);}
  finally{check.close();}
});
