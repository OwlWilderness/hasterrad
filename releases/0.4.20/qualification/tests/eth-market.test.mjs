import test from 'node:test';
import assert from 'node:assert/strict';
import {historyFixture} from './personal-history-fixture.mjs';
import {configFromEnv} from '../../hasterrad-game/source/api/server/main.mjs';

const marketOrigin='https://api.exchange.coinbase.com';
const now=1795044830000;
const bucket=Math.floor(now/60000)*60;
const address='0x1234567890abcdef1234567890abcdef1234abcd';
export const candles=(end,count=180)=>Array.from({length:count},(_,i)=>{
  const p=1800+i/8+Math.sin(i*.37)*4+Math.sin(i*.13)*7;
  return [end-60*(count-i),p-1,p+1,p-.5,p,20];
}).reverse();
const walletOwner={provider:'ethereum',id:`ethereum:1:${address}`,displayName:address,address,chainId:1};

test('verified session gate, bounded shared upstream cache and no upstream identity',async t=>{
  let clock=now, calls=[], complete;
  const {app,origin,a,b,signIn,cookie}=await historyFixture(t,{walletOwner,appOptions:{clock:()=>clock,ethMarketOrigin:marketOrigin,
    ethMarketFetch:(url,init)=>{calls.push({url:new URL(url),init});
      if(url.pathname.endsWith('/ticker'))return Response.json({price:'1771.68',time:new Date(clock-2000).toISOString(),trade_id:42+Math.floor((clock-now)/60000)});
      if(url.pathname.endsWith('/stats'))return Response.json({open:'1800',last:'1773',high:'1824.75',low:'1730.87'});
      return new Promise(r=>{complete=r;});}}});
  app.context.checkWalletSession=async()=>true;
  const get=(s,csrf=s?.row.csrf,path='/api/eth-market')=>fetch(origin+path,{headers:s?{Cookie:cookie(s),'X-CSRF-Token':csrf}:undefined});
  assert.equal((await get()).status,401);
  assert.equal((await get(b)).status,403);
  assert.equal((await get(a,'wrong')).status,403);
  assert.equal((await get(a,a.row.csrf,'/api/eth-market?origin=other')).status,400);
  assert.equal(calls.length,0);
  const session=await fetch(origin+'/api/session',{headers:{Cookie:cookie(a)}});
  assert.equal((await session.json()).ethMarket,true);
  const other=signIn(walletOwner);
  const first=get(a), second=get(other);
  while(!complete)await new Promise(r=>setTimeout(r,5));
  const rows=candles(bucket);
  complete(Response.json([[bucket,1,1,1,1,1],...rows]));
  for(const response of await Promise.all([first,second])){
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    const data=await response.json();
    assert.deepEqual(data.points,rows.slice().reverse().map(r=>[r[0],r[4]]));
    assert.equal(data.expiresAt,bucket*1000+150000);
    assert.deepEqual(data.quote,{price:1771.68,asOf:now-2000,expiresAt:now-2000+150000,day:{change:-1.5,high:1824.75,low:1730.87}});
  }
  assert.equal((await get(other)).status,200);assert.equal(calls.length,3);
  const [{url,init}]=calls;
  assert.equal(url.origin,marketOrigin);assert.equal(url.pathname,'/products/ETH-USD/candles');
  assert.deepEqual([...url.searchParams.keys()].sort(),['end','granularity','start']);
  assert.equal(url.searchParams.get('granularity'),'60');
  assert.equal(Date.parse(url.searchParams.get('end'))-Date.parse(url.searchParams.get('start')),180*60000);
  assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert.deepEqual(init.headers,{Accept:'application/json'});
  clock+=60000;complete=null;
  const pending=get(a);
  while(!complete)await new Promise(r=>setTimeout(r,5));
  app.store.logout(a.row);
  complete(new Response('{}',{status:503}));
  assert.equal((await pending).status,401);
  const fallback=await (await get(other)).json();
  assert.deepEqual(fallback.points,rows.slice().reverse().map(r=>[r[0],r[4]]));
  assert.equal(fallback.quote.price,1771.68);
  assert.equal(calls.length,6,'failed requests also back off');
});

test('invalid/blank market origin disables this optional feature',async t=>{
  assert.equal(configFromEnv({HASTERRAD_ETH_MARKET_ORIGIN:marketOrigin}).ethMarketOrigin,marketOrigin);
  for(const ethMarketOrigin of ['',marketOrigin+'/','https://example.com','http://api.exchange.coinbase.com']){
    const {origin,a,cookie,app}=await historyFixture(t,{walletOwner,appOptions:{ethMarketOrigin,
      ethMarketFetch:()=>assert.fail('must not fetch')}});
    app.context.checkWalletSession=async()=>true;
    const headers={Cookie:cookie(a),'X-CSRF-Token':a.row.csrf};
    assert.equal((await (await fetch(origin+'/api/session',{headers})).json()).ethMarket,false);
    assert.equal((await fetch(origin+'/api/eth-market',{headers})).status,503);
  }
});

test('service hides stale candles and rejects oversized responses',async t=>{
  let clock=now, data=Response.json(candles(bucket-180));
  const {origin,a,cookie}=await historyFixture(t,{walletOwner,appOptions:{clock:()=>clock,ethMarketOrigin:marketOrigin,ethMarketFetch:async url=>url.pathname.endsWith('/candles')?data:new Response(null,{status:503})}});
  const get=()=>fetch(origin+'/api/eth-market',{headers:{Cookie:cookie(a),'X-CSRF-Token':a.row.csrf}});
  assert.equal((await get()).status,503);
  clock+=60000;data=new Response(' '.repeat(40000));
  assert.equal((await get()).status,503);
});
