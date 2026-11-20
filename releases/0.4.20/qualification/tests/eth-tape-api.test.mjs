import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {historyFixture} from './personal-history-fixture.mjs';

const path='/api/eth-market/trades', market='https://api.exchange.coinbase.com';
const walletOwner={provider:'ethereum', id:'ethereum:1:0x1234567890abcdef1234567890abcdef1234abcd'};

test('same tick auth gates; anonymous shared recent Coinbase page projects individual fills losslessly', async t=>{
  let now=Date.now(), calls=[], resolve;
  const date=ms=>new Date(now+ms).toISOString();
  const fill=(trade_id,time,side='sell')=>({trade_id,time,side,price:'1781.50000000',size:'0.00487229',unused:'discard'});
  const opts={walletOwner,appOptions:{clock:()=>now,ethMarketOrigin:market,ethMarketFetch:(url,init)=>{
    calls.push({url,init});return new Promise(ok=>{resolve=ok;});
  }}};
  const {app,origin,a,b,cookie,signIn}=await historyFixture(t,opts);
  const get=(session, csrf=session?.row.csrf,p=path)=>fetch(origin+p,{headers:session?{Cookie:cookie(session),'X-CSRF-Token':csrf}:{}});
  assert.equal((await get()).status,401);
  assert.equal((await get(b)).status,403);
  assert.equal((await get(a,b.row.csrf)).status,403);
  assert.equal((await get(a,a.row.csrf,path+'?limit=999')).status,400);
  assert.equal(calls.length,0);
  const other=signIn(walletOwner);
  const first=get(a), second=get(other);
  await waitFor(()=>calls.length===1);
  const earlier=fill('9007199254740992',date(-700),'buy');
  const later=fill('9007199254740993',date(-600));
  const project=(row,side)=>({id:row.trade_id,time:row.time,price:row.price,size:row.size,side});
  const page=rows=>new Response(JSON.stringify(rows).replace('"9007199254740993"','9007199254740993'));
  resolve(page([later, earlier, later, fill('3',date(-20_000)), fill('4',date(6000)), {...later,trade_id:'5',time:'last week'}, {...later,trade_id:'6',size:'1e-4'}]));
  const pair=[project(earlier,'sell'),project(later,'buy')];
  for(const response of await Promise.all([first,second])){
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    assert.deepEqual(await response.json(),{trades:pair});
  }
  assert.equal((await get(other)).status,200);
  assert.equal(calls.length,1);
  const [{url,init}]=calls;
  assert.equal(url.href,market+'/products/ETH-USD/trades?limit=50');
  assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');
  assert.deepEqual(init.headers,{Accept:'application/json'});
  assert.ok(init.signal instanceof AbortSignal);

  now+=2000; const overlap=get(other);
  await waitFor(()=>calls.length===2);
  const next=fill('9007199254740994',date(-100));
  resolve(page([next,later]));
  assert.deepEqual(await (await overlap).json(),{trades:[...pair,project(next,'buy')]});

  now+=20_000;const pending=get(a);
  await waitFor(()=>calls.length===3);
  app.store.logout(a.row);
  resolve(new Response('x'.repeat(33_000)));
  assert.equal((await pending).status,401);
  assert.equal((await get(other)).status,503);
  assert.equal(calls.length,3,'failed requests back off');
  now+=31_000;const empty=get(other);
  await waitFor(()=>calls.length===4);
  resolve(Response.json([]));
  assert.deepEqual(await (await empty).json(),{trades:[]});
});

async function waitFor(check){
  for(let i=0;i<100&&!check();i++)await sleep(10);
  assert.ok(check(),'upstream request did not arrive');
}
