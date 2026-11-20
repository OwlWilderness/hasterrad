import test from 'node:test';
import assert from 'node:assert/strict';
const {playfieldModules} = await import(process.env.HASTERRAD_TAPE_REGISTRY ??
  '../../hasterrad-game/source/public/assets/playfield-modules.mjs');

function fixture(height=120, controls=[], rowWidth=84, rowHeight=25){
  const rows=[],emitted=[],admissions=[],timers=new Map(),requests=[];
  const root={classList:{add(){}},clientHeight:height,clientWidth:420,getBoundingClientRect:()=>({left:0,top:0}),append(clip){rows.push(clip.child);clip.child.clip=clip;},replaceChildren(){rows.length=0;}};
  const controller=new AbortController();
  const media=new EventTarget();media.matches=false;
  let elapsed=0, token=0;
  const now=Date.now();
  let resize;
  const window=Object.assign(new EventTarget(),{matchMedia:()=>media, performance:{now:()=>elapsed}, ResizeObserver:class {
    constructor(cb){resize=cb;} observe(){} disconnect(){resize=undefined;}
  },
    setTimeout(fn,ms){timers.set(++token,{fn,at:elapsed+ms});return token;},clearTimeout(id){timers.delete(id);},
    fetch(url,options){return new Promise(resolve=>requests.push({url,options,resolve}));}});
  const document={hidden:false,querySelectorAll:()=>controls.map(rect=>({getBoundingClientRect:()=>rect}))};
  document.createElement=()=>({dataset:{},style:{},offsetWidth:rowWidth,offsetHeight:rowHeight,append(child){this.child=child;},animate(frames,options){
    if (this.dataset.tradeId) {emitted.push(this.dataset.tradeId);admissions.push({row:this,at:elapsed});}
    const start=elapsed;
    const animation={frames,options,get currentTime(){return elapsed-start;},cancel(){window.clearTimeout(finish);this.cancelled=true;}};
    const finish=window.setTimeout(()=>animation.onfinish?.(),options.duration);
    this.animation=animation;return animation;
  },remove(){const index=rows.indexOf(this.child);if(index!==-1)rows.splice(index,1);}});
  const feed=(id,price='1800.00',side='buy',time=new Date(now).toISOString())=>({id,time,price,size:'0.1',side});
  const advance=ms=>{const end=elapsed+ms;while(timers.size){
    const [id,{at,fn}]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];
    if(at>end)break;elapsed=at;timers.delete(id);fn();
  }elapsed=end;};
  const reply=async (index,trades)=>{requests[index].resolve({ok:true,json:async()=>({trades})});
    await new Promise(resolve=>setImmediate(resolve));};
  const session={csrf:'token',ethMarket:true,user:{provider:'ethereum',id:'ethereum:1:0x1234567890abcdef1234567890abcdef1234abcd'}};
  const spec=playfieldModules.find(x=>x.id==='eth-trade-tape');
  assert.ok(spec,'tape is a built-in playfield module');
  assert.deepEqual(spec.slots,{backdrop:true});
  assert.ok(spec.eligible(session));assert.equal(spec.eligible({...session,user:{provider:'urbit'}}),false);
  const stop=spec.mount({document,window,roots:{backdrop:root},session,signal:controller.signal});
  return {rows,emitted,admissions,requests,feed,advance,reply,stop,controller,media,timers,document,root,window,resize:()=>resize(),now:()=>now+elapsed};
}

test('moving and stationary tape clear the controls and reflow inside the lower band on resize',async()=>{
  const stick={left:14,right:154,top:80,bottom:220,width:140,height:140};
  const action={left:310,right:365,top:160,bottom:218,width:55,height:58};
  const f=fixture(240,[stick,action]);
  f.root.clientWidth=490; // Room for distinct entry columns and a shared middle.
  const {rows,feed,advance,reply,stop}=f;
  const points=row=>row.animation.frames.map(frame=>frame.transform.match(/-?[\d.]+/g).map(Number));
  const check=(row, up, minimum)=>{
    const xy=points(row), clip=row.clip.animation.frames.map(frame=>parseFloat(frame.height));
    const {frames,options}=row.animation;
    let legs=0;
    for(let i=0; i<xy.length-1; i++){
      const [a,b]=xy.slice(i,i+2), bottom=clip[i];
      const dt=(frames[i+1].offset-frames[i].offset)*options.duration;
      if (!dt) continue; // Instant wrap between columns.
      assert.equal(a[0],b[0]);
      if (a[1]===b[1]) {
        assert.fail(`admitted row ${row.dataset.tradeId} held at a wrap for ${dt.toFixed(1)}ms`);
      }
      legs++;
      assert.deepEqual([a[1],b[1]],up?[bottom,-25]:[-25,bottom]);
      assert.ok(Math.abs(Math.abs(a[1]-b[1])/dt*1000-76)<1e-8);
      for(const r of [stick,action]) assert.ok(a[0]+88<=r.left || a[0]>=r.right || bottom<=r.top);
    }
    assert.ok(legs >= minimum);
  };
  await reply(0,[feed('10','100')]);
  advance(1500);await reply(1,[feed('11','101','sell'),feed('12','100'),feed('13','100')]);advance(0);
  check(rows[0],true,2);
  const upDuration=rows[0].animation.options.duration;
  for(let waited=0;waited+25<upDuration&&!rows.some(r=>r.dataset.direction==='down');waited+=25) advance(25);
  const down=rows.find(r=>r.dataset.direction==='down');
  assert.ok(down && rows.some(r=>r.dataset.direction==='up'),'both directions admitted before the first cascade ends');
  check(down,false,2);
  f.root.clientHeight=165; stick.top=5;stick.bottom=145;action.top=90;action.bottom=148;
  f.window.dispatchEvent(new Event('resize'));assert.deepEqual(rows,[],'stale tracks retired before ResizeObserver');
  f.resize();assert.deepEqual(rows,[]);
  advance(10000);
  await reply(2,[feed('14','101')]);advance(1050);
  if(rows.length && rows[0].dataset.direction==='up') check(rows[0],true,1);
  stop();
});

test('chronological exact decimals, not side, select direction even within an overlapping shuffled page',async()=>{
  const {rows,emitted,admissions,requests,feed,advance,reply,stop,controller}=fixture();
  assert.equal(requests[0].url,'/api/eth-market/trades');
  assert.equal(requests[0].options.headers['X-CSRF-Token'],'token');
  assert.equal(requests[0].options.signal,controller.signal);
  const old=feed('9007199254740991','1800.000000000000000001');
  const up=feed('9007199254740992','1800.000000000000000002','sell');
  const flat=feed('9007199254740993','01800.000000000000000002','buy');
  const down=feed('9007199254740994','1800.000000000000000001','buy');
  await reply(0,[old]);assert.equal(rows.length,0);
  advance(1500);await reply(1,[down,flat,up,old,up]);advance(0);
  assert.deepEqual([rows[0].dataset.tradeId,rows[0].dataset.direction,rows[0].dataset.side],[up.id,'up','sell']);
  assert.equal(rows[0].child.textContent, '(S) $1800.000000000000000002');
  const a=rows[0].animation;
  advance(1500);await reply(2,[old,up,flat,down]);
  advance(5000);
  const downRow=admissions.find(({row})=>row.dataset.direction==='down')?.row;
  assert.equal(downRow?.dataset.side,'buy');
  const b=downRow.animation;
  assert.ok(emitted.includes(flat.id));
  assert.equal(a.options.duration,b.options.duration,'same speed in both directions');
  assert.equal(a.options.easing,'linear');
  assert.equal(b.options.easing,'linear');
  advance(15_000);assert.deepEqual(rows,[]);
  stop();
});

test('a discontinuity, failed poll and remount cannot inherit a direction',async()=>{
  const first=fixture();const {rows,requests,feed,advance,reply,stop}=first;
  await reply(0,[feed('10','100')]);
  advance(1500);await reply(1,[feed('10','100'),feed('12','900')]);advance(0);
  assert.equal(rows.at(-1).dataset.direction,'neutral');
  advance(1500);requests[2].resolve({status:503});await new Promise(resolve=>setImmediate(resolve));
  advance(1500);await reply(3,[feed('12','900'),feed('13','10')]);advance(0);
  assert.equal(rows.at(-1).dataset.direction,'neutral');
  stop();
  const second=fixture();await second.reply(0,[]);second.advance(1500);
  await second.reply(1,[second.feed('14','200')]);second.advance(0);
  assert.equal(second.rows[0].dataset.direction,'neutral');second.stop();
});

test('reduced motion has no animation; abort/dispose cancels timers and discards late successful JSON',async()=>{
  const {rows,requests,feed,advance,reply,stop,controller,media,timers,document}=fixture();
  await reply(0,[]);
  media.matches=true;media.dispatchEvent(new Event('change'));
  advance(1500);await reply(1,[feed('2'),feed('3'),feed('4')]);advance(1500);
  assert.ok(rows.length>0&&rows.every(row=>!row.animation));
  const count=requests.length;
  document.hidden=true;controller.abort();stop();
  await reply(count-1,[feed('5')]);advance(20_000);
  assert.equal(rows.length,0);assert.equal(timers.size,0);assert.equal(requests.length,count);
});

test('busy admissions are bounded and use a dropped fill as the comparison baseline',async()=>{
  const {rows,emitted,feed,advance,reply,stop,timers}=fixture();
  const page=Array.from({length:100},(_,i)=>feed(String(i+1),String(200-i)));
  await reply(0,[feed('1','200')]);advance(1500);await reply(1,page);advance(0);
  assert.deepEqual(rows.map(x=>[x.dataset.tradeId,x.dataset.direction]),[['95','down']]);
  advance(1000);assert.equal(rows.length,1);
  advance(50);assert.equal(rows.length,2);
  advance(450);await reply(2,page);advance(10_000);
  assert.deepEqual(emitted,['95','96','97','98','99','100']);
  assert.deepEqual(rows,[]);
  stop();assert.equal(rows.length,0);assert.equal(timers.size,0);
});

test('saturated opposing/flat tail cannot overtake the committed head or lose its last representative', async t=>{
  const f=fixture(240);
  t.mock.method(Date,'now',f.now);
  const {feed,advance,reply,admissions}=f;
  const fill=(id,price,side='sell')=>feed(String(id),String(price),side,new Date(f.now()).toISOString());
  await reply(0,[fill(1,100)]);
  advance(1500);
  await reply(1,Array.from({length:6},(_,i)=>fill(i+2,101+i)));advance(0);
  advance(1500);await reply(2,[fill(8,107),fill(9,108)]);
  advance(1500);
  await reply(3,[fill(10,90,'buy'),fill(11,90,'buy'),...Array.from({length:25},(_,i)=>fill(i+12,110+i))]);
  for (let i=0;i<6;i++){
    advance(1500);
    await reply(4+i,Array.from({length:6},(_,j)=>fill(37+i*6+j,150+i*6+j)));
  }
  advance(13_000);
  const ids=admissions.map(({row})=>+row.dataset.tradeId);
  assert.ok(ids.includes(10),'isolated down against an up flood was admitted');
  assert.ok(ids.includes(11),'isolated neutral against an up flood was admitted');
  assert.ok(ids.every((id,i)=>!i || id>ids[i-1]),'retained fills admit in FIFO order without replay');
  const wait=admissions.filter(({row})=>['10','11'].includes(row.dataset.tradeId)).map(({at})=>at-4500);
  assert.ok(wait.every(ms=>ms<15_000),`both representatives are admitted while fresh: ${wait}`);
  t.diagnostic(`down/neutral admission delays: ${wait.join(', ')} ms`);
  f.stop();
});

test('adversarial bursts interlace uninterrupted routes and opposite aggressors on the same physical track', async t=>{
  const f=fixture(145);
  f.root.clientWidth=490; // Three columns with exclusive ends and a shared center.
  t.mock.method(Date,'now',f.now);
  let id=0, price=1800;
  const fill=(delta,side)=>f.feed(String(++id),String(price+=delta),side,new Date(f.now()).toISOString());
  await f.reply(0,[fill(0,'buy')]);
  for (let i=0;i<12;i++) {
    f.advance(1500);
    const burst=i%4===0?[1,1,-1,0,1,-1]:i%4===1?[-1,-1,-1,1,0,-1]:i%4===2?[1,1,1,1,-1,1]:[-1,1,-1,1,0,1];
    await f.reply(i+1,burst.map((delta,j)=>fill(delta,j%2?'buy':'sell')));
  }
  f.advance(26_000);
  assert.deepEqual(f.rows,[]);
  const segments=[];
  for (const {row,at} of f.admissions) {
    const {frames,options:{duration}}=row.animation;
    const {direction,side,tradeId,columnCount}=row.dataset;
    assert.equal(+columnCount,3);
    if (direction==='neutral') {
      const x=parseFloat(row.style.left), y=parseFloat(row.style.top);
      segments.push({x,y,v:0,t0:at,t1:at+duration,bottom:parseFloat(row.clip.style.height),direction,side,tradeId});
      continue;
    }
    assert.equal(frames.length,4,`row ${tradeId} must not add hold keyframes`);
    let previousX;
    for(let i=0;i<frames.length;i+=2){
      const [a,b]=frames.slice(i,i+2);
      const point=k=>k.transform.match(/-?[\d.]+/g).map(Number);
      const [x,y]=point(a), [endX,endY]=point(b);
      const t0=at+a.offset*duration,t1=at+b.offset*duration;
      const v=(endY-y)/(t1-t0),bottom=parseFloat(row.clip.animation.frames[i].height);
      assert.equal(x,endX);
      assert.ok(Math.abs(v-(direction==='up'?-.076:.076))<1e-9);
      assert.deepEqual([y,endY],direction==='up'?[bottom,-25]:[-25,bottom]);
      if (i) {
        assert.equal(a.offset,frames[i-1].offset,'no time between legs');
        assert.ok(direction==='up'?x>previousX:x<previousX);
      }
      previousX=x;
      segments.push({x,y,v,t0,t1,bottom,direction,side,tradeId});
    }
  }
  let mixed=0, sharedOppositeSide=0;
  for (let i=0;i<segments.length;i++) for (const b of segments.slice(i+1)) {
    const a=segments[i];
    const start=Math.max(a.t0,b.t0), end=Math.min(a.t1,b.t1);
    if (end-start<1e-7) continue;
    const parallel=a.direction===b.direction && a.direction!=='neutral';
    if (new Set([a.direction,b.direction]).size===2 && ![a.direction,b.direction].includes('neutral')) mixed++;
    if (Math.abs(a.x-b.x)>=88) continue;
    if (parallel && a.side!==b.side) sharedOppositeSide++;
    // Relative vertical position is affine over the entire shared time
    // interval: endpoints suffice to rule out a crossing, not just frame samples.
    const sep=t=>a.y+a.v*(t-a.t0)-b.y-b.v*(t-b.t0);
    const d0=sep(start), d1=sep(end);
    assert.ok(Math.min(d0,d1)>=25-1e-7 || Math.max(d0,d1)<=-25+1e-7,`${a.tradeId}/${b.tradeId} overlap`);
  }
  assert.ok(mixed>0,'both motions visible concurrently');
  assert.ok(sharedOppositeSide>0,'B and S share a physical track without locking its column');
  t.diagnostic(`${f.admissions.length} admissions; ${mixed} opposing overlaps in time; ${sharedOppositeSide} opposite-aggressor pairs on a shared track`);
  f.stop();
});

test('wide mixed burst enters in order while fresh, with full uninterrupted routes and no shared ink',async t=>{
  const f=fixture(187,[],211,32);f.root.clientWidth=1200;
  t.mock.method(Date,'now',f.now);
  const {feed,advance,reply,admissions}=f;
  const stamp=new Date(f.now()).toISOString();
  await reply(0,[feed('1','100')]);
  advance(1500);await reply(1,[feed('10','100','buy',stamp)]);advance(0);
  advance(1500);await reply(2,['101','100','101','102','102'].map((p,i)=>feed(String(i+11),p,i===1?'buy':'sell',new Date(f.now()-1500).toISOString())));
  advance(13500);
  const busy=admissions.filter(({row})=>+row.dataset.tradeId>=11);
  assert.deepEqual(busy.map(({row})=>row.dataset.tradeId),['11','12','13','14','15']);
  assert.ok(busy.every(({at})=>at<16500),'all starts before exchange timestamp + 15 s');
  const segments=[];
  for (const {row,at} of busy) {
    const {frames,options:{duration}}=row.animation;
    const {direction,tradeId}=row.dataset;
    if (direction==='neutral') {
      segments.push({x:parseFloat(row.style.left),y:parseFloat(row.style.top),v:0,t0:at,t1:at+duration,tradeId});
      continue;
    }
    const columns=[];
    assert.equal(frames.length,8);
    for(let i=0;i<8;i+=2){
      const [a,b]=frames.slice(i,i+2);
      const point=k=>k.transform.match(/-?[\d.]+/g).map(Number);
      const [x,y]=point(a),[endX,endY]=point(b);
      const t0=at+a.offset*duration,t1=at+b.offset*duration,v=(endY-y)/(t1-t0);
      assert.equal(x,endX);assert.ok(Math.abs(Math.abs(v)-.076)<1e-9);
      if(i)assert.equal(a.offset,frames[i-1].offset);
      columns.push(Math.floor((x+108)/240)+1);
      segments.push({x,y,v,t0,t1,tradeId});
    }
    assert.deepEqual(columns,direction==='up'?[1,2,3,4]:[5,4,3,2]);
  }
  for (const [i,a] of segments.entries()) for(const b of segments.slice(i+1)){
    if(a.tradeId===b.tradeId||Math.abs(a.x-b.x)>=216)continue;
    const start=Math.max(a.t0,b.t0),end=Math.min(a.t1,b.t1);
    if(end<=start)continue;
    const dy=t=>a.y+a.v*(t-a.t0)-b.y-b.v*(t-b.t0);
    assert.ok(Math.min(dy(start),dy(end))>=32-1e-7||Math.max(dy(start),dy(end))<=-32+1e-7,`${a.tradeId}/${b.tradeId} overlap`);
  }
  t.diagnostic(`busy FIFO entry times from response: ${busy.map(({at})=>at-3000).join(', ')} ms`);
  f.stop();
});

test('exclusive price-direction entries and stationary inner neutrals',async()=>{
  for(const [width,count] of [[1200,5],[490,3],[192,2],[100,1]]){
    const f=fixture(95);f.root.clientWidth=width;
    const {feed,advance,reply,admissions,stop}=f;
    await reply(0,[feed('1','100')]);
    advance(1500);await reply(1,[feed('2','101','sell'),feed('3','101','buy'),feed('4','100','buy')]);
    advance(14_000);
    const up=admissions.find(({row})=>row.dataset.direction==='up')?.row;
    const down=admissions.find(({row})=>row.dataset.direction==='down')?.row;
    const neutral=admissions.find(({row})=>row.dataset.direction==='neutral')?.row;
    const xs=row=>row.animation.frames.filter((_,i)=>i%2===0).map(k=>+k.transform.split('(')[1].split('px')[0]);
    assert.equal(+up.dataset.columnCount,count);
    assert.equal(+down.dataset.columnCount,count);
    assert.equal(xs(up).length,Math.max(1,count-1));
    assert.equal(xs(down).length,Math.max(1,count-1));
    assert.equal(new Set(admissions.map(({row})=>row.dataset.tradeId)).size,admissions.length);
    if(count>1){
      assert.ok(Math.min(...xs(up))<Math.min(...xs(down)));
      assert.ok(Math.max(...xs(up))<Math.max(...xs(down)));
    }
    if(count>2){
      const [rise,fall]=[xs(up).slice(1),xs(down).slice(1).reverse()];
      if(count===5){
        assert.equal(rise[0],fall[0]);assert.equal(rise[2],fall[2]);
        assert.equal(fall[1]-rise[1],96,'middle tracks separate by footprint plus gutter');
        assert.ok([rise[1],fall[1]].every(x=>Math.floor((x+44)/(width/count))===2));
      } else assert.deepEqual(rise,fall,'same physical tracks in narrow inner columns');
      const x=parseFloat(neutral.style.left);
      assert.ok(x>xs(up)[0] && x<xs(down)[0]);
    } else if(count===2) assert.equal(neutral,undefined);
    else assert.ok(neutral?.animation.frames.every(k=>k.transform===undefined));
    stop();
  }
});
