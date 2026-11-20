import test from 'node:test';
import assert from 'node:assert/strict';
import * as chart from '../../hasterrad-game/source/public/assets/eth-chart.mjs';
import {historyFixture} from './personal-history-fixture.mjs';

const minute=180*60;
const points=Array.from({length:60},(_,i)=>[minute-(60-i)*60,i<51?100:110]);
test('trades replace one provisional close; rollover uses only the confirmed close',()=>{
  assert.equal(typeof chart.liveChartPaths,'function','missing live projection');
  const plot=chart.liveChartPaths, original=structuredClone(points);
  const a=plot(points,{price:109,asOf:(minute+15)*1000},minute);
  const b=plot(points,{price:104,asOf:(minute+30)*1000},minute);
  const closed=plot(points,null,minute);
  for(const key of ['rsi','macd','signal']){
    assert.equal(a[key],closed[key]);
    assert.equal(b[key],closed[key]);
    assert.match(a[`${key}-pending`],/L 1002.08 [\d.]+$/);
    assert.match(b[`${key}-pending`],/L 1004.17 [\d.]+$/);
    assert.notEqual(a[`${key}-pending`].split(' ').at(-1),b[`${key}-pending`].split(' ').at(-1),key);
  }
  const next=[...points,[minute,108]];
  const later={price:106,asOf:(minute+72)*1000};
  const stale={price:104,asOf:(minute+30)*1000};
  const gap=plot(points,later,minute+60), noTick=plot(points,null,minute+60);
  for(const key of ['rsi','macd','signal'])assert.equal(gap[key],noTick[key]);
  assert.equal(gap['signal-pending'],'');
  assert.deepEqual(plot(next,stale,minute+60),plot(next,null,minute+60));
  assert.match(plot(next,later,minute+60)['signal-pending'],/L 1001.67 [\d.]+$/);
  assert.notEqual(plot(next,null,minute+60).signal,plot(points,null,minute+60).signal);
  assert.deepEqual(points,original);
});

test('startup price uses actual completed closes on the two-hour axis, breaking at missing minutes',()=>{
  const closes=[[minute-7260,100],[minute-7200,110],
    [minute-7140,100],[minute-7020,110],[minute-60,100],[minute,10000]];
  assert.equal(chart.liveChartPaths(closes,null,minute).price,
    'M 0 77.33 L 8.33 22.67 L 16.67 77.33 M 33.33 22.67 h 0 M 1000 77.33 h 0');
});

test('SMA provisional tip replaces one RSI input and uses the fixed RSI axis',()=>{
  const closes=Array.from({length:29},(_,i)=>[minute-(29-i)*60,100+i]);
  const tick=(price,offset)=>({price,asOf:(minute+offset)*1000});
  const plot=(trade,history=closes,m=minute)=>chart.liveChartPaths(history,trade,m);
  assert.match(plot(null).rsiAvg??'',/L 1000 9$/);
  // Only the tentative minute changes. The previous RSI inputs were all 100.
  const y=drop=>Number((91-.82*((1300+100*13/(13+drop))/14)).toFixed(2));
  for(const [drop,offset,x] of [[13,15,1002.08],[39,30,1004.17]]){
    const drawn=plot(tick(128-drop,offset));
    assert.equal(drawn.rsiAvg,plot(null).rsiAvg);
    assert.equal(drawn['rsiAvg-pending'],`M 1000 9 L ${x} ${y(drop)}`);
  }
  assert.equal(plot(tick(130,72),closes,minute+60)['rsiAvg-pending'],'');
  const confirmed=[...closes,[minute,128-26]];
  assert.match(plot(null,confirmed,minute+60).rsiAvg,new RegExp(`L 1000 ${y(26)}$`));
  assert.equal(plot(tick(130,15),closes.slice(-27))['rsiAvg-pending'],'M 1002.08 9 h 0','the first warmed tentative sample does not invent a segment');
});

test('actual second vertices are additive, with no bridge from candles or across missing seconds',()=>{
  const tick=(s,price)=>({asOf:(minute+s)*1000,price});
  const a=tick(-.2,100), b=tick(.8,102), c=tick(2.9,101), d=tick(3.7,98);
  const plot=(m,ts)=>chart.liveChartPaths(points,ts.at(-1),m,ts).price;
  const seconds=(m,ts)=>{
    const candles=plot(m,[]), both=plot(m,ts);
    assert.ok(candles&&both.startsWith(candles+' '),'confirmed trace is unchanged by ticks');
    return both.slice(candles.length+1);
  };
  assert.match(seconds(minute,[a]),/^M 999\.97 [\d.]+ h 0$/);
  assert.deepEqual(seconds(minute,[a,b,c,d]).match(/[ML] [\d.]+/g),['M 999.97','L 1000.11','M 1000.4','L 1000.51']);
  assert.deepEqual(seconds(minute+60,[a,b,c,d]).match(/[ML] [\d.]+/g),['M 991.64','L 991.78','M 992.07','L 992.18']);
});

test('two-hour live trace keeps clip-entry vertices with indicators already warmed',()=>{
  const closes=Array.from({length:180},(_,i)=>[i*60,100+i/8]);
  const start=minute-7200;
  const samples=Array.from({length:7262},(_,i)=>({asOf:(start-2+i)*1000,price:100+(i%11)}));
  const confirmed=chart.liveChartPaths(closes,null,minute);
  for(const key of ['price','rsi','macd','signal']){
    assert.match(confirmed[key],/^M -8\.33 .* L 1000 [\d.]+$/);
    assert.equal(confirmed[key].match(/[ML] /g).length,122,key);
  }
  const data=chart.liveChartPaths(closes,samples.at(-1),minute,samples);
  assert.ok(data.price.startsWith(confirmed.price+' M -0.14 '));
  assert.match(data.price,/L 1008\.19 [\d.]+$/);
  assert.equal(data.price.slice(confirmed.price.length).match(/[ML] /g).length,7261);
});

test('shared demand-driven ticker has no minute fetches, backs off and expires',async t=>{
  const now=1795044830000;
  let clock=now, trade=1, failure=false, calls=[];
  const address='0x1234567890abcdef1234567890abcdef1234abcd';
  const walletOwner={provider:'ethereum',id:`ethereum:1:${address}`,displayName:address};
  const {origin,a,b,signIn,cookie}=await historyFixture(t,{walletOwner,appOptions:{clock:()=>clock,ethMarketOrigin:'https://api.exchange.coinbase.com',
    ethMarketFetch:async (url,init)=>{
      calls.push(url.pathname);assert.equal(init.credentials,'omit');
      await new Promise(r=>setTimeout(r,10));
      return failure?new Response(null,{status:503}):Response.json({price:String(1900+trade),time:new Date(clock-100).toISOString(),trade_id:trade});
    }}});
  const other=signIn(walletOwner);
  const get=(s=a,csrf=s?.row.csrf,path='/api/eth-market/tick')=>fetch(origin+path,{headers:s?{Cookie:cookie(s),'X-CSRF-Token':csrf}:undefined});
  assert.equal((await get(null)).status,401);
  assert.equal((await get(b)).status,403);
  assert.equal((await get(a,'bad')).status,403);
  assert.equal((await get(a,a.row.csrf,'/api/eth-market/tick?other=true')).status,400);
  assert.deepEqual(calls,[]);
  const sample=async s=>{const r=await get(s);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');return r.json();};
  const first=await Promise.all([sample(a),sample(other),sample(a)]);
  assert.deepEqual(first,Array(3).fill({price:1901,asOf:now-100,expiresAt:now-100+15000}));
  assert.equal(calls.length,1);
  clock+=999;trade++;
  assert.deepEqual(await sample(other),first[0]);
  clock++;
  assert.equal((await sample(other)).price,1902);
  clock+=1000;failure=true;
  assert.equal((await sample()).price,1902);
  clock+=1000;
  assert.equal((await sample()).price,1902);
  assert.equal(calls.length,3);
  clock+=15000;
  assert.equal(await sample(),null);
  assert.deepEqual(calls,Array(4).fill('/products/ETH-USD/ticker'));
});
