import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const binary=process.env.HASTERRAD_TEST_CHROMIUM;
const fixtureRow=(provider,name,level,key)=>({provider,name,level,score:1234567,playerKey:key.repeat(43)});
const winner=fixtureRow('ethereum','0x1234567890abcdef1234567890abcdef12345678',27,'W');
const tied=fixtureRow('urbit','~synthetic-pilot',314,'T');
const invalid=fixtureRow('remilianet','~invalid-fixture',0,'I');
const types={html:'text/html',js:'text/javascript',mjs:'text/javascript',css:'text/css',svg:'image/svg+xml',png:'image/png'};

for(const mirror of ['public','api/public']) test(`anonymous Brave HUD and board from ${mirror}`,{skip:!binary,timeout:25000},async t=>{
  const root=new URL(`../../hasterrad-game/source/${mirror}/`,import.meta.url);
  const profile=await mkdtemp(join(tmpdir(),'hasterrad-hud-'));
  let rows=[],offline=false;
  const server=createServer(async(req,res)=>{
    const path=new URL(req.url,'http://127.0.0.1').pathname;
    if(path==='/api/leaderboard'||path==='/api/session'){
      const board=path==='/api/leaderboard';
      res.writeHead(board&&offline?503:200,{'content-type':'application/json','cache-control':'no-store'});
      return res.end(JSON.stringify(board?{mode:'classic',board:rows}:{authenticated:false,providers:{}}));
    }
    const file=path==='/'?'index.html':path.slice(1);
    if(!/^(index\.html|asteroids\.html|assets\/[\w./-]+)$/.test(file)||file.split('/').includes('..'))return res.writeHead(404).end();
    try {
      const bytes=await readFile(new URL(file,root));
      res.writeHead(200,{'content-type':types[file.split('.').at(-1)]??'application/octet-stream'}).end(bytes);
    } catch {res.writeHead(404).end();}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const host=`127.0.0.1:${server.address().port}`;
  const browser=spawn(binary,['--headless=new','--disable-background-networking','--disable-component-update',
    '--disable-sync','--no-first-run','--no-default-browser-check','--remote-debugging-pipe',
    '--proxy-server=http://127.0.0.1:1',`--proxy-bypass-list=<-loopback>;${host}`,
    `--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','ignore','pipe','pipe']});
  const exited=once(browser,'close');
  let seq=0,buffer='';const pending=new Map();
  browser.stdio[4].setEncoding('utf8').on('data',chunk=>{
    buffer+=chunk;
    for(let end;(end=buffer.indexOf('\0'))>=0;){
      const reply=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);pending.get(reply.id)?.(reply);
    }
  });
  const command=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
    const id=++seq;
    const timer=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timeout: ${method}`));},4500);
    pending.set(id,reply=>{clearTimeout(timer);pending.delete(id);reply.error?reject(Error(`${method}: ${reply.error.message}`)):resolve(reply.result);});
    browser.stdio[3].write(JSON.stringify({id,method,params,sessionId})+'\0');
  });
  try {
    t.diagnostic((await command('Browser.getVersion')).product);
    const {targetId}=await command('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});
    const send=(method,params)=>command(method,params,sessionId);
    const run=async expression=>{
      const {result,exceptionDetails}=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
      assert.ok(!exceptionDetails,result.description);return result.value;
    };
    async function wait(expression){
      for(let i=0;i<80;i++){if(await run(expression))return;await new Promise(resolve=>setTimeout(resolve,50));}
      assert.fail(`Browser state never settled: ${expression}`);
    }
    const hud=`document.querySelector('#best')`;
    const status=`document.querySelector('#leaderboard-status').textContent`;
    const refresh=()=>run('HasterradScores.refresh()');
    const checkHUD=async({provider,asset,level,score})=>{
      assert.deepEqual(await run(`(() => {
        const h=${hud}, img=h.querySelector('img');
        return {text:h.innerText.trim().replace(/\\s+/g,' '),icon:img?.getAttribute('src'),alt:img?.alt};
      })()`),{text:`LV ${level} ${score}`,icon:asset,alt:provider});
      await wait(`${hud}.querySelector('img').naturalWidth>0`);
      assert.equal(await run(`(() => {
        const r=${hud}.getBoundingClientRect(), icon=${hud}.querySelector('img').getBoundingClientRect();
        return r.width>0 && r.right<=innerWidth && icon.width>0 && icon.height>0;
      })()`),true);
      const markup=await run(`${hud}.parentElement.outerHTML`);
      assert.doesNotMatch(markup,/\btitle=|synthetic-pilot|0x1234|W{43}|T{43}/i);
      const {root:{nodeId}}=await send('DOM.getDocument');
      const {nodeId:bestId}=await send('DOM.querySelector',{nodeId,selector:'#best'});
      const {node:{backendNodeId}}=await send('DOM.describeNode',{nodeId:bestId});
      const {nodes}=await send('Accessibility.getFullAXTree');
      const byId=new Map(nodes.map(node=>[node.nodeId,node]));
      const visit=node=>[node,...(node.childIds??[]).flatMap(id=>byId.has(id)?visit(byId.get(id)):[])];
      const output=nodes.find(node=>node.backendDOMNodeId===backendNodeId);
      assert.match(output?.name?.value??'',/^Overall top score Classic$/i);
      const exposed=visit(output).map(node=>[node.name?.value,node.description?.value,node.value?.value].join(' ')).join(' ');
      for(const text of [provider,`LV ${level}`,score]) assert.ok(exposed.includes(text),`Missing from accessibility tree: ${text}`);
      assert.doesNotMatch(exposed,/synthetic-pilot|0x1234|W{43}|T{43}/i);
    };
    const checkDash=async()=>{
      assert.equal(await run(`${hud}.innerHTML`),'—');
      assert.deepEqual(await run(`${hud}.getAttributeNames().sort()`),['aria-labelledby','id']);
    };
    for(const [route,width] of [['/',1200],['/asteroids.html',390]]){
      rows=[invalid,winner,tied];offline=false;
      await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:false});
      await send('Page.navigate',{url:`http://${host}${route}`});
      await wait(`location.pathname===${JSON.stringify(route)} && document.querySelectorAll('#leaderboard-list li').length===2`);
      const board=await run(`[...document.querySelectorAll('.board-entry')].map(b=>[b.tagName,b.getAttribute('aria-controls'),b.querySelector('img').alt,...[...b.querySelectorAll('span')].map(x=>x.textContent)])`);
      assert.deepEqual(board,[['SPAN',null,'Ethereum',winner.name,'LV 27','1,234,567'],['SPAN',null,'Urbit',tied.name,'LV 314','1,234,567']]);
      await checkHUD({provider:'Ethereum',asset:'assets/brands/ethereum.svg',level:27,score:'1,234,567'});
      await refresh();
      await checkHUD({provider:'Ethereum',asset:'assets/brands/ethereum.svg',level:27,score:'1,234,567'});
      rows=[tied,winner];await refresh();
      await checkHUD({provider:'Urbit',asset:'assets/brands/urbit.svg',level:314,score:'1,234,567'});
      rows=[];await refresh();assert.match(await run(status),/No verified/);await checkDash();
      rows=[winner];await refresh();
      await checkHUD({provider:'Ethereum',asset:'assets/brands/ethereum.svg',level:27,score:'1,234,567'});
      offline=true;await refresh();assert.match(await run(status),/unavailable/);await checkDash();
    }
  } finally {
    browser.kill();
    await exited;
    await new Promise(resolve=>server.close(resolve));
    await rm(profile,{recursive:true,force:true});
  }
});
