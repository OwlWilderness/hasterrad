import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('../../hasterrad-game/source/public/assets/hasterrad-scores.js',import.meta.url));
function fixture(responses){
  const elements=new Map(),requests=[];
  const el=id=>{if(!elements.has(id))elements.set(id,{id,textContent:'',hidden:false,disabled:false,children:[],listeners:new Map(),
    addEventListener(event,fn){this.listeners.set(event,fn);},replaceChildren(...children){this.children=children;},
    append(...children){this.children.push(...children);}});return elements.get(id);};
  const document={getElementById:el,createElement:tag=>({tag,textContent:'',className:'',children:[],append(...children){this.children.push(...children);}})};
  const sandbox={document,console,setTimeout,clearTimeout,AbortController,fetch:async(path,options={})=>{
    requests.push({path,options});const r=responses[path];return {ok:!!r,status:r?200:404,json:async()=>r};},
    addEventListener(){}};sandbox.window=sandbox;vm.createContext(sandbox);
  vm.runInContext(readFileSync(script,'utf8'),sandbox);
  return {adapter:sandbox.HasterradScores,el,requests};
}
test('signed-in runs post replay data with CSRF; guests never start a server run',async()=>{
  const address='/api/runs/run-1/finish';
  const f=fixture({'/api/leaderboard':{board:[]},'/api/session':{authenticated:true,csrf:'csrf-test'},
    '/api/runs/start':{run_id:'run-1',seed:7},[address]:{score:100}});
  const run=await f.adapter.start(780,620);
  assert.equal(run.id,'run-1');assert.equal(run.seed,7);
  const replay={ticks:2000,frames:[[0,0,-1,0,780,620]],score:100,wave:1,duration_ms:16667};
  await f.adapter.finish(run,replay);
  const begin=f.requests.find(x=>x.path==='/api/runs/start');
  assert.equal(JSON.parse(begin.options.body).version,'hasterrad-3');
  assert.equal(JSON.parse(begin.options.body).width,780);
  assert.equal(begin.options.headers['X-CSRF-Token'],'csrf-test');
  assert.equal(f.requests.find(x=>x.path===address).options.headers['X-CSRF-Token'],'csrf-test');
  assert.equal(JSON.parse(f.requests.find(x=>x.path===address).options.body).frames.length,1);
  assert.equal(f.el('score-retry').hidden,true);
  const guest=fixture({'/api/leaderboard':{board:[]},'/api/session':{authenticated:false}});
  assert.equal(await guest.adapter.start(780,620),null);
  assert.equal(guest.requests.some(x=>x.path==='/api/runs/start'),false);
});

test('top five renders provider icons, levels and names as text using fixed local assets',async()=>{
  const rows=Array.from({length:11},(_,i)=>({name:i===0?'<img onerror=alert(1)>':`~user${i}`,
    provider:i===1?'ethereum':i===2?'remilianet':'urbit',score:100-i,level:i+1}));
  const f=fixture({'/api/session':{authenticated:false,providers:{}},'/api/leaderboard':{board:rows}});
  await f.adapter.refresh();
  assert.equal(f.el('leaderboard-list').children.length,5);
  const first=f.el('leaderboard-list').children[0].children[0].children;
  assert.equal(first[0].src,'assets/brands/urbit.svg');
  assert.equal(first[0].alt,'Urbit');
  assert.equal(first[1].textContent,'<img onerror=alert(1)>');
  assert.equal(first[2].textContent,'LV 01');
  assert.equal(first[3].textContent,'100');
  assert.equal(f.el('leaderboard-list').children[1].children[0].children[0].src,'assets/brands/ethereum.svg');
  assert.equal(f.el('leaderboard-list').children[2].children[0].children[0].src,'assets/brands/remilia.png');
  assert.deepEqual(f.requests.map(x=>x.path).filter(x=>x.includes('leaderboard')),['/api/leaderboard','/api/leaderboard']);
});

test('an unrecognized provider is not turned into an image source',async()=>{
  const f=fixture({'/api/leaderboard':{board:[{name:'bad',provider:'../../private',score:10,level:1}]}});
  await f.adapter.refresh();
  assert.equal(f.el('leaderboard-list').children.length,0);
});
