import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createApp} from '../../hasterrad-game/source/api/server/app.mjs';
const require=createRequire(import.meta.url);
const core=require('../../hasterrad-game/source/api/public/assets/asteroids-core.js');
const root=fileURLToPath(new URL('../../hasterrad-game/source/api/public/',import.meta.url));
const origin='https://hasterrad.quantumtekh.com';
function request(port,path,options={},session){return new Promise((resolve,reject)=>{
  const method=options.method??'GET',headers={Host:new URL(origin).host,Connection:'close',...options.headers};
  if(session)headers.Cookie=`__Host-hasterrad_session=${session.token}`;
  if(method==='POST')headers.Origin=origin;
  const r=http.request({host:'127.0.0.1',port,path,method,headers},res=>{
    const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{
      const body=Buffer.concat(chunks);resolve({ok:res.statusCode>=200&&res.statusCode<300,status:res.statusCode,
        json:async()=>JSON.parse(body.toString('utf8')),body,headers:res.headers});});
  });r.on('error',reject);r.end(options.body);
});}
function fixture(fetch){const elements=new Map();const el=id=>{if(!elements.has(id))elements.set(id,{
  id,textContent:'',hidden:false,disabled:false,children:[],listeners:new Map(),
  addEventListener(event,fn){this.listeners.set(event,fn);},replaceChildren(...nodes){this.children=nodes;},append(...nodes){this.children.push(...nodes);}
});return elements.get(id);};
  const document={getElementById:el,createElement:tag=>({tag,textContent:'',className:'',children:[],append(...nodes){this.children.push(...nodes);}})};
  const sandbox={document,fetch,setTimeout,clearTimeout,AbortController,addEventListener(){},console};sandbox.window=sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(root,'assets/hasterrad-scores.js'),'utf8'),sandbox);
  return {adapter:sandbox.HasterradScores,el};
}
test('shipped account adapter saves a signed-in synthetic run to the actual HTTP score service',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'score-end-to-end-'));let now=Date.now();
  const app=await createApp({origin,dbPath:join(dir,'auth.sqlite'),scoreDbPath:join(dir,'scores.sqlite3'),staticDir:root,clock:()=>now});
  const {port}=await app.listen();
  try{
    const script=await request(port,'/assets/hasterrad-scores.js');
    assert.equal(script.status,200);assert.equal(script.body.toString(),readFileSync(join(root,'assets/hasterrad-scores.js'),'utf8'));
    const first=app.store.bootstrap(),issued=app.store.issue('fixture',first.row),flow=app.store.claim(issued.secret,'fixture',first.row);
    const session=app.store.finish(flow,{provider:'urbit',id:'~zod',displayName:'~zod'});
    const browser=fixture((path,options)=>request(port,path,options,session));
    const run=await browser.adapter.start(780,620);assert.ok(run?.id);assert.ok(Number.isInteger(run.seed));
    assert.equal(browser.el('leaderboard-list').children.length,0);
    const game=core.createGame();game.state.width=780;game.state.height=620;game.start(run.seed);
    let ticks=0;while(game.state.mode==='playing'&&ticks<72000){game.step(1/120,core.decodeInput([0,-1,0]));ticks++;}
    assert.equal(game.state.mode,'gameover');now+=Math.round(game.state.time*1000)+2000;
    await browser.adapter.finish(run,{ticks,frames:[[0,0,-1,0,780,620]],score:game.state.score,wave:game.state.wave,duration_ms:Math.round(game.state.time*1000)});
    assert.equal(browser.el('score-retry').hidden,true);
    const row=browser.el('leaderboard-list').children[0].children[0];
    assert.equal(row.children[0].src,'assets/brands/urbit.svg');
    assert.equal(row.children[1].textContent,'~zod');
    assert.equal(row.children[2].textContent,'LV 01');
    assert.equal(row.children[3].textContent,String(game.state.score));
    const board=(await request(port,'/api/leaderboard')).json;
    assert.deepEqual((await board()).board,[{name:'~zod',provider:'urbit',score:game.state.score,level:game.state.wave}]);
  }finally{await app.close();}
});
