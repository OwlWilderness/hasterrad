const STEP=60, MINUTE=60_000, WINDOW=2*60*STEP, FRESH_MS=150_000, TICK_MS=15_000;
const MINUTE_DRIFT_PERCENT=100*STEP/WINDOW;

function average(period,alpha) {
  let count=0,sum=0,value=null;
  return next=>{
    if(count<period){sum+=next;if(++count===period)value=sum/period;}
    else value+=(next-value)*alpha;
    return value;
  };
}

export function indicators(points) {
  let prev,gain,loss,recentRsi,fast,slow,signalAverage;
  return points.map(([time,price],i)=>{
    if(i===0||time-points[i-1][0]!==STEP){
      prev=null;gain=average(14,1/14);loss=average(14,1/14);
      recentRsi=[];
      fast=average(12,2/13);slow=average(26,2/27);signalAverage=average(9,2/10);
    }
    let rsi=null,rsiAvg=null;
    if(prev!==null){
      const change=price-prev,up=gain(Math.max(change,0)),down=loss(Math.max(-change,0));
      if(up!==null)rsi=down===0?(up===0?50:100):100-100/(1+up/down);
    }
    if(rsi!==null){
      recentRsi.push(rsi);
      if(recentRsi.length>14)recentRsi.shift();
      if(recentRsi.length===14)rsiAvg=recentRsi.reduce((sum,value)=>sum+value,0)/14;
    }
    prev=price;
    const a=fast(price),b=slow(price),macd=b===null?null:a-b;
    return {time,price,rsi,rsiAvg,macd,signal:macd===null?null:signalAverage(macd)};
  });
}

const plotY=normalized=>Number(((1-normalized)*82+9).toFixed(2));
const rsiScale=v=>v/100;
const vertex=(p,x,norm,key)=>`${Number(x(p).toFixed(2))} ${plotY(norm(p[key]))}`;
const studies=['rsi','rsiAvg','macd','signal'];
const studyScale=(key,momentum)=>key==='rsi'||key==='rsiAvg'?rsiScale:momentum;

function paths(visible,x,price,momentum,priceDots=false) {
  const trace=(key,norm,dots=false)=>{
    let last,segment=[],path=[];
    const flush=()=>{
      if(segment.length>1)path.push(segment.join(' '));
      else if(dots&&segment.length===1)path.push(`${segment[0]} h 0`);
      segment=[];
    };

    for(const p of visible){
      if(p[key]===null||p.time-last!==STEP)flush();
      if(p[key]!==null)segment.push(`${segment.length?'L':'M'} ${vertex(p,x,norm,key)}`);
      last=p.time;
    }

    flush();return path.join(' ');
  };
  return {price:trace('price',price,priceDots),...Object.fromEntries(studies.map(key=>
    [key,trace(key,studyScale(key,momentum),key==='rsiAvg')]))};
}
const amplitude=rows=>Math.max(0,...rows.flatMap(p=>[Math.abs(p.macd),Math.abs(p.signal)]));

export function chartPaths(points) {
  const end=points.at(-1)?.[0],start=end-WINDOW;
  const visible=indicators(points).filter(p=>p.time>=start);
  const prices=visible.map(p=>p.price),low=Math.min(...prices),high=Math.max(...prices),scale=amplitude(visible);
  return paths(visible,p=>(p.time-start)/(end-start)*1000,v=>high>low?(v-low)/(high-low):.5,v=>scale?.5+v/(2*scale):.5);
}

// Candle timestamps label opens; confirmed closes are plotted at minute end.
export function liveChartPaths(points,trade,minute,samples=[]) {
  const start=minute-WINDOW;
  const closed=points.filter(([time])=>time<minute);
  const live=trade&&Math.floor(trade.asOf/MINUTE)*STEP===minute;
  const connected=closed.at(-1)?.[0]===minute-STEP;
  // Replay the same confirmed inputs plus one tentative close. It never
  // becomes input to a later trade or enters the confirmed history.
  const rows=indicators(live&&connected?[...closed,[minute,trade.price]]:closed);
  const pending=live&&connected?{...rows.pop(),plotTime:trade.asOf/1000}:null;
  const visible=rows.filter(p=>p.time+STEP>=start-STEP);
  const prices=visible.map(p=>p.price),low=Math.min(...prices),high=Math.max(...prices);
  const center=prices.length?(high+low)/2:samples[0]?.price??0;
  const radius=Math.max((prices.length?high-low:0)*.75,center*.0005,.01);
  const scale=Math.max(center*.00005,.001,amplitude(visible)*1.5);
  // Fixed historical scales within each minute; large moves approach a plot
  // bound smoothly without pinning live values or rescaling confirmed vertices.
  const normalize=v=>v<.15?.15*Math.exp((v-.15)/.15):v>.85?1-.15*Math.exp((.85-v)/.15):v;
  const x=p=>((p.plotTime??p.time+STEP)-start)*1000/WINDOW;
  const price=v=>normalize(.5+(v-center)/(2*radius)),momentum=v=>normalize(.5+v/(2*scale));
  const data=paths(visible,x,price,momentum,true);
  let prior, segment=[], trail=[];
  const flush=()=>{
    if(segment.length)trail.push(segment.join(' ')+(segment.length===1?' h 0':''));
    segment=[];
  };
  for(const sample of samples){
    const second=Math.floor(sample.asOf/1000);
    if(second<start-1)continue;
    if(second!==prior+1)flush();
    segment.push(`${segment.length?'L':'M'} ${vertex({plotTime:sample.asOf/1000,price:sample.price},x,price,'price')}`);
    prior=second;
  }
  flush();
  // Separate subpaths: neither a close nor a tick supplies missing samples for the other.
  if(trail.length)data.price=[data.price,...trail].filter(Boolean).join(' ');
  for(const key of studies){
    const last=visible.at(-1),norm=studyScale(key,momentum);
    data[`${key}-pending`]=pending?.[key]==null?'':last?.[key]!=null?
      `M ${vertex(last,x,norm,key)} L ${vertex(pending,x,norm,key)}`:
      key==='rsiAvg'?`M ${vertex(pending,x,norm,key)} h 0`:'';
  }
  return data;
}

const usd=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
const percent=new Intl.NumberFormat('en-US',{style:'percent',signDisplay:'always',minimumFractionDigits:2,maximumFractionDigits:2});
const finitePrice=value=>Number.isFinite(value)&&value>0&&value<=1e9;

export function mountEthMarket(doc,win,session,{backdrop:chart,strip:box}) {
  if(!chart||!box)return ()=>{};
  const traces=[...chart.querySelectorAll('[data-trace]')];
  const group=chart.querySelector('.eth-scroll');
  for(const line of chart.querySelectorAll('[data-rsi-guide]')){
    const y=plotY(rsiScale(Number(line.dataset.rsiGuide)));
    line.setAttribute('y1',y);line.setAttribute('y2',y);
  }
  group.style.transformBox='view-box';
  const reduced=win.matchMedia('(prefers-reduced-motion: reduce)');
  const latest=box.querySelector('[data-market-field=price]'),day=box.querySelector('[data-market-field=day]');
  const sessionEnd=Date.parse(session.expiresAt),controller=new AbortController();
  let tickTimer,historyTimer,renderTimer,sessionTimer,drift,driftMinute;
  let history=null,trade=null,paintedHistory,paintedTrade,paintedMinute;
  const samples=[];
  const setText=(node,text)=>{if(node.textContent!==text)node.textContent=text;};
  const allowed=()=>!controller.signal.aborted&&!doc.hidden&&sessionEnd>Date.now();
  const stop=()=>{
    controller.abort();drift?.cancel();
    samples.length=0;
    reduced.removeEventListener('change',motionChanged);
    for(const timer of [tickTimer,historyTimer,renderTimer,sessionTimer])win.clearTimeout(timer);
    chart.setAttribute('hidden','');box.hidden=true;
    for(const path of traces)path.removeAttribute('d');
    renderQuote(null,null);
  };
  function renderQuote(current,d){
    setText(latest,current?usd.format(current.price):'Unavailable');
    setText(day,d?`24h ${percent.format(d.change/100)}`:'');
    day.hidden=!d;
  }
  function motionChanged(){driftMinute=undefined;render();}
  function render(){
    if(!allowed())return;
    const now=Date.now(),offset=now%MINUTE,minute=(now-offset)/1000;
    const points=history?.expiresAt>now?history.points:null;
    const current=trade?.expiresAt>now&&trade.asOf<=now?trade:null;
    const plotted=current&&Math.floor(current.asOf/MINUTE)*STEP===minute?current:null;
    const d=history?.day?.expiresAt>now?history.day:null;
    box.hidden=false;

    renderQuote(current,d);
    const changed=points!==paintedHistory||current!==paintedTrade||minute!==paintedMinute;
    if(changed){
      const data=liveChartPaths(points??[],plotted,minute,current?samples.filter(sample=>sample.asOf<=now):[]);
      for(const path of traces){
        const value=data[path.dataset.trace];
        if(!value)path.removeAttribute('d');else if(path.getAttribute('d')!==value)path.setAttribute('d',value);
      }
      const hidden=!traces.some(path=>path.hasAttribute('d'));
      chart.toggleAttribute('hidden',hidden);
      paintedHistory=points;paintedTrade=current;paintedMinute=minute;
    }
    if(driftMinute!==minute||(changed&&reduced.matches)){
      drift?.cancel();drift=undefined;driftMinute=minute;
      group.style.transform=reduced.matches?`translateX(${-MINUTE_DRIFT_PERCENT*offset/MINUTE}%)`:'';
      if(!reduced.matches){
        drift=group.animate([{transform:'translateX(0%)'},{transform:`translateX(${-MINUTE_DRIFT_PERCENT}%)`}],{duration:MINUTE,fill:'both'});
        drift.currentTime=offset;
      }
    }
    win.clearTimeout(renderTimer);
    renderTimer=win.setTimeout(render,Math.min(MINUTE-offset,...[points&&history.expiresAt,trade?.asOf,current?.expiresAt,d?.expiresAt]
      .filter(expiry=>expiry>now).map(expiry=>expiry-now)));
  }
  const validTick=q=>finitePrice(q?.price)&&Number.isFinite(q.asOf)&&q.asOf<=Date.now()+5000&&q.expiresAt===q.asOf+TICK_MS;
  function applyHistory(data){
    if(!data)return;
    const {points,expiresAt,day:d}=data;
    const validPoints=Array.isArray(points)&&points.length>=2&&points.length<=180&&points.every((p,i)=>
      Array.isArray(p)&&p.length===2&&Number.isSafeInteger(p[0])&&p[0]%STEP===0&&(!i||p[0]>points[i-1][0])&&finitePrice(p[1]));
    const now=Date.now();
    const validExpiry=value=>Number.isFinite(value)&&value>now&&value<=now+FRESH_MS;
    const validDay=Number.isFinite(d?.change)&&finitePrice(d.high)&&finitePrice(d.low)&&d.high>=d.low&&validExpiry(d.expiresAt);
    history={points:validPoints&&validExpiry(expiresAt)?points:null,expiresAt,day:validDay?d:null};
  }
  let tickDelay=1000;
  async function poll(tick) {
    if(!allowed())return stop();
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(6000)]);
    try {
      const response=await win.fetch(tick?'/api/eth-market/tick':'/api/eth-market',{credentials:'same-origin',cache:'no-store',redirect:'error',
        headers:{'X-CSRF-Token':session.csrf},signal});
      if(!allowed())return;
      if(response.status===401||response.status===403)return stop();
      if(!response.ok)throw new Error('market unavailable');
      const data=await response.json();
      if(!allowed()||signal.aborted)return;
      if(tick){
        tickDelay=1000;
        if(validTick(data)&&data.expiresAt>Date.now()&&(!trade||data.asOf>=trade.asOf&&(data.asOf!==trade.asOf||data.price!==trade.price))){
          // Take the last actual observation per exchange second, never fill missing seconds.
          if(Math.floor(samples.at(-1)?.asOf/1000)===Math.floor(data.asOf/1000))samples.pop();
          samples.push(data);
          // Up to one minute of drift, plus the left-edge entry sample.
          if(samples.length>WINDOW+STEP+2)samples.shift();
          trade=data;
        }
      }else applyHistory(data);
      render();
    } catch {if(tick)tickDelay=Math.min(tickDelay*2,30_000);}
    finally {if(allowed()){
      if(tick)tickTimer=win.setTimeout(()=>poll(true),tickDelay);
      else historyTimer=win.setTimeout(()=>poll(false),MINUTE-(Date.now()-2000+MINUTE)%MINUTE);
    }}
  }
  if(allowed()){
    reduced.addEventListener('change',motionChanged);
    sessionTimer=win.setTimeout(stop,Math.min(sessionEnd-Date.now(),2_147_483_647));
    render();void poll(false);void poll(true);
  }
  return stop;
}
