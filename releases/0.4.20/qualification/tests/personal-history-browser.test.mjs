import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {join} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {historyFixture} from './personal-history-fixture.mjs';
import {confirmedEnsName} from '../../hasterrad-game/source/api/server/ens.mjs';

const binary = process.env.HASTERRAD_TEST_CHROMIUM;

for (const route of ['/', '/asteroids.html']) test(`real browser ${route}: ENS, private history, account transitions, stale responses and public board`, {skip:!binary, timeout:30000}, async t => {
  const address='0x1234567890abcdef1234567890abcdef1234abcd';
  const name='pilot-fixture.eth';
  const walletOwner={provider:'ethereum',id:`ethereum:1:${address}`,displayName:address,address,chainId:1};
  let tradeId=0;
  const {app,origin,root,a,b,c,owner,other,seed} = await historyFixture(t,{walletOwner,appOptions:{
    ethMarketOrigin:'https://api.exchange.coinbase.com',ethMarketFetch:async url=>{
      if(url.pathname.endsWith('/ticker'))return Response.json({price:'1812.50',time:new Date().toISOString(),trade_id:++tradeId});
      if(url.pathname.endsWith('/stats'))return Response.json({open:'1800',last:'1818',high:'1830',low:'1780'});
      const end=Date.parse(url.searchParams.get('end'))/1000;
      return Response.json(Array.from({length:180},(_,i)=>{
        const p=1800+i/8+Math.sin(i*.37)*4+Math.sin(i*.13)*7;
        return [end-60*(180-i),p-1,p+1,p-.5,p,20];
      }));
    }}});
  app.context.checkWalletSession=async()=>true;
  app.context.resolveEns=addr=>confirmedEnsName({getEnsName:async()=>name,getEnsAddress:async()=>address},addr);
  seed(owner,'a-old',1280,1700006399.999);
  seed(owner,'a-new',12,1700006400.5,'verified',1000);
  for(let i=0;i<10;i++)seed(owner,`a-fixture-${i}`,i,1699990000);
  seed({...other,displayName:'SyntheticLongPilotName'.repeat(8)},'b',43,1700000200);
  const browser = spawn(binary, ['--headless=new','--disable-background-networking','--disable-component-update',
    '--disable-sync','--no-first-run','--no-default-browser-check','--remote-debugging-pipe',
    '--proxy-server=http://127.0.0.1:1',`--proxy-bypass-list=<-loopback>;${new URL(origin).host}`,
    `--user-data-dir=${join(root,'browser')}`,'about:blank'], {stdio:['ignore','ignore','ignore','pipe','pipe']});
  const exited = once(browser,'close');
  let sequence=0, buffer='';
  const pending=new Map();
  function closePending() { for (const fail of pending.values()) fail(); pending.clear(); }
  browser.once('error',closePending);
  browser.once('close',closePending);
  browser.stdio[4].setEncoding('utf8').on('data', chunk => {
    buffer+=chunk;
    for(let end;(end=buffer.indexOf('\0'))!==-1;){
      const reply=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);
      pending.get(reply.id)?.(reply);
    }
  });
  function command(method,params={},sessionId){return new Promise((resolve,reject)=>{
    const id=++sequence;
    const timer=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timeout: ${method}`));},5000);
    pending.set(id,reply=>{clearTimeout(timer);pending.delete(id);if(!reply||reply.error)reject(Error(`CDP failed: ${method}`));else resolve(reply.result);});
    browser.stdio[3].write(JSON.stringify({id,method,params,sessionId})+'\0',error=>{if(error)pending.get(id)?.();});
  });}
  try{
    const {targetId}=await command('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});
    const send=(method,params)=>command(method,params,sessionId);
    const run=async expression=>{
      const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
      assert.ok(!result.exceptionDetails,'browser JS assertion failed');return result.result.value;
    };
    async function wait(expression){
      for(let i=0;i<100;i++){if(await run(expression))return;await delay(50);}
      const snapshot=await run(`({harness:!!window.historyHarnessReady,hidden:document.hidden,sessionSeen:!!window.sessionSeen,
        account:document.querySelector('#account-status')?.textContent, history:document.querySelector('#personal-history-status')?.textContent,
        historyHttp:window.historyHttp, focus:document.activeElement?.id||document.activeElement?.className,
        player:document.querySelector('#player-scores-status')?.textContent})`);
      assert.fail(`Browser state did not settle: ${expression}; ${JSON.stringify(snapshot)}`);
    }
    const setSession=async session=>{
      assert.equal((await send('Network.setCookie',{url:origin,name:'hasterrad_dev_session',httpOnly:true,sameSite:'Lax',value:session.token})).success,true);
    };
    const version=await command('Browser.getVersion');
    t.diagnostic(`${version.product} via ${binary}`);
    await send('Page.enable');
    await send('Page.addScriptToEvaluateOnNewDocument',{source:`(() => {
      window.historyHarnessReady=true;
      localStorage.setItem('quantumtekh.asteroids.best.v1','999999999');
      const fetchReal=window.fetch.bind(window);
      window.fetch=async (url,options) => {
        if(url==='/api/leaderboard'&&window.boardMode==='offline')throw Error('fixture offline');
        if(url==='/api/leaderboard'&&window.boardMode==='empty')return new Response(JSON.stringify({mode:'classic',board:[]}));
        if(url.startsWith('/api/leaderboard/players/')){
          window.publicDetailRead=true;
          return fetchReal(url,options);
        }
        if(url==='/api/session'){
          const response=await fetchReal(url,options);window.sessionSeen=true;return response;
        }
        if(url==='/api/eth-market'||url==='/api/eth-market/tick'){
          window.marketReads=(window.marketReads||0)+1;
          if(window.marketOffline)return new Response('{}',{status:503});
          const hold=url.endsWith('/tick')&&window.holdMarket;if(hold)window.holdMarket=false;
          const response=await fetchReal(url,hold?{...options,signal:undefined}:options);
          if(hold&&response.ok)await new Promise(resolve=>{window.releaseMarket=resolve;});
          return response;
        }
        if(url==='/api/wallet/display-name'&&window.holdEns){
          window.holdEns=false;
          const response=await fetchReal(url,{...options,signal:undefined});
          if(!response.ok)throw Error('Fixture did not obtain an authorized ENS response');
          await new Promise(resolve=>{window.releaseEns=resolve;});
          return response;
        }
        if(!url.startsWith('/api/me/score-history'))return fetchReal(url,options);
        window.privateRead=true;
        if(window.failHistory)return new Response('{}',{status:503});
        if(!window.holdNext){const response=await fetchReal(url,options);window.historyHttp=response.status;return response;}
        window.holdNext=false;
        // Hold a real, successfully authorized response past UI abort to test the render guard.
        const response=await fetchReal(url,{...options,signal:undefined});
        if(!response.ok)throw Error('Fixture did not obtain an authorized response');
        await new Promise(resolve=>{window.releaseHistory=resolve;});
        return response;
      };
    })()`});
    await send('Page.navigate',{url:origin+route});
    await wait(`window.sessionSeen && !document.hidden && document.querySelectorAll('#leaderboard-list li').length===2`);
    assert.equal(await run(`document.querySelector('#eth-market-box').hidden && !window.marketReads && !performance.getEntriesByType('resource').some(r=>r.name.endsWith('/eth-chart.mjs'))`),true);
    const guestClock=`document.querySelector('footer #utc-clock').textContent`;
    await wait(`/^[0-9]{2}:[0-9]{2}:[0-9]{2} UTC$/.test(${guestClock})`);
    const initialClock=await run(guestClock);
    await wait(`${guestClock}!==${JSON.stringify(initialClock)}`);
    assert.equal(await run(`(() => {
      const clock=document.querySelector('#utc-clock');
      return Math.abs(Date.now()-Date.parse(clock.dateTime))<1500 &&
        !clock.closest('#arcade,[role=status],[aria-live]');
    })()`),true,'guest clock uses current UTC without announcements');
    assert.equal(await run(`(() => {
      const label=document.querySelector('footer .build-version');
      return label?.getClientRects().length && getComputedStyle(label).visibility==='visible' && label.innerText;
    })()`),'v0.4.20');
    assert.deepEqual(await run(`(async()=>{
      const {mountPlayfield}=await import('/assets/playfield-modules.mjs');
      const host=mountPlayfield(document,window);
      let cleaned=false;
      const unregister=host.register({id:'test-beacon',slots:{backdrop:true},mount({roots,signal}){
        roots.backdrop.classList.add('playfield-copy');
        roots.backdrop.textContent='TEST BEACON';
        return ()=>{cleaned=signal.aborted;};
      }});
      host.update({session:null});
      const node=document.querySelector('[data-playfield-module=test-beacon]'), canvas=document.querySelector('#space');
      const style=getComputedStyle(node), canvasStyle=getComputedStyle(canvas);
      const ambient=node.inert && node.parentElement.id==='arcade' && style.pointerEvents==='none' && +style.zIndex<+canvasStyle.zIndex;
      unregister();
      return [ambient,cleaned,!node.isConnected,canvas.isConnected];
    })()`),[true,true,true,true]);
    const history=`document.querySelector('#personal-history')`;
    assert.equal(await run(`!!${history}?.hidden`),true,'guest history must be hidden');
    const rows=`[...document.querySelectorAll('#personal-history-list tbody tr')].map(el=>[...el.cells].map(cell=>cell.textContent).join(' · '))`;
    async function checkColumns(id){
      for(const width of [1100,360]){
        await send('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});
        assert.equal(await run(`(() => {
          const scroller=document.getElementById('${id}');
          const [,score,level]=scroller.querySelectorAll('td');
          const [,scoreHead,levelHead]=scroller.querySelectorAll('th');
          const right=el=>el.getBoundingClientRect().right;
          return scroller.clientWidth>0 && scroller.scrollWidth<=scroller.clientWidth &&
            right(score)===right(scoreHead) && right(level)===right(levelHead) &&
            getComputedStyle(score).textAlign==='right' && getComputedStyle(level).textAlign==='right';
        })()`),true,`${id}: aligned score columns at ${width}px`);
      }
    }
    async function captureScores(id,which){
      const evidence=process.env.HASTERRAD_TEST_SCREENSHOTS;
      if(!evidence)return;
      await mkdir(evidence,{recursive:true});
      for(const width of [1100,360]){
        await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
        await run(`(() => {
          document.getElementById('${id}').scrollIntoView({block:'center'});
          const tag=document.createElement('aside'); tag.id='fixture-caption';
          tag.textContent='SYNTHETIC SAMPLE DATA';
          tag.style.cssText='position:fixed;bottom:8px;left:8px;z-index:9999;padding:6px 8px;background:#15281c;color:#fff;font:12px monospace;pointer-events:none';
          document.body.append(tag);
        })()`);
        const {data}=await send('Page.captureScreenshot',{format:'png'});
        await writeFile(join(evidence,`${route==='/'?'home':'asteroids'}-${which}-${width}.png`),Buffer.from(data,'base64'));
        await run(`document.getElementById('fixture-caption').remove()`);
      }
    }
    async function wheelToTenth(id){
      for(const [width,height] of [[1280,900],[390,844]]){
        await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
        const info=await run(`(async () => {
          const list=document.getElementById('${id}');
          list.scrollIntoView({block:'center',behavior:'instant'});
          list.scrollTop=0;
          await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
          const b=list.getBoundingClientRect();
          const x=Math.round(b.left+b.width/2), y=Math.round(b.top+b.height/2);
          const hit=document.elementFromPoint(x,y);
          window.listWheel=[];
          list.addEventListener('wheel',event=>{window.listWheel.push({trusted:event.isTrusted,target:event.target.tagName});},{once:true,passive:true});
          return {x,y,viewport:[innerWidth,innerHeight],hit:hit?.tagName,inside:list.contains(hit),max:list.scrollHeight-list.clientHeight};
        })()`);
        assert.deepEqual(info.viewport,[width,height]);
        assert.equal(info.inside,true,JSON.stringify(info));
        assert.ok(info.max>0);
        const {x,y}=info;
        await send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
        await send('Input.dispatchMouseEvent',{type:'mouseWheel',x,y,deltaX:0,deltaY:800});
        const reached=`(() => {
          const el=document.getElementById('${id}');const view=el.getBoundingClientRect();
          const row=el.querySelector('tbody tr:nth-child(10)').getBoundingClientRect(); const head=el.querySelector('th').getBoundingClientRect();
          return window.listWheel.some(e=>e.trusted) && el.scrollTop>=el.scrollHeight-el.clientHeight-1 && row.top>=Math.max(0,view.top,head.bottom)-1 && row.bottom<=Math.min(view.bottom,innerHeight)+1;
        })()`;
        try { await wait(reached); } finally {
          const state=await run(`({events:window.listWheel,top:document.getElementById('${id}').scrollTop})`);
          t.diagnostic(`wheel ${width}x${height} ${id}: ${JSON.stringify({...info,...state})}`);
        }
        // Reset only after checking the native gesture; screenshots should start at row one.
        await run(`document.getElementById('${id}').scrollTop=0`);
      }
    }
    const status=`document.querySelector('#personal-history-status').textContent`;
    const label=`document.querySelector('#account-status').textContent`;
    const focus=`window.dispatchEvent(new Event('focus'))`;
    const board=await run(`document.querySelector('#leaderboard-list').textContent`);
    assert.ok(board.includes(name));
    const top=`document.querySelector('#best').textContent`;
    assert.equal(await run(`document.querySelector('#best span:last-child').textContent`),'1,280');
    await run(`window.boardMode='empty'; HasterradScores.refresh()`);
    assert.equal(await run(top),'—');
    assert.match(await run(`document.querySelector('#leaderboard-status').textContent`),/No verified/);
    await run(`window.boardMode='offline'; HasterradScores.refresh()`);
    assert.equal(await run(top),'—');
    assert.match(await run(`document.querySelector('#leaderboard-status').textContent`),/unavailable/);
    await run(`window.boardMode=null; HasterradScores.refresh()`);
    assert.equal(await run(`${history}.hidden`),true);
    await setSession(a);await run(`window.holdEns=true; ${focus}`);
    await wait(`${rows}.length===10 && typeof window.releaseEns==='function'`);
    assert.equal(await run(label),'ethereum: 0x1234…abcd');
    await run('window.releaseEns()');
    await wait(`${label}==='ethereum: ${name}'`);
    assert.equal(await run(`document.querySelector('#beetle-status').hidden && document.querySelector('#remilia-chat').hidden && !performance.getEntriesByName(location.origin+'/api/remilianet/display').length`),true,'Ethereum session does not activate Remilia');
    assert.match((await run(rows))[0], /\b12\b/);
    assert.match((await run(rows))[1], /1,280/);
    async function checkInitialLayout() {
      const results=[];
      for (const [width,height] of [[1100,800],[360,800],[320,640]]) {
        await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
        const observed=await run(`(() => {
          const pub=document.querySelector('#leaderboard-list').closest('section'), mine=${history}, overlay=document.querySelector('#overlay');
          const p=pub.getBoundingClientRect(), m=mine.getBoundingClientRect(), view=overlay.getBoundingClientRect();
          const name=pub.querySelector('.board-name');
          const first=mine.querySelector('tbody tr');
          const dates=[...mine.querySelectorAll('tbody time')];
          return {sideBySide:p.top===m.top&&p.right<m.left, mineFirst:m.bottom<p.top,
            atInitialScroll:overlay.scrollTop===0&&m.top>=view.top&&first.getBoundingClientRect().bottom<=view.bottom,
            compact:p.width<330&&m.width<275, noOverflow:[overlay,pub,mine,document.querySelector('#personal-history-list')].every(e=>e.scrollWidth<=e.clientWidth),
            passive:!pub.querySelector('li :is(a,button,[tabindex],[role=button],[onclick])')&&!document.getElementById('player-scores'),
            noPublicDates:!pub.querySelector('time')&&!document.querySelector('.hud time'),
            longNameFits:[...pub.querySelectorAll('.board-name')].some(e=>e.scrollWidth>e.clientWidth&&getComputedStyle(e).textOverflow==='ellipsis')&&name.clientWidth>0,
            dates:dates.slice(0,2).map(e=>[e.textContent,e.getAttribute('datetime')]), count:dates.length};
        })()`);
        t.diagnostic(`initial ${width}x${height}: ${JSON.stringify(observed)}`);
        if(!observed.atInitialScroll)t.diagnostic(await run(`JSON.stringify((()=>{
          const o=document.querySelector('#overlay'), f=document.querySelector('#personal-history tbody tr');
          return {scroll:o.scrollTop,view:o.getBoundingClientRect(),first:f.getBoundingClientRect(),market:document.querySelector('#eth-market-box').getBoundingClientRect()};
        })())`));
        results.push([width,observed]);
        const evidence=process.env.HASTERRAD_TEST_SCREENSHOTS;
        if(evidence){
          await mkdir(evidence,{recursive:true});
          await run(`(() => {const tag=document.createElement('aside');tag.id='fixture-caption';tag.textContent='SYNTHETIC SAMPLE DATA';tag.style.cssText='position:fixed;bottom:8px;left:8px;z-index:9999;padding:6px 8px;background:#15281c;color:#fff;font:12px monospace;pointer-events:none';document.body.append(tag);})()`);
          const {data}=await send('Page.captureScreenshot',{format:'png'});
          await writeFile(join(evidence,`${route==='/'?'home':'asteroids'}-initial-${width}.png`),Buffer.from(data,'base64'));
          await run(`document.getElementById('fixture-caption').remove()`);
        }
      }
      for (const [width,observed] of results) assert.deepEqual(observed,{
        sideBySide:width===1100,mineFirst:width<700,atInitialScroll:true,compact:true,noOverflow:true,passive:true,noPublicDates:true,longNameFits:true,
        dates:[['2023-11-15','2023-11-15T00:00:00.500Z'],['2023-11-14','2023-11-14T23:59:59.999Z']],count:10,
      },`initial scoreboard layout at ${width}px`);
    }
    await checkInitialLayout();
    assert.deepEqual(await run(`[...document.querySelectorAll('#personal-history th')].map(el=>el.textContent)`),['Date','Score','Level']);
    assert.deepEqual((await run(rows)).slice(0,2),['2023-11-15 · 12 · 1,000','2023-11-14 · 1,280 · 2']);
    await run(`document.querySelector('#leaderboard-list li').click()`);
    assert.equal(await run(`!window.publicDetailRead`),true);
    const chart=`document.querySelector('#eth-chart')`;
    const market=`document.querySelector('#eth-market-box')`;
    await send('Emulation.setDeviceMetricsOverride',{width:1100,height:800,deviceScaleFactor:1,mobile:false});
    await wait(`!${chart}?.hasAttribute('hidden') && ['price','rsi','macd','signal'].every(name=>${chart}?.querySelector('[data-trace="'+name+'"][d]')) && ${market}?.textContent.includes('$1,812.50')`);
    assert.match(await run(`${market}.textContent`),/24h \+1\.00%/);
    assert.equal(await run(`(() => {
      const field=document.querySelector('#space'), box=${market};
      return !!(field.compareDocumentPosition(${chart}) & Node.DOCUMENT_POSITION_PRECEDING) && +getComputedStyle(${chart}).zIndex < +getComputedStyle(field).zIndex &&
        getComputedStyle(${chart}).pointerEvents==='none' && ${chart}.getAttribute('aria-hidden')==='true' &&
        field.parentElement.contains(box) && box.getBoundingClientRect().top>=document.querySelector('.hud').getBoundingClientRect().bottom;
    })()`),true);
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
    assert.equal(await run(`${market}.getBoundingClientRect().height>0 && !${chart}.hasAttribute('hidden')`),true);
    await send('Emulation.setDeviceMetricsOverride',{width:1200,height:850,deviceScaleFactor:1,mobile:false});
    await run(`document.querySelector('#start').click()`);
    await wait(`document.querySelector('#overlay').hidden && !document.querySelector('#pause').disabled`);
    if(process.env.HASTERRAD_TEST_SCREENSHOTS){
      const evidence=process.env.HASTERRAD_TEST_SCREENSHOTS;
      await mkdir(evidence,{recursive:true});
      await run(`(() => {const tag=document.createElement('aside');tag.id='market-fixture-caption';tag.textContent='SYNTHETIC MARKET DATA';tag.style.cssText='position:fixed;bottom:12px;left:12px;z-index:9999;padding:5px;background:#101813;color:white;font:12px monospace';document.body.append(tag);})()`);
      const {data}=await send('Page.captureScreenshot',{format:'png'});
      await writeFile(join(evidence,`${route==='/'?'home':'asteroids'}-eth-market.png`),Buffer.from(data,'base64'));
      await run(`document.querySelector('#market-fixture-caption').remove()`);
    }
    await run(`document.querySelector('#pause').click()`);
    await wait(`!document.querySelector('#overlay').hidden && /Resume/.test(document.querySelector('#pause').textContent)`);
    await run(`window.marketOffline=true; ${focus}`);
    await wait(`${chart}.hasAttribute('hidden') && !${market}.hidden && ${market}.textContent.includes('Unavailable')`);
    await run(`window.marketOffline=false; ${focus}`);
    await wait(`!${chart}.hasAttribute('hidden')`);
    assert.equal(await run(`getComputedStyle(${history}).display !== 'none'`),true);
    assert.equal(await run(`${history}.querySelectorAll('summary,details').length`),0);
    assert.equal(await run(`(() => { const el=document.querySelector('#personal-history-list');return el.scrollHeight>el.clientHeight && el.clientHeight>0; })()`),true);
    assert.deepEqual(await run(`[...document.querySelectorAll('#personal-history th')].map(el=>el.textContent)`),['Date','Score','Level']);
    assert.equal(await run(`${history}.querySelectorAll('button:not([hidden])').length`),0);
    await checkColumns('personal-history-list');
    await captureScores('personal-history','private-history');
    await wheelToTenth('personal-history-list');
    assert.equal(await run(`${rows}.length`),10);
    await run(`window.releaseHistory=null; window.releaseEns=null; window.holdNext=true; window.holdEns=true; window.holdMarket=true; ${focus}`);
    await wait(`typeof window.releaseHistory==='function' && typeof window.releaseEns==='function' && typeof window.releaseMarket==='function'`);
    await setSession(b);await run(focus);
    await wait(`${rows}.length===1 && /\\b43\\b/.test(${rows}[0])`);
    await run(`window.releaseHistory(); window.releaseEns(); window.releaseMarket(); new Promise(resolve=>setTimeout(resolve,100))`);
    assert.equal(await run(`${chart}.hasAttribute('hidden') && ${market}.hidden && !${market}.textContent.includes('$1,812.50') && !${chart}.querySelector('[data-trace][d]')`),true);
    assert.equal(await run(label),'urbit: Synthetic B');
    assert.match((await run(rows))[0], /\b43\b/);
    assert.equal((await run(rows)).length,1);
    await setSession(c);await run(focus);
    await wait(`/No finished scores/.test(${status})`);
    assert.deepEqual(await run(rows),[]);
    await run(`window.failHistory=true; ${focus}`);
    await wait(`/unavailable/.test(${status})`);
    await run(`window.failHistory=false; document.querySelector('#personal-history-retry').click()`);
    await wait(`/No finished scores/.test(${status})`);
    await setSession(a);await run(focus);
    await wait(`${rows}.length===10`);
    await run(`window.releaseHistory=null; window.releaseMarket=null; window.holdNext=true; window.holdMarket=true; ${focus}`);
    await wait(`!window.holdNext && typeof window.releaseHistory==='function' && typeof window.releaseMarket==='function'`);
    await run(`document.querySelector('#account-logout').click()`);
    await wait(`${history}.hidden && ${rows}.length===0 && document.querySelector('#account-status').textContent==='Guest'`);
    await run(`window.releaseHistory(); window.releaseMarket(); new Promise(resolve=>setTimeout(resolve,100))`);
    assert.deepEqual(await run(rows),[]);
    assert.equal(await run(`${history}.hidden`),true);
    assert.equal(await run(`document.querySelector('#leaderboard-list').textContent`),board);
    assert.equal(await run(`${chart}.hasAttribute('hidden') && ${market}.hidden`),true);
  } finally {
    browser.kill();
    await exited;
  }
});
