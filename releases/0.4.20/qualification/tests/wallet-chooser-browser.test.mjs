import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {extname,join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';

const binary=process.env.HASTERRAD_TEST_CHROMIUM;
const root=process.env.HASTERRAD_CHOOSER_PUBLIC||fileURLToPath(new URL('../../hasterrad-game/source/public/',import.meta.url));
const bundle='/assets/wallet/index.js';
const chooser=`[data-rk] [role="dialog"]`;
const csp="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'";
const mime={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png'};

async function fixture(t,{held=false,failed=false}={}) {
  const manifest=JSON.parse(await readFile(join(root,'artifact.json'),'utf8'));
  const bytes=await readFile(join(root,bundle));
  const hash=createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash,manifest.files[bundle.slice(1)]);
  t.diagnostic(`wallet bundle sha256 ${hash}`);
  let release=()=>{},bundleHits=0;
  const gate=held?new Promise(resolve=>{release=resolve;}):Promise.resolve();
  const unexpected=[];
  const server=createServer(async(req,res)=>{
    const path=req.url.split('?')[0];
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',csp);
    if(path==='/api/session'&&req.method==='GET'){
      res.setHeader('Content-Type','application/json');
      return res.end(JSON.stringify({authenticated:false,csrf:'fixture-only',providers:{wallet:true},wallet:{chainId:1,targetNetworks:[1],rpcUrl:origin+'/rpc',burnerWalletMode:'allNetworks'}}));
    }
    if(path==='/api/leaderboard'&&req.method==='GET'){
      res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({entries:[]}));
    }
    if(req.method!=='GET'||path.startsWith('/auth/')||path.startsWith('/api/')||path==='/rpc'){
      unexpected.push(`${req.method} ${path}`);res.writeHead(403);return res.end();
    }
    if(path==='/fixture-frame'){
      res.setHeader('Content-Type','text/html');return res.end('<iframe src="/asteroids.html" width="1000" height="650"></iframe>');
    }
    const file=path==='/'?'index.html':path.slice(1);
    if(!Object.hasOwn(manifest.files,file)){res.writeHead(404);return res.end();}
    if(path===bundle){bundleHits++;await gate;if(failed){res.writeHead(503);return res.end();}}
    res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');
    res.end(path===bundle?bytes:await readFile(join(root,file)));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${server.address().port}`;
  const profile=await mkdtemp(join(tmpdir(),'eth-chooser-'));
  t.after(async()=>{release();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert.deepEqual(unexpected,[],'chooser-only interaction must not hit auth/challenge/RPC');});
  const browser=spawn(binary,['--headless=new','--disable-background-networking','--disable-component-update','--disable-extensions','--disable-sync','--disable-quic','--no-first-run','--no-default-browser-check','--remote-debugging-pipe','--proxy-server=http://127.0.0.1:1',`--proxy-bypass-list=<-loopback>;${new URL(origin).host}`,`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','ignore','pipe','pipe']});
  const closed=new Promise(resolve=>browser.once('close',resolve));
  let id=0,buffer='';const pending=new Map();
  const failAll=()=>{for(const fail of pending.values())fail();};
  browser.on('error',failAll);browser.on('close',failAll);
  browser.stdio[4].setEncoding('utf8').on('data',data=>{
    buffer+=data;
    for(let end;(end=buffer.indexOf('\0'))>=0;){const msg=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);pending.get(msg.id)?.(msg);}
  });
  t.after(async()=>{browser.kill();const timer=setTimeout(()=>browser.kill('SIGKILL'),2000);try{await closed;}finally{clearTimeout(timer);await rm(profile,{recursive:true,force:true});}});
  function command(method,params={},sessionId){return new Promise((resolve,reject)=>{
    const key=++id;
    const timer=setTimeout(()=>pending.get(key)?.(),4000);
    pending.set(key,response=>{pending.delete(key);clearTimeout(timer);if(!response||response.error)reject(Error(`CDP failed: ${method}`));else resolve(response.result);});
    browser.stdio[3].write(JSON.stringify({id:key,method,params,sessionId})+'\0',error=>{if(error)pending.get(key)?.();});
  });}
  const {targetId}=await command('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});
  const send=(method,params)=>command(method,params,sessionId);
  const run=async expression=>{
    const result=await send('Runtime.evaluate',{expression,returnByValue:true});
    assert.ok(!result.exceptionDetails,'fixture JS failed');return result.result?.value;
  };
  const poll=async(fn,ms=2600)=>{
    const end=Date.now()+ms;
    do{if(await fn())return true;await delay(35);}while(Date.now()<end);
    return false;
  };
  const click=async(selector,frame=false)=>{
    const coords=await run(`(() => {const f=${frame?"document.querySelector('iframe')":"null"};const box=f?.getBoundingClientRect();const r=(f?.contentDocument??document).querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2+(box?box.x+f.clientLeft:0),y:r.y+r.height/2+(box?box.y+f.clientTop:0)};})()`);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...coords});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...coords});
  };
  const ready=async(path,frame=false)=>{
    await send('Page.navigate',{url:origin+path});
    assert.ok(await poll(()=>run(`(${frame?"document.querySelector('iframe')?.contentDocument":"document"})?.querySelector('#wallet-login:not(:disabled)')?.getClientRects().length>0`)),'Ethereum button never became ready');
    assert.equal(bundleHits,0,'bundle must remain lazy until standalone click');
  };
  const visible=()=>run(`(() => {const el=document.querySelector(${JSON.stringify(chooser)});return !!el?.getClientRects().length&&getComputedStyle(el).visibility==='visible'&&el.textContent.includes('Burner Wallet');})()`);
  const cancel=async()=>{
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    assert.ok(await poll(async()=>!(await visible())),'Escape did not close RainbowKit');
    await delay(250);
    assert.equal(await visible(),false,'cancelled request reopened without a click');
  };
  return {ready,run,send,click,visible,cancel,poll,release,hits:()=>bundleHits};
}

for(const [path,held] of [['/',false],['/asteroids.html',true]])test(`real Brave ${path}: ${held?'held bundle initialization':'ordinary cold load'}, warm click, Escape and reopen`,{skip:!binary,timeout:18000},async t=>{
  const f=await fixture(t,{held});await f.ready(path);
  await f.click('#wallet-login');
  assert.ok(await f.poll(()=>f.hits()===1),'cold click must fetch wallet JS');
  if(held){
    assert.equal(await f.run(`document.querySelector('#wallet-login').disabled`),true);
    assert.equal(await f.visible(),false);
    await delay(350);f.release();
  }
  const first=await f.poll(f.visible);
  t.diagnostic(`first click: ${first?'chooser visible':'no chooser'}`);
  assert.equal(await f.run(`document.querySelector('[data-hasterrad-auth]').hidden`),true,'a successful import must not show the fallback wrapper');
  if(first)await f.cancel();
  await f.click('#wallet-login');
  const warm=await f.poll(f.visible);
  t.diagnostic(`warm click: ${warm?'chooser visible':'no chooser'}`);
  assert.ok(warm,'warm click must open chooser');
  await f.cancel();await f.click('#wallet-login');
  assert.ok(await f.poll(f.visible),'explicit click after cancel must reopen');
  assert.equal(f.hits(),1,'warm actions must not refetch bundle');
  assert.ok(first,'first click must open chooser without a second click');
});

test('real Brave: import failure shows fallback and Return to flight closes it',{skip:!binary,timeout:12000},async t=>{
  const f=await fixture(t,{failed:true});await f.ready('/');await f.click('#wallet-login');
  assert.ok(await f.poll(()=>f.run(`document.querySelector('[data-hasterrad-auth]:not([hidden])')?.textContent.includes('Wallet tools could not load')`)));
  assert.equal(await f.visible(),false);
  const enter={key:'Enter',code:'Enter',windowsVirtualKeyCode:13};
  await f.run(`document.querySelector('[data-hasterrad-auth] button').focus()`);
  await f.send('Input.dispatchKeyEvent',{...enter,type:'keyDown',text:'\r',unmodifiedText:'\r'});
  await f.send('Input.dispatchKeyEvent',{...enter,type:'keyUp'});
  assert.equal(await f.run(`document.querySelector('[data-hasterrad-auth]').hidden&&document.activeElement.id==='wallet-login'&&document.querySelector('#flight-status').textContent==='READY WHEN YOU ARE'`),true);
});

test('real Brave: embedded click offers standalone without loading wallet tools',{skip:!binary,timeout:12000},async t=>{
  const f=await fixture(t);await f.ready('/fixture-frame',true);await f.click('#wallet-login',true);
  assert.ok(await f.poll(()=>f.run(`document.querySelector('iframe').contentDocument.querySelector('[data-hasterrad-auth]:not([hidden])')?.textContent.includes('Open standalone to sign in')`)));
  assert.equal(f.hits(),0);
  assert.equal(await f.run(`(() => {const a=document.querySelector('iframe').contentDocument.querySelector('[data-hasterrad-auth] a');return a.href===location.origin+'/'&&a.target==='_blank'&&a.rel==='noopener';})()`),true);
});
