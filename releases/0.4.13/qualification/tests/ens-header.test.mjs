import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as delay} from 'node:timers/promises';
import {createApp} from '../../hasterrad-game/source/api/server/app.mjs';
import {confirmedEnsName} from '../../hasterrad-game/source/api/server/ens.mjs';
import {mountAccount} from '../../hasterrad-game/source/public/assets/account-shell.mjs';
import {AuthSession} from '../../hasterrad-game/source/public/assets/auth-session.mjs';

const address='0x1234567890abcdef1234567890abcdef1234abcd';
const other='0x0000000000000000000000000000000000000002';
const wallet={provider:'ethereum',id:`ethereum:1:${address}`,displayName:address,address,chainId:1};
const label='pilot-fixture.eth';
const short='ethereum: 0x1234…abcd';

async function fixture(t,{lookup=async()=>label,forward=async()=>address,board=false,user=wallet}={}) {
  const dir=mkdtempSync(join(tmpdir(),'ens-header-'));
  const endpoint=await new Promise((resolve,reject)=>{
    // Reserve a dynamic loopback Host; createApp uses exact Host matching.
    import('node:net').then(({createServer})=>{
      const socket=createServer().once('error',reject).listen(0,'127.0.0.1',()=>{
        const {port}=socket.address(); socket.close(()=>resolve(port));
      });
    },reject);
  });
  const origin=`http://127.0.0.1:${endpoint}`;
  const scoreDbPath=join(dir,'scores.sqlite3');
  const app=await createApp({origin,dev:true,dbPath:join(dir,'auth.sqlite'),...(board?{scoreDbPath}:{})});
  t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  await app.listen(endpoint);
  // Fixture-only existing login; no wallet, signature, or external RPC.
  const start=app.store.bootstrap(), issued=app.store.issue('fixture',start.row);
  const session=app.store.finish(app.store.claim(issued.secret,'fixture',start.row),user);
  app.context.checkWalletSession=async()=>true;
  const calls=[];
  app.context.resolveEns=addr=>confirmedEnsName({
    getEnsName:async args=>{calls.push(['reverse',args.address]);return lookup();},
    getEnsAddress:async args=>{calls.push(['forward',args.name]);return forward();}
  },addr);
  if(board){
    const db=new DatabaseSync(scoreDbPath);
    try{
      db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run('fixture','ethereum','eip155',address,address);
      db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?)').run('run','fixture','fixture',0,100,'digest',JSON.stringify({verified:true}));
      db.prepare('INSERT INTO scores VALUES(?,?,?,?,?,?,?)').run('run','fixture',42,1,0,1000,1);
    }finally{db.close();}
  }
  const requests=[];
  const send=(path,opts={},signedIn=true)=>{
    const pending=fetch(origin+path,{...opts,headers:{...opts.headers,Origin:origin,...(signedIn?{Cookie:`hasterrad_dev_session=${session.token}`}:{})}});
    requests.push({path,pending});
    return path==='/api/wallet/display-name'?pending.then(response=>response.clone()):pending;
  };
  const elements=new Map(), node=()=>({dataset:{},append(){},setAttribute(){},addEventListener(){}});
  const element=id=>{if(!elements.has(id))elements.set(id,node());return elements.get(id);};
  // This fixture mounts only the account controls; Brave covers the history DOM.
  const document={querySelector:()=>node(),getElementById:id=>id==='personal-history'?null:element(id),createElement:node,body:node(),addEventListener(){}};
  const window={location:{origin},fetch:send,addEventListener(){}};
  const mount=()=>mountAccount({document,window,loadSession:async()=>({AuthSession:class extends AuthSession {
    constructor(opts){super({...opts,fetcher:send});}
  }})});
  return {app,session,send,mount,requests,calls,header:()=>element('account-status').textContent};
}

async function expectHeader(f,value){
  for(let i=0;i<50&&f.header()!==value;i++)await delay(10);
  assert.equal(f.header(),value);
}

test('existing wallet session shows the same reverse+forward verified ENS as the leaderboard',async t=>{
  const f=await fixture(t,{board:true});
  const board=await (await f.send('/api/leaderboard',{},false)).json();
  assert.deepEqual(board.board,[{name:label,provider:'ethereum',score:42,level:1}]);
  const {auth}=await f.mount();
  await expectHeader(f,`ethereum: ${board.board[0].name}`);
  assert.deepEqual(auth.state.session.user,wallet);
  assert.deepEqual(JSON.parse(f.app.store.lookup(f.session.token).user),wallet);
  assert.deepEqual(f.calls,[['reverse',address],['forward',label],['reverse',address],['forward',label]]);
});

test('unverified names and RPC errors keep the short address without ending the session',async t=>{
  for(const options of [{forward:async()=>other},{lookup:async()=>{throw Error('fixture outage');}}]) {
    await t.test(options.forward?'forward mismatch':'RPC outage',async t=>{
      const f=await fixture(t,options);
      const {auth}=await f.mount();
      assert.equal(f.header(),short);
      const result=await f.requests.find(r=>r.path==='/api/wallet/display-name').pending;
      assert.equal(result.status,200);
      assert.deepEqual(await result.clone().json(),{id:wallet.id,name:null});
      assert.equal(f.header(),short);
      assert.deepEqual(auth.state.session.user,wallet);
    });
  }
});

test('a hung ENS lookup is bounded and does not delay session readiness', {timeout:6000},async t=>{
  const f=await fixture(t,{lookup:()=>new Promise(()=>{})});
  const {auth}=await f.mount();
  assert.equal(f.header(),short);
  assert.equal(auth.state.session.authenticated,true);
  const response=await f.requests.find(r=>r.path==='/api/wallet/display-name').pending;
  assert.equal(response.status,200);
  assert.deepEqual(await response.clone().json(),{id:wallet.id,name:null});
  assert.equal(f.header(),short);
});

test('logout during an ENS lookup does not reintroduce the wallet label',async t=>{
  let release,started;
  const hold=new Promise(resolve=>{release=resolve;}), entered=new Promise(resolve=>{started=resolve;});
  const f=await fixture(t,{lookup:()=>{started();return hold;}});
  const {auth}=await f.mount();
  await entered;
  assert.equal(f.header(),short);
  await auth.logout();
  assert.equal(f.header(),'Guest');
  release(label);
  const response=await f.requests.find(r=>r.path==='/api/wallet/display-name').pending;
  assert.equal(response.status,401);
  assert.equal(f.header(),'Guest');
});

test('guest and non-wallet sessions cannot trigger wallet label resolution',async t=>{
  const f=await fixture(t,{user:{provider:'urbit',id:'~zod',displayName:'~zod'}});
  await f.mount();
  assert.equal(f.header(),'urbit: ~zod');
  assert.equal(f.requests.some(r=>r.path==='/api/wallet/display-name'),false);
  assert.equal((await f.send('/api/wallet/display-name',{},false)).status,401);
  assert.equal((await f.send('/api/wallet/display-name')).status,404);
  assert.deepEqual(f.calls,[]);
});
