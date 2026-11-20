import test from 'node:test';
import assert from 'node:assert/strict';
import {indicators, chartPaths} from '../../hasterrad-game/source/public/assets/eth-chart.mjs';
const points=(closes,start=0)=>closes.map((v,i)=>[start+i*60,v]);
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);

test('Wilder RSI textbook inputs: seed, then Wilder smoothing',()=>{
  const closes=[44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28,46.00,46.03];
  const r=indicators(points(closes));
  assert.equal(r[13].rsi,null);
  near(r[14].rsi,70.46413502109705);
  near(r[15].rsi,66.24961855355508);
  near(r[16].rsi,66.48094183471265);
});

test('SMA uses exactly the last 14 Wilder RSI values and reseeds after a missing minute',()=>{
  const closes=Array.from({length:40},(_,i)=>100+3*Math.sin(i/2)+i/8);
  const input=[...points(closes),...points(closes.slice().reverse(),41*60)];
  const rows=indicators(input);
  for(const start of [0,40]){
    assert.ok(rows.slice(start,start+27).every(r=>r.rsiAvg===null));
    for(let i=start+27;i<start+40;i++){
      near(rows[i].rsiAvg,rows.slice(i-13,i+1).reduce((sum,r)=>sum+r.rsi,0)/14);
    }
  }
  assert.equal(chartPaths(input).rsiAvg.match(/M /g).length,2,'no average bridge across the gap');
});

test('MACD and signal match closed-form step-response vector, with SMA seeds',()=>{
  const r=indicators(points([...Array(26).fill(100),...Array(15).fill(110)]));
  const step=j=>10*((25/27)**j-(11/13)**j);
  const signal8=Array.from({length:9},(_,j)=>step(j)).reduce((a,b)=>a+b)/9;
  assert.equal(r[24].macd,null); assert.equal(r[32].signal,null);
  near(r[25].macd,0); near(r[26].macd,step(1)); near(r[33].macd,step(8));
  near(r[33].signal,signal8); near(r[34].signal,signal8*.8+step(9)*.2);
});

test('short, flat, and gappy windows never invent indicator inputs or bridge gaps',()=>{
  const flat=indicators(points(Array(34).fill(8)));
  assert.deepEqual([flat[14].rsi,flat[33].macd,flat[33].signal],[50,0,0]);
  assert.ok(indicators(points([8,9])).every(p=>p.rsi===null&&p.macd===null&&p.signal===null));
  const gap=[...points(Array(45).fill(8)),...points(Array(10).fill(9),46*60)];
  const r=indicators(gap);
  assert.ok(r.slice(-10).every(p=>p.rsi===null&&p.macd===null&&p.signal===null));
  const paths=chartPaths(gap);
  assert.equal((paths.price.match(/M/g)||[]).length,2);
  assert.equal((paths.price.match(/L/g)||[]).length,53);
  assert.ok(paths.rsi&&!paths.rsi.includes('NaN'));
  assert.deepEqual(chartPaths(points([8])),{price:'',rsi:'',rsiAvg:'',macd:'',signal:''});
});

test('two hours use one time axis with hard viewport bounds and pre-window warm-up',()=>{
  const p=points(Array.from({length:180},(_,i)=>100+5*Math.sin(i/4)+i/13));
  const d=chartPaths(p);
  for(const path of Object.values(d)){
    assert.match(path,/^M 0 /);
    assert.match(path,/L 1000 ([0-9.]+)$/);
    assert.equal((path.match(/L/g)||[]).length,120);
  }
  assert.notEqual(d.price,d.rsi);assert.notEqual(d.macd,d.signal);
});
