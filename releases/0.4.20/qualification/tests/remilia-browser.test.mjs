import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setup} from './auth/remilia-display.test.mjs';
import {browser as syntheticClient} from './auth/helpers.mjs';

const binary=process.env.HASTERRAD_TEST_CHROMIUM;
const evidence=process.env.HASTERRAD_REMILIA_EVIDENCE;
const idsOnly=process.env.HASTERRAD_REMILIA_IDS_ONLY==='1';
const preciseIds=['58575','9007199254740992','9007199254740993'];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
for(const [mirror,index] of [['public',0],['api/public',1]])test(`Remilia display from ${mirror}, both game routes`,{skip:!binary,timeout:90000},async t=>{
 const profile=await mkdtemp(join(tmpdir(),'hasterrad-remilia-brave-'));
 t.after(()=>rm(profile,{recursive:true,force:true}));
 const staticDir=fileURLToPath(new URL(`../../hasterrad-game/source/${mirror}/`,import.meta.url));
 const {controls,login,origin}=await setup(t,{staticDir,scoreDb:true});
 const browser=spawn(binary,['--headless=new','--mute-audio','--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--no-default-browser-check','--remote-debugging-pipe','--proxy-server=http://127.0.0.1:1',`--proxy-bypass-list=<-loopback>;${new URL(origin).host}`,`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','ignore','pipe','pipe']});
 const exited=once(browser,'close');
 let seq=0,buffer='';const pending=new Map();
 browser.stdio[4].setEncoding('utf8').on('data',chunk=>{
  buffer+=chunk;
  for(let end;(end=buffer.indexOf('\0'))>=0;){const reply=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);pending.get(reply.id)?.(reply);}
 });
 const command=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
  const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timeout: ${method}`));},4500);
  pending.set(id,reply=>{clearTimeout(timer);pending.delete(id);reply.error?reject(Error(`${method}: ${reply.error.message}`)):resolve(reply.result);});
  browser.stdio[3].write(JSON.stringify({id,method,params,sessionId})+'\0');
 });
 try{
  t.diagnostic((await command('Browser.getVersion')).product);
  for(const [route,width] of [['/',1200],['/asteroids.html',390],['/',390],['/asteroids.html',1200]]){
   const player=await syntheticClient(origin);controls.mode='ok';await login(player,'synthetic_pilot');
  controls.messages=['Synthetic // north relay online','Carrier stable','Radar clear',
  'Synthetic // lunar relay online','Signal nominal',
  'Synthetic // south relay online','Channel quiet','Ranging complete','Beacon locked',
  'Synthetic // north reply received','Standing by',
  'Synthetic // lunar reply received','Telemetry steady','Crossing confirmed','Switching channels',
  'Synthetic // south reply received','<b>literal</b> https://invalid.test','Synthetic // copy, standing by'].map((text,i)=>({id:preciseIds[width>700?i:i-15]??i+1,text}));
   if(evidence)controls.messages[0].text='CASCADE-01 // North relay';
   const firstMessages=controls.messages.filter(row=>preciseIds.includes(row.id));
   controls.messages.push({id:58575,text:'Duplicate legacy row'}, {id:9007199254740992,text:'Unsafe numeric row'});
   const {targetId}=await command('Target.createTarget',{url:'about:blank'});
   const {sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});
   const send=(method,params)=>command(method,params,sessionId);
   const run=async expression=>{const {result,exceptionDetails}=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});assert.ok(!exceptionDetails,exceptionDetails?.text);return result.value;};
   const wait=async(expression)=>{for(let i=0;i<85;i++){if(await run(expression))return;await new Promise(resolve=>setTimeout(resolve,50));}assert.fail(`Browser state never settled: ${expression}`);};
   const pause=()=>new Promise(resolve=>setTimeout(resolve,250));
   const injectCookie=async p=>{const [name,value]=p.cookie.split('=');assert.equal((await send('Network.setCookie',{url:origin,name,value,httpOnly:true})).success,true);};
   await injectCookie(player);
   await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:false});
   await send('Page.navigate',{url:origin+route});
   await wait(`document.querySelector('#account-status')?.textContent.includes('~synthetic_pilot')`);
   const box=`document.querySelector('#beetle-status')`,chat=`document.querySelector('#remilia-chat')`;
   await wait(`${box} && !${box}.hidden && ${chat} && !${chat}.hidden`);
   const checkIds=async()=>{
    for(const {id,text} of firstMessages){
     const selector=JSON.stringify('#remilia-chat [data-message-id="'+id+'"]');
     assert.deepEqual(await run(`[...document.querySelectorAll(${selector})].map(n=>n.textContent)`),[text],`exactly one visible-layer row for ${id}`);
    }
    assert.doesNotMatch(await run(`${chat}.textContent`),/Duplicate legacy row|Unsafe numeric row/);
   };
   if(idsOnly){
    await t.test(`documented chat IDs ${route} at ${width}px`,async()=>{
     await checkIds();
     await run(`document.querySelector('#start').click()`);
     await wait(`document.querySelector('#overlay').hidden`);
     for(const {id} of firstMessages){
      const selector=JSON.stringify('#remilia-chat [data-message-id="'+id+'"]');
      assert.equal(await run(`(()=>{
       const row=document.querySelector(${selector}),group=row.parentElement;
       for(const a of group.getAnimations()){a.pause();a.currentTime=a.effect.getTiming().delay+12000;}
       const range=document.createRange();range.selectNodeContents(row);
       const r=range.getBoundingClientRect(), clip=${chat}.getBoundingClientRect();
       return group.getAnimations().length===2 && +getComputedStyle(group).opacity>0.15 && r.width>0 && r.height>0 &&
        r.top>=clip.top && r.bottom<=clip.bottom && r.left<clip.right && r.right>clip.left;
      })()`),true,`ID ${id} reaches the painted active-flight layer`);
     }
    });
    await command('Target.closeTarget',{targetId});continue;
   }
   await checkIds();
   // The score store accepts the canonical Remilia issuer, not the loopback realm.
   await wait(`!document.querySelector('#personal-history').hidden && /Score history unavailable/.test(document.querySelector('#personal-history-status').textContent)`);
   assert.deepEqual(await run(`[...document.querySelectorAll('#personal-history th')].map(el=>el.textContent)`),['Date','Score','Level']);
   assert.equal(await run(`document.querySelector('#eth-chart').hasAttribute('hidden') && !performance.getEntriesByType('resource').some(r=>new URL(r.name).pathname.startsWith('/api/eth-market'))`),true,'Remilia session does not activate the ETH market');
  const point=`(()=>{const n=${chat}.firstElementChild,r=n.getBoundingClientRect(),s=getComputedStyle(n);return [r.left,r.top,s.transform,s.animationDelay];})()`;
  assert.equal(await run(`${chat}.childElementCount`),width>700?6:3,'bounded number of groups');
  assert.deepEqual(await run(`[...${chat}.children].map(n=>n.childElementCount).sort()`),width>700?[2,2,3,3,4,4]:[1,1,1]);
  const requests=`performance.getEntriesByName(location.origin+'/api/remilianet/display').length`;
  await run(`window.tracked=${chat}.firstElementChild;window.trackedRows=[...window.tracked.children];
   window.originalStarts=${chat}.getAnimations({subtree:true}).map(a=>[a,a.startTime??document.timeline.currentTime]);`);
  const restoreClocks=async()=>assert.equal(await run(`(async()=>{
   const tracks=window.originalStarts;
   // A wrap probe sits 1 ms before the end. Do not let play() advance that
   // seek position across retirement while waiting for the pending play task.
   await Promise.all(tracks.map(async ([a])=>{a.currentTime=0;a.play();await a.ready;}));
   for(const [a,start] of tracks)a.startTime=start;
   return tracks.every(([a])=>a.playState==='running'&&!a.pending);
  })()`),true,'sampled tracks resume their natural clocks');
  const trackAt=ms=>run(`(()=>{
   const n=window.tracked;for(const a of n.getAnimations()){a.pause();a.currentTime=${ms};}
   const r=n.getBoundingClientRect(),layer=${chat}.getBoundingClientRect();
   return {x:(r.left-layer.left)/layer.width,y:(r.top-layer.top)/layer.height,
    same:window.trackedRows.every((row,i)=>row===n.children[i]&&${chat}.querySelectorAll('[data-message-id="'+row.dataset.messageId+'"]').length===1),
    transform:getComputedStyle(n).transform};
  })()`);
  for(const [lap,x] of [[0,.68],[1,.36],[2,.04]]){
   for(const [ms,minY,maxY] of [[1,-.001,.01],[15000,.48,.52],[29999,.98,1.001]]){
    const sample=await trackAt(lap*30000+ms);
    assert.ok(Math.abs(sample.x-x)<.001,`lap ${lap+1} must remain in its lane (x=${sample.x})`);
    assert.ok(sample.y>=minY&&sample.y<=maxY,`lap ${lap+1} must travel from top to bottom (y=${sample.y})`);
    assert.ok(sample.same,'both wraps preserve the original unique message nodes');
    assert.match(sample.transform,/^matrix\(1, 0, 0, 1, 0, /,'translation is vertical and rows stay horizontal');
   }
  }
  assert.equal(await run(requests),1,'wraps do not fetch');
  await restoreClocks();
   assert.deepEqual(await run(`[...${box}.querySelectorAll('[data-beetle-field]')].map(n=>n.textContent)`),['7','1,234','0']);
   assert.match(await run(`${chat}.textContent`),/<b>literal<\/b> https:\/\/invalid\.test/);
   assert.equal(await run(`${chat}.querySelectorAll('a,b,button,input,img,[tabindex]').length`),0);
   assert.equal(await run(`getComputedStyle(${chat}).pointerEvents==='none' && Number(getComputedStyle(${chat}).zIndex)<Number(getComputedStyle(document.querySelector('#space')).zIndex) && ${box}.getBoundingClientRect().right<=innerWidth`),true);
   assert.equal(await run(`(()=>{const b=${box}.getBoundingClientRect();return ['#account-logout','#account-status','#pause'].every(id=>{const r=document.querySelector(id).getBoundingClientRect();return r.right<=b.left||r.left>=b.right||r.bottom<=b.top||r.top>=b.bottom;});})()`),true,'Beetle box must not overlap sign-out, account name, or Pause');
   await run(`document.querySelector('#start').click()`);
   await wait(`document.querySelector('#overlay').hidden`);
   const key=(code,type='rawKeyDown')=>send('Input.dispatchKeyEvent',{type,code,key:code==='Space'?' ':code});
   const tap=async code=>{await key(code);await key(code,'keyUp');};
   await tap('KeyP');await wait(`!document.querySelector('#overlay').hidden`);
   await tap('KeyR');await wait(`document.querySelector('#overlay').hidden`);
   assert.equal(await run(`(()=>{const r=${chat}.firstElementChild.getBoundingClientRect();return document.elementFromPoint(r.left+4,r.top+4)?.id==='space';})()`),true);
   const desktopRoot=route==='/'&&width===1200;
  const capture=async path=>{const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,optimizeForSpeed:true});await writeFile(path,Buffer.from(data,'base64'));};
  const sample=`(()=>{const root=${chat},area=root.getBoundingClientRect();return [...root.children].map(n=>{
   const r=n.getBoundingClientRect();return {column:String(Math.round(((r.left-area.left)/area.width-.04)/.32)),ids:[...n.children].map(x=>x.dataset.messageId),left:r.left,right:r.right,top:r.top,bottom:r.bottom,visible:Number(getComputedStyle(n).opacity)>.15&&r.top>=area.top&&r.bottom<=area.bottom};
  });})()`;
  const layout=async()=>{
   const visible=(await run(sample)).filter(n=>n.visible), gaps=[];
   for(const [i,a] of visible.entries())for(const b of visible.slice(i+1)){
    assert.ok(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top,'visible bursts never intersect');
    if(a.column===b.column)gaps.push(Math.max(a.top,b.top)-Math.min(a.bottom,b.bottom));
   }
   assert.equal(new Set(visible.flatMap(n=>n.ids)).size,visible.flatMap(n=>n.ids).length,'visible IDs are unique');
   return {counts:['0','1','2'].map(c=>visible.filter(n=>n.column===c).length),gaps,visible};
  };
  const label=`${index}-${route==='/'?'root':'asteroids'}-${width}`;
  if(evidence)await mkdir(evidence,{recursive:true});
  if(desktopRoot&&index===0&&evidence){
   const dir=join(evidence,'frames');await mkdir(dir,{recursive:true});
   await run(`(()=>{
    const badge=document.createElement('div');
    badge.textContent='SYNTHETIC FLIGHT  •  CHAT 5× / FLIGHT 1×  •  FOLLOW CASCADE-01';
    Object.assign(badge.style,{position:'fixed',left:'50%',top:'4px',transform:'translateX(-50%)',zIndex:1000,
      color:'#ffe7a4',background:'#111b16',border:'1px solid #70644a',padding:'4px 9px',font:'12px monospace',pointerEvents:'none'});
    document.body.append(badge);
    window.tracked.style.color='#ffdb86';window.tracked.style.setProperty('--ink','.93');
    for(const a of ${chat}.getAnimations({subtree:true})){a.currentTime=0;a.playbackRate=5;a.play();}
   })()`);
   const begin=performance.now(),timeline=[];
   await key('ArrowUp');
   for(let i=0;i<152;i++){
    const delay=begin+i*125-performance.now();if(delay>0)await sleep(delay);
    if(i%6===0)await tap('Space');
    if(i%24===8)await key('ArrowRight');
    if(i%24===12)await key('ArrowRight','keyUp');
    assert.equal(await run(`document.querySelector('#overlay').hidden&&AsteroidsDebug.snapshot().mode==='playing'`),true,`active flight at frame ${i}`);
    const tracked=await run(`window.tracked.isConnected && window.trackedRows.every((row,i)=>row===window.tracked.children[i])`);
    timeline.push({frame:i,seconds:(performance.now()-begin)/1000,tracked,...await layout()});
    await capture(join(dir,`${String(i).padStart(3,'0')}.png`));
   }
   await key('ArrowUp','keyUp');
   assert.ok(timeline.some(s=>s.counts.includes(1)&&!s.counts.includes(2)));
   assert.ok(timeline.some(s=>s.counts.every(n=>n===2)&&s.gaps.every(g=>g>24)));
   for(const column of ['2','1','0'])assert.ok(timeline.some(s=>s.tracked&&s.visible.some(n=>n.column===column&&n.ids.join(',')===preciseIds.join(','))));
   assert.equal(timeline.at(-1).tracked,false,'tracked group retires after its left pass');
   assert.equal(await run(requests),1,'no extra reads across either wrap or retirement');
   await writeFile(join(evidence,'flight-timeline.json'),JSON.stringify(timeline));
   await command('Target.closeTarget',{targetId});
   continue;
  }
  // Sample all native tracks at the same time; all lanes are occupied by now.
  await run(`(async()=>{
   const tracks=${chat}.getAnimations({subtree:true});
   await Promise.all(tracks.map(async a=>{a.pause();await a.ready;a.currentTime=${width>700?84800:74000};}));
  })()`);
  const coexist=await layout();
  t.diagnostic(`coexist ${label} ${JSON.stringify({counts:coexist.counts,gaps:coexist.gaps,bounds:coexist.visible.map(n=>[n.column,n.top,n.bottom])})}`);
  if(width>700){
   assert.deepEqual(coexist.counts,[2,2,2]);
   assert.ok(coexist.gaps.every(g=>g>24),'same-column bursts have visible vertical separation');
  }else assert.deepEqual(coexist.counts,[1,1,1]);
  t.diagnostic(`${label} ${JSON.stringify({counts:coexist.counts,gaps:coexist.gaps})}`);
  if(evidence)await capture(join(evidence,`${label}-playing.png`));
  // Restore the pre-sample time so normal polls observe real elapsed animation time.
  await restoreClocks();
  if(desktopRoot){
   const chatRequests=()=>controls.calls.filter(path=>path.includes('/global-chat/')).length;
   const initial=chatRequests();assert.equal(await run(requests),1,'animation frames do not fetch');
   controls.now+=30001; // Advance the fixture's server cache clock; browser poll stays on its real timer.
   if(index===0){
    await run(`window.survivor=${chat}.lastElementChild;window.survivorAnimation=window.survivor.getAnimations()[0];`);
    // Keep overlap with the unchanged entries and use identical text under a distinct ID.
    controls.messages=[...controls.messages.slice(1,18),{id:19,text:controls.messages[17].text}];
    const elapsed=await run(`performance.now()-performance.getEntriesByName(location.origin+'/api/remilianet/display')[0].startTime`);
    await sleep(Math.max(1,29500-elapsed));
    await wait(`${requests}===2`);
    assert.ok(await run(`window.survivor.isConnected&&window.survivor.getAnimations()[0]===window.survivorAnimation&&window.survivorAnimation.currentTime>28000`),'surviving animation continues across the real poll');
    assert.equal(await run(`${chat}.querySelector('[data-message-id="19"]')===null`),true,'new group waits for capacity');
    await run(`${chat}.firstElementChild.getAnimations().forEach(a=>a.finish());`);
    await wait(`${chat}.querySelector('[data-message-id="19"]')`);
    assert.equal(await run(`window.survivor.isConnected&&window.survivor.getAnimations()[0]===window.survivorAnimation`),true,'new entry does not restart a drifting message');
    assert.equal(await run(`${chat}.querySelectorAll('[data-message-id="18"],[data-message-id="19"]').length`),2);
    assert.ok(await run(`${chat}.childElementCount<=6`));
   }else{
    await run(`${chat}.getAnimations({subtree:true}).forEach(a=>a.finish())`);
    await wait(`${chat}.hidden && !${chat}.childElementCount`);
    controls.messages[0]={...controls.messages[0],id:58575}; // same ID on a quiet poll, legacy form
    await sleep(29500);await wait(`${requests}===2`);
    assert.equal(await run(`${chat}.hidden && !${chat}.childElementCount`),true,'unchanged page never replays expired messages');
    // Repopulate from the real API in reduced-motion mode, with a short synthetic lease.
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    const short=await syntheticClient(origin);controls.expires=3;await login(short,'expiry_pilot');controls.expires=900;
    await injectCookie(short);await run(`window.dispatchEvent(new Event('focus'))`);
    try { await wait(`${chat}.childElementCount===3 && !${box}.hidden`); }
    catch (error) {
     t.diagnostic(JSON.stringify(await run(`({groups:${chat}.childElementCount,boxHidden:${box}.hidden, reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,
       isNewPilot:document.querySelector('#account-status').textContent.includes('~expiry_pilot'),
       status:performance.getEntriesByName(location.origin+'/api/remilianet/display').map(r=>r.responseStatus)})`)));
     t.diagnostic(`Synthetic display upstream read count: ${controls.calls.length}`);
     throw error;
    }
    const still=await run(point);await pause();assert.deepEqual(await run(point),still);
    assert.equal(await run(`${chat}.getAnimations({subtree:true}).length`),0);
    await wait(`${chat}.hidden && !${chat}.childElementCount && ${box}.hidden`);
    await send('Emulation.setEmulatedMedia',{features:[]});
   }
   assert.equal(chatRequests(),initial+(index===0?1:2),'only normal poll and new-session reads reach the provider');
  }
   // Force the real visibility handler and make an actual delayed provider read.
   await run(`Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));`);
   assert.equal(await run(`${box}.hidden && !${box}.textContent.includes('1,234') && ${chat}.hidden && ${chat}.textContent===''`),true);
   controls.now+=31000;controls.mode='hold';delete controls.release;
  if(desktopRoot&&index===1)await injectCookie(player);
   await run(`delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));`);
   for(let i=0;i<120&&!controls.release;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(controls.release);
   await run(`document.querySelector('#account-logout').click()`);
   await wait(`document.querySelector('#account-status').textContent==='Guest'`);
   controls.release();await pause();
   assert.equal(await run(`${box}.hidden && ${chat}.hidden && ${chat}.textContent===''`),true);
   // Independently hold a real *successful* response body beyond a session switch.
   const stale=await syntheticClient(origin);controls.mode='ok';await login(stale,'stale_pilot');
   await run(`(()=>{const fetch=window.fetch;window.fetch=async (path,opts)=>{
    const response=await Reflect.apply(fetch,window,[path,opts]);
    if(path!=='/api/remilianet/display'||!response.ok||window.releaseDisplay)return response;
    const data=await response.json();return {ok:true,status:200,json:()=>new Promise(resolve=>{window.releaseDisplay=()=>resolve(data);})};
   };})()`);
   await injectCookie(stale);await run(`window.dispatchEvent(new Event('focus'))`);
   await wait(`typeof window.releaseDisplay==='function'`);
   // Switch to a different verified Remilia account with Beetle only.
   const next=await syntheticClient(origin);controls.mode='ok';controls.scope='openid remilia:beetle.read';await login(next,'replacement_pilot');
   await injectCookie(next);await run(`window.dispatchEvent(new Event('focus'))`);
   await wait(`document.querySelector('#account-status').textContent.includes('~replacement_pilot') && !${box}.hidden`);
   await run('window.releaseDisplay()');await pause();
   assert.equal(await run(`${chat}.hidden && ${chat}.textContent===''`),true);
   controls.scope='openid remilia:beetle.read remilia:chat.read';
   await command('Target.closeTarget',{targetId});
  }
 }finally{browser.kill();await exited;}
});
