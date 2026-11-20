import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {historyFixture} from './personal-history-fixture.mjs';

const binary=process.env.HASTERRAD_TEST_CHROMIUM;
const evidence=process.env.HASTERRAD_FLIGHT_EVIDENCE;
const address='0x1234567890abcdef1234567890abcdef1234abcd';
const walletOwner={provider:'ethereum',id:`ethereum:1:${address}`,displayName:address};
for(const mirror of ['public','api/public'])for(const route of ['/','/asteroids.html'])for(const noDay of [false,true])test(`Brave ${noDay?'market strip without 24h stats':'live trades and drift'} ${mirror} ${route}`,{skip:!binary,timeout:22_000},async t=>{
  const expires=60_000, upstream={ticker:0,stats:0,candles:0}, trades=[1801,1795,1807,1798,1805];
  const root=new URL(`../../hasterrad-game/source/${mirror}/`,import.meta.url);
  let shift=0;
  const fixed=Math.floor(Date.now()/expires)*expires-7000;
  const utcText=t=>`${new Date(t).toISOString().slice(11,19)} UTC`;
  const expectedUtc=utcText(fixed);
  let fixedClock=false;
  const clock=()=>fixedClock?fixed:Date.now()+shift;
  const {app,origin,a}=await historyFixture(t,{walletOwner,appOptions:{staticDir:fileURLToPath(root),clock,
    ethMarketOrigin:'https://api.exchange.coinbase.com',ethMarketFetch:async url=>{
      const type=url.pathname.split('/').at(-1);upstream[type]++;
      if(type==='ticker')return Response.json({trade_id:upstream.ticker,price:String(trades[(upstream.ticker-1)%trades.length]),time:new Date(clock()-25).toISOString()});
      if(type==='stats')return noDay?new Response(null,{status:503}):Response.json({open:'1810',last:'1805',high:'1900',low:'1750'});
      const minute=Date.parse(url.searchParams.get('end'))/1000;
      const wave=time=>1800+3*Math.sin(time/231)+5*Math.sin(time/513);
      const rows=Array.from({length:180},(_,i)=>{const time=minute-(180-i)*60,p=wave(time);return [time,p-1,p+1,p,p,1];});
      return Response.json([...rows,[minute,10000,10000,10000,10000,1]]);
    }}});
  app.context.checkWalletSession=async()=>true; // synthetic session only, never a real wallet or provider
  const profile=await mkdtemp(join(tmpdir(),'hasterrad-eth-live-'));
  const browser=spawn(binary,['--headless=new','--disable-background-networking','--disable-component-update',
    '--disable-sync','--no-first-run','--no-default-browser-check','--remote-debugging-pipe',
    '--proxy-server=http://127.0.0.1:1',`--proxy-bypass-list=<-loopback>;${new URL(origin).host}`,
    `--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','ignore','pipe','pipe']});
  const exited=once(browser,'close');
  let seq=0,buffer='';const pending=new Map(),requested=[],scripts=[];
  browser.stdio[4].setEncoding('utf8').on('data',chunk=>{
    buffer+=chunk;
    for(let end;(end=buffer.indexOf('\0'))>=0;){
      const m=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);pending.get(m.id)?.(m);
      if(m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url))requested.push(m.params.request.url);
      if(m.method==='Network.responseReceived'&&m.params.response.url===origin+'/assets/eth-chart.mjs')scripts.push(m.params.requestId);
    }
  });
  const command=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
    const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timeout ${method}`));},4500);
    pending.set(id,r=>{clearTimeout(timer);pending.delete(id);r.error?reject(Error(`${method}: ${r.error.message}`)):resolve(r.result);});
    browser.stdio[3].write(JSON.stringify({id,method,params,sessionId})+'\0');
  });
  try {
    const {targetId}=await command('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});
    const send=(method,params)=>command(method,params,sessionId);
    const run=async expression=>{
      const {result,exceptionDetails}=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
      assert.ok(!exceptionDetails,result.description);return result.value;
    };
    const wait=async(expression,ms=4000)=>{const deadline=Date.now()+ms;do{const v=await run(expression);if(v)return v;await sleep(45);}while(Date.now()<deadline);assert.fail(`did not settle: ${expression}`);};
    const checkLegend=async()=>{
      const legend=await run(`(()=>{
        const q=sel=>document.querySelector(sel), key=q('#eth-market-box');
        if(!key)return null;
        const bounds=key.getBoundingClientRect();
        const items=[...key.querySelectorAll('li')].map(li=>{
          const swatch=li.querySelector('path'), name=swatch.dataset.trace;
          const trace=q('#eth-chart [data-trace="'+name+'"]');
          const a=getComputedStyle(trace),b=getComputedStyle(swatch);
          return {text:li.querySelector('span:not(.sr-only)').textContent,stroke:b.stroke,dash:b.strokeDasharray,
            visible:swatch.getBoundingClientRect().width>=18 && li.getBoundingClientRect().right<=bounds.right && b.stroke!=='none' && +b.opacity>0,
            match:['stroke','strokeWidth','strokeDasharray','strokeLinecap','opacity'].every(k=>a[k]===b[k])};
        });
        const field=q('#arcade').getBoundingClientRect(), hud=q('.hud').getBoundingClientRect();
        const overlay=q('#overlay'), total=document.querySelectorAll('.eth-legend').length;
        return {items,total,below:bounds.height>0&&bounds.top>=hud.bottom&&bounds.top-hud.bottom<=12,
          fits:bounds.left>=field.left&&bounds.right<=field.right&&bounds.bottom<=field.bottom&&
            (overlay.hidden||bounds.bottom<=overlay.getBoundingClientRect().top)&&
            getComputedStyle(key).pointerEvents==='none'&&!q('.arcade-header [data-market-field]')};
      })()`);
      assert.ok(legend?.below&&legend.fits&&legend.total===1,'one visible, noninteractive market strip directly beneath the HUD');
      assert.deepEqual(legend.items.map(x=>x.text),['$','RSI 14','SMA 14','MACD 12/26','Sig 9']);
      assert.ok(legend.items.every(x=>x.visible&&x.match),'all painted swatches match their plot traces');
      assert.equal(new Set(legend.items.map(x=>x.stroke)).size,5);
      assert.equal(new Set(legend.items.map(x=>x.dash)).size,5);
    };
    const checkMarketLayer=async()=>{
      // The resize handler can replace the backing store before the next paint.
      await run(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))`);
      const actual=await run(`(() => {
        const box=document.querySelector('#eth-market-box'), canvas=document.querySelector('#space');
        const chart=document.querySelector('#eth-chart'), hud=document.querySelector('.hud');
        const b=box.getBoundingClientRect(), ctx=canvas.getContext('2d');
        const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
        const hasStarPixels=pixels.some((a,i)=>i%4===3&&a>40&&a<190&&
          Math.abs(pixels[i-3]-197)<5&&Math.abs(pixels[i-2]-216)<5&&Math.abs(pixels[i-1]-204)<5);
        const transparent=getComputedStyle(box).backgroundColor==='rgba(0, 0, 0, 0)'&&getComputedStyle(box).borderTopWidth==='0px';
        const p={x:b.left+b.width/2,y:b.top+b.height/2};
        const nativeHit=document.elementFromPoint(p.x,p.y)===canvas;
        box.style.pointerEvents='auto';chart.style.pointerEvents='bounding-box';
        try {
          const stack=document.elementsFromPoint(p.x,p.y);
          const cr=chart.getBoundingClientRect(), plotStack=document.elementsFromPoint(cr.x+cr.width/2,cr.y+cr.height/2);
          return {transparent,nativeHit,hasStarPixels,
            belowCanvas:stack.includes(box)&&stack.indexOf(canvas)<stack.indexOf(box)&&stack.includes(canvas),
            plotBelowCanvas:plotStack.includes(chart)&&plotStack.indexOf(canvas)<plotStack.indexOf(chart)&&plotStack.includes(canvas),
            belowHUD:+getComputedStyle(hud).zIndex>+getComputedStyle(canvas).zIndex};
        } finally {box.style.removeProperty('pointer-events');chart.style.removeProperty('pointer-events');}
      })()`);
      assert.deepEqual(actual,{transparent:true,nativeHit:true,hasStarPixels:true,belowCanvas:true,plotBelowCanvas:true,belowHUD:true},
        'transparent market text and chart paint behind the actual star-drawing canvas, not over it');
    };
    await send('Network.enable');await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride',{width:1200,height:844,deviceScaleFactor:1,mobile:false});
    await send('Network.setCookie',{url:origin,name:'hasterrad_dev_session',value:a.token,httpOnly:true});
    shift=53_000-Date.now()%expires;
    fixedClock=noDay;
    await send('Page.addScriptToEvaluateOnNewDocument',{source:noDay?`Date.now=()=>${fixed};`:`const rawNow=Date.now; Date.now=()=>rawNow()+${shift};`});
    if(noDay)await send('Page.addScriptToEvaluateOnNewDocument',{source:`{
      const fetchNow=window.fetch;
      window.fetch=async (url,...args)=>{
        if(url==='/api/session' && window.holdFocusSession){
          window.holdFocusSession=false;
          await new Promise(resolve=>{window.releaseFocusSession=resolve;});
        }
        return fetchNow(url,...args);
      };
    }`});
    if(!noDay)await send('Page.addScriptToEvaluateOnNewDocument',{source:`{
      // Gate only browser delivery of /tick; the history endpoint shares the upstream ticker.
      const rawFetch=window.fetch, tickDelivery=new Promise(resolve=>{window.releaseEthTick=resolve;});
      window.fetch=async (...args)=>{
        const response=await rawFetch(...args);
        if(args[0]==='/api/eth-market/tick')await tickDelivery;
        return response;
      };
    }`});
    await send('Page.navigate',{url:origin+route});
    if(noDay){
      const utc=`document.querySelector('#utc-clock').textContent`;
      const price=`document.querySelector('[data-market-field=price]').textContent`;
      await wait(`${utc}===${JSON.stringify(expectedUtc)} && ${price}==='$1,801.00' && document.querySelector('#eth-market-box [data-market-field=day]').hidden`);
      const checks={};
      for(const width of [1024,1440,375]){
        const narrow=width===375;
        await send('Emulation.setDeviceMetricsOverride',{width,height:narrow?812:900,deviceScaleFactor:1,mobile:narrow});
        await send('Emulation.setTouchEmulationEnabled',{enabled:narrow});
        await wait(`innerWidth===${width}`);
        await checkLegend();
        checks[width]=await run(`(()=>{
          const q=s=>document.querySelector(s), rect=e=>{const r=e.getBoundingClientRect();return [r.left,r.top,r.right,r.bottom]};
          const range=document.createRange();range.selectNodeContents(q('#utc-clock'));
          const time=rect(range),box=rect(q('#eth-market-box'));
          const geometry=Object.fromEntries(['.arcade-header','.account-controls','#account-logout','#account-status','#pause','#arcade','#space','.hud','.arcade-footer','#flight-stick','[data-action="fire"]','[data-action="hyperspace"]'].map(s=>[s,rect(q(s))]));
          const chat=q('#remilia-chat'), cluster=document.createElement('div'), row=document.createElement('span');
          cluster.dataset.column='2';row.textContent='Synthetic message';cluster.append(row);chat.append(cluster);chat.hidden=false;
          for(const animation of cluster.getAnimations()){animation.pause();animation.currentTime=12_000;}
          const measure=el=>{const c=getComputedStyle(el);return [c.fontFamily,c.fontSize,c.fontWeight,c.letterSpacing,c.color,c.textShadow,c.lineHeight];};
          try {
            const clock=q('#utc-clock');
            return {box,time,utc:clock.textContent,geometry,overflow:document.documentElement.scrollWidth>innerWidth,
              oneClock:document.querySelectorAll('#utc-clock').length===1 && clock.closest('footer') && !clock.closest('#arcade,[aria-live],[role=status]') && !q('#arcade time'),
              ink:{message:measure(row),opacity:+getComputedStyle(cluster).opacity,
                quote:measure(q('[data-market-field=price]')),context:measure(q('.eth-context > [aria-hidden]')),key:measure(q('.eth-legend li > [aria-hidden]:not(svg)'))}};
          } finally {cluster.remove();chat.hidden=true;}
        })()`);
        if(evidence){
          const {data}=await send('Page.captureScreenshot',{format:'png'});
          await writeFile(join(evidence,`no-day-${mirror.replace('/','-')}-${route==='/'?'root':'standalone'}-${width}.png`),Buffer.from(data,'base64'));
        }
        // Reproduce the window-focus handler between the initial hit test and
        // pointer-down. Hold session delivery so a fast remount cannot mask it.
        const startRect=`JSON.stringify(document.querySelector('#start').getBoundingClientRect())`;
        const before=await run(startRect);
        await run(`window.holdFocusSession=true; window.dispatchEvent(new Event('focus')); true`);
        await wait(`typeof window.releaseFocusSession==='function'`);
        assert.equal(await run(`(() => {
          const box=document.querySelector('#eth-market-box'), chart=document.querySelector('#eth-chart');
          return box.hidden && getComputedStyle(box).display==='none' && chart.hasAttribute('hidden') &&
            !chart.querySelector('[data-trace][d]') && box.querySelector('[data-market-field=price]').textContent==='Unavailable';
        })()`),true,'focus clears private market DOM before the session reply');
        assert.deepEqual(JSON.parse(await run(startRect)),JSON.parse(before),`Start stays under the original pointer at ${width}px during focus refresh`);
        await run(`window.releaseFocusSession(); window.releaseFocusSession=null`);
        assert.equal(await run(utc),expectedUtc);
        await wait(`${price}.startsWith('$')`);
        assert.deepEqual(JSON.parse(await run(startRect)),JSON.parse(before),`market remount does not move Start at ${width}px`);
      }
      if(evidence)await writeFile(join(evidence,`no-day-${mirror.replace('/','-')}-${route==='/'?'root':'standalone'}.json`),JSON.stringify(checks,null,2));
      for(const w of [1024,1440,375]){
        const {box,time,utc,geometry,overflow,oneClock,ink}=checks[w];
        assert.equal(utc,expectedUtc);
        assert.ok(oneClock&&time[2]>time[0]&&time[3]>time[1]&&time[1]>=geometry['#arcade'][3]);
        const reference=[...ink.message];
        assert.equal(reference[4],'rgb(165, 194, 179)');
        assert.equal(ink.opacity,w===375?.43:.58);
        reference[4]=`rgba(165, 194, 179, ${ink.opacity})`;
        for(const sample of [ink.quote,ink.context,ink.key])assert.deepEqual(sample,reference);
        assert.ok(!overflow&&geometry['#arcade'][0]<=box[0]&&box[2]<=geometry['#arcade'][2]);
      }
      // Age the client beyond the ticker TTL, keeping valid candle history in place.
      await run(`Date.now=()=>${fixed+16000}; true`);
      await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
      await wait(`document.querySelector('[data-market-field=price]').textContent==='Unavailable'`);
      assert.equal(await run(`!document.querySelector('#eth-market-box time') &&
        !!document.querySelector('#eth-chart [data-trace=price][d]')`),true,'expired ticker clears the quote, not valid candle history');
      await wait(`${utc}===${JSON.stringify(utcText(fixed+16000))}`);
      await checkLegend();
      return;
    }
    const quote=`document.querySelector('[data-market-field=price]').textContent`;
    const getPaths=`[...document.querySelectorAll('#eth-chart [data-trace$="-pending"]')].map(p=>p.getAttribute('d'))`;
    const pricePath=`document.querySelector('#eth-chart [data-trace="price"]').getAttribute('d')`;
    const ready=`!document.querySelector('#eth-chart').hasAttribute('hidden') && ${getPaths}.length>0 && ${getPaths}.every(p=>p?.includes(" L 100")) && ${pricePath}!==null`;
    const vertices=d=>d.match(/[ML] -?[\d.]+ [\d.]+/g).map(v=>v.slice(2));
    const times=d=>vertices(d).map(v=>Number(v.split(' ')[0]));
    await wait(`!document.querySelector('#eth-chart').hasAttribute('hidden') && ${pricePath}`);
    const startup=await run(pricePath);
    assert.equal(await run(`!!document.querySelector('#eth-chart [data-trace="rsiAvg"][d]')`),true,'warmed SMA paints before the first tick');
    await checkLegend();
    assert.equal(await run(quote),'Unavailable','history paints before the held ticker response');
    assert.deepEqual(times(startup).filter(x=>x>=0),Array.from({length:121},(_,i)=>Number((i*1000/120).toFixed(2))),'one actual close per minute in the 2h span');
    await run('window.releaseEthTick(); true');
    await wait(ready);
    const first=await run(getPaths),firstQuote=await run(quote),firstPrice=await run(pricePath);
    const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
    assert.equal(scripts.length,1);
    const js=await send('Network.getResponseBody',{requestId:scripts[0]});
    assert.equal(digest(Buffer.from(js.body,js.base64Encoded?'base64':'utf8')),digest(await readFile(new URL('assets/eth-chart.mjs',root))));
    const geom=await run(`(()=>{const q=document.querySelector('#eth-market-box'),c=document.querySelector('#eth-chart'),b=q.getBoundingClientRect();return [document.querySelector('#arcade').contains(q),b.top>=document.querySelector('.hud').getBoundingClientRect().bottom,getComputedStyle(c).pointerEvents,getComputedStyle(c).zIndex,getComputedStyle(document.querySelector('#space')).zIndex,1000*(c.querySelector('[data-trace="rsi"]').getScreenCTM().a)];})()`);
    assert.deepEqual(geom.slice(0,4),[true,true,'none','0']);
    assert.ok(Number(geom[4])>0);
    const frames=await run(`new Promise(resolve=>{
      const chart=document.querySelector('#eth-chart'), play=document.querySelector('#arcade').getBoundingClientRect();
      const grid=getComputedStyle(chart.querySelector('.eth-grid'));
      const rsi=chart.querySelector('[data-trace="rsi"]');
      const p=(e,x,y)=>{const xy=new DOMPoint(x,y).matrixTransform(e.getScreenCTM());return [xy.x,xy.y]};
      const sample=ts=>({ts,traces:[...chart.querySelectorAll('.eth-scroll [data-trace]')].map(e=>p(e,500,50)),
        guides:[...chart.querySelectorAll('[data-rsi-guide]')].map(e=>{
          const y=+(e.getAttribute('y1')), s=getComputedStyle(e);
          const target=9+82*(1-Number(e.dataset.rsiGuide)/100);
          const left=p(e,0,y),right=p(e,1000,+(e.getAttribute('y2')));
          return {left,right,aligned:Math.abs(p(rsi,0,target)[1]-left[1])<.01,
            full:Math.abs(left[0]-play.left)<.02&&Math.abs(right[0]-play.right)<.02&&Math.abs(left[1]-right[1])<.01,
            stronger:parseFloat(s.strokeWidth)>parseFloat(grid.strokeWidth)&&+s.opacity>+grid.opacity,
            dotted:s.strokeLinecap==='round'&&parseFloat(s.strokeDasharray)<parseFloat(s.strokeWidth)};
        })});
      requestAnimationFrame(ts=>{const first=sample(ts);setTimeout(()=>requestAnimationFrame(t=>resolve([first,sample(t)])),330)});
    })`);
    const [f1,f2]=frames;
    const speed=(f1.traces[0][0]-f2.traces[0][0])/((f2.ts-f1.ts)/1000);
    assert.ok(Math.abs(speed-geom[5]/7200)<.01,`drift measured ${speed}px/s`);
    for(let i=0;i<f1.traces.length;i++)assert.deepEqual(f2.traces[i],f2.traces[0],'shared horizontal transform');
    assert.equal(f2.traces[0][1],f1.traces[0][1]);
    assert.equal(f1.guides.length,2);
    assert.deepEqual(f1.guides,f2.guides,'guides do not drift');
    assert.ok(f1.guides.every(g=>g.aligned&&g.full&&g.stronger&&g.dotted),JSON.stringify(f1.guides));
    assert.deepEqual(await run(getPaths),first,'no frame-driven vertical changes');
    await wait(`${quote}!==${JSON.stringify(firstQuote)}`);
    const second=await run(getPaths);
    for(let i=0;i<first.length;i++){
      assert.equal(first[i].slice(0,first[i].lastIndexOf('L')),second[i].slice(0,second[i].lastIndexOf('L')));
      assert.notEqual(first[i].split(' ').at(-1),second[i].split(' ').at(-1));
    }
    assert.ok(firstPrice.startsWith(startup+' M '),'first ticker does not replace startup history or connect to it');
    const firstSecond=vertices(firstPrice.slice(startup.length))[0];
    assert.equal(vertices(firstPrice.slice(startup.length)).length,1,'no invented ticker backfill');
    const built=await run(pricePath);
    assert.ok(built.startsWith(startup+' ')&&vertices(built.slice(startup.length)).includes(firstSecond),'previous second vertex retained');
    assert.ok(vertices(built.slice(startup.length)).length>1);
    await checkLegend();
    assert.equal(upstream.candles,1);assert.equal(upstream.stats,1);
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await wait(`document.querySelector('#eth-chart g').getAnimations().length===0`);
    const reduced=await run(`(() => {const g=document.querySelector('#eth-chart g');return [parseFloat(g.style.transform.slice(11)),Date.now()%60000]})()`);
    assert.ok(Math.abs(reduced[0]+reduced[1]/72000)<.06, `reduced-motion offset: ${reduced}`);
    if(mirror==='public'&&route==='/'){
      await wait(ready+' && Date.now()%60000>=2200 && Date.now()%60000<7000',12_000);
      assert.equal(upstream.candles,2);assert.equal(upstream.stats,2);
      const refreshed=times(await run(pricePath));
      assert.ok(refreshed.includes(1000),'newly confirmed close reached the chart');
      for(const x of times(firstPrice.slice(startup.length)))assert.ok(refreshed.some(v=>Math.abs(v-(x-1000/120))<.02),'observed second survived rollover and refreshed candles');
    }
    const stem=['candidate',mirror.replace('/','-'),route==='/'?'root':'standalone'].join('-');
    const checkTapeSlot=async()=>{
      const tape=await run(`(()=>{
        const root=document.querySelector('[data-playfield-module="eth-trade-tape"]');
        if(!root)return null;
        const field=document.querySelector('#arcade').getBoundingClientRect(), bounds=root.getBoundingClientRect();
        const style=getComputedStyle(root),canvas=document.querySelector('#space');
        return {bottomThird:Math.abs(bounds.height-field.height/3)<1&&Math.abs(bounds.bottom-field.bottom)<1,
          behind:+style.zIndex<+getComputedStyle(canvas).zIndex,clipped:style.overflow==='hidden',
          noninteractive:style.pointerEvents==='none'&&root.inert&&root.getAttribute('aria-hidden')==='true'};
      })()`);
      assert.deepEqual(tape,{bottomThird:true,behind:true,clipped:true,noninteractive:true});
    };
    const boxes=()=>run(`['.arcade-header','.account-controls','#eth-market-box','#pause','#arcade','#space','.hud','#overlay','.arcade-footer','.touch-controls'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return [s,r.x,r.y,r.width,r.height];})`);
    const capture=async name=>{
      if(!evidence)return;
      const {data}=await send('Page.captureScreenshot',{format:'png'});
      await writeFile(join(evidence,stem+'-'+name+'.png'),Buffer.from(data,'base64'));
    };
    const desktop=evidence?await boxes():null;await capture('desktop-ready');
    const [x,y]=await run(`(()=>{const r=document.querySelector('#start').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);
    for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x,y,button:'left',clickCount:1});
    await wait(`document.querySelector('#overlay').hidden && !document.querySelector('#pause').disabled`);
    await checkLegend();
    await checkMarketLayer();
    await capture('desktop-playing');
    await checkTapeSlot();
    await send('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});
    await send('Emulation.setTouchEmulationEnabled',{enabled:true});
    await wait(`innerWidth===375 && ${JSON.stringify(trades.map(p=>'$'+p.toLocaleString('en-US')+'.00'))}.includes(${quote})`);
    assert.equal(await run(`document.querySelector('[data-market-field=day]').textContent`),'24h -0.28%');
    assert.equal(await run(`(()=>{
      const price=document.querySelector('[data-market-field=price]'), r=price.getBoundingClientRect();
      return r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth&&
        document.elementFromPoint(r.x+r.width/2,r.y+r.height/2).id==='space';
    })()`),true,'USD quote paints without taking input from the mobile canvas');
    await checkLegend();
    await checkMarketLayer();
    const touch=await run(`(()=>{
      const q=s=>document.querySelector(s), field=q('#arcade').getBoundingClientRect();
      const chart=q('#eth-chart').getBoundingClientRect();
      return {chartVisible:chart.width>0&&chart.height>0&&!q('#eth-chart').hidden,
        controls:['#flight-stick','[data-action="fire"]','[data-action="hyperspace"]'].map(s=>{
          const e=q(s),r=e.getBoundingClientRect();
          const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
          return {width:r.width,hit:e.contains(hit),inside:r.left>=field.left&&r.right<=field.right&&r.bottom<=field.bottom};
        })};
    })()`);
    assert.equal(touch.chartVisible,true,'chart remains available on narrow touch layouts');
    await checkTapeSlot();
    assert.deepEqual(touch.controls.map(c=>c.width),[140,58,48]);
    assert.ok(touch.controls.every(c=>c.hit&&c.inside),'narrow controls are unobstructed during active play');
    if(evidence){
      const narrow=await boxes();await capture('narrow-playing');
      await writeFile(join(evidence,stem+'-layout.json'),JSON.stringify({desktop,narrow},null,2));
    }
    await run(`Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));true`);
    assert.equal(await run(`Boolean(document.querySelector('[data-playfield-module="eth-trade-tape"]'))`),false);
    assert.equal(await run(`document.querySelector('#eth-chart').hasAttribute('hidden') && document.querySelector('#eth-market-box').hidden`),true);
    assert.equal(await run(quote),'Unavailable','cleared quote does not linger in DOM');
    const before=upstream.ticker;await sleep(1150);assert.equal(upstream.ticker,before);
    assert.ok(requested.length>0&&requested.every(url=>new URL(url).origin===origin));
    t.diagnostic(`SVG width ${geom[5]}px; measured ${speed.toFixed(2)}px/s; upstream counts ${JSON.stringify(upstream)}`);
  } finally {
    browser.kill('SIGTERM');await exited;await rm(profile,{recursive:true,force:true});
  }
});
