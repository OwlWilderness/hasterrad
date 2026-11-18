import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {historyFixture} from './personal-history-fixture.mjs';
import {confirmedEnsName} from '../../hasterrad-game/source/api/server/ens.mjs';

const binary = process.env.HASTERRAD_TEST_CHROMIUM;

for (const route of ['/', '/asteroids.html']) test(`real browser ${route}: ENS, private history, account transitions, stale responses and public board`, {skip:!binary, timeout:30000}, async t => {
  const address='0x1234567890abcdef1234567890abcdef1234abcd';
  const name='pilot-fixture.eth';
  const walletOwner={provider:'ethereum',id:`ethereum:1:${address}`,displayName:address,address,chainId:1};
  const {app,origin,root,a,b,c,owner,other,seed} = await historyFixture(t,{walletOwner});
  app.context.checkWalletSession=async()=>true;
  app.context.resolveEns=addr=>confirmedEnsName({getEnsName:async()=>name,getEnsAddress:async()=>address},addr);
  seed(owner,'a-old',80,1700000000);
  seed(owner,'a-new',12,1700000100);
  seed(other,'b',43,1700000200);
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
        historyHttp:window.historyHttp})`);
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
      const fetchReal=window.fetch.bind(window);
      window.fetch=async (url,options) => {
        if(url==='/api/session'){
          const response=await fetchReal(url,options);window.sessionSeen=true;return response;
        }
        if(url==='/api/wallet/display-name'&&window.holdEns){
          window.holdEns=false;
          const response=await fetchReal(url,{...options,signal:undefined});
          if(!response.ok)throw Error('Fixture did not obtain an authorized ENS response');
          await new Promise(resolve=>{window.releaseEns=resolve;});
          return response;
        }
        if(url!=='/api/me/score-history')return fetchReal(url,options);
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
    assert.equal(await run(`(() => {
      const label=document.querySelector('footer .build-version');
      return label?.getClientRects().length && getComputedStyle(label).visibility==='visible' && label.innerText;
    })()`),'v0.4.13');
    const history=`document.querySelector('#personal-history')`;
    assert.equal(await run(`!!${history}?.hidden`),true,'guest history must be hidden');
    const rows=`[...document.querySelectorAll('#personal-history-list li')].map(el=>el.textContent)`;
    const status=`document.querySelector('#personal-history-status').textContent`;
    const label=`document.querySelector('#account-status').textContent`;
    const focus=`window.dispatchEvent(new Event('focus'))`;
    const board=await run(`document.querySelector('#leaderboard-list').textContent`);
    assert.ok(board.includes(name));
    await setSession(a);await run(`window.holdEns=true; ${focus}`);
    await wait(`${rows}.length===2 && typeof window.releaseEns==='function'`);
    assert.equal(await run(label),'ethereum: 0x1234…abcd');
    await run('window.releaseEns()');
    await wait(`${label}==='ethereum: ${name}'`);
    assert.match((await run(rows))[0], /\b12\b/);
    assert.match((await run(rows))[1], /\b80\b/);
    assert.equal(await run(`getComputedStyle(${history}).display !== 'none'`),true);
    assert.equal(await run(`${history}.querySelector('summary').click(); ${history}.open`),true);
    await run(`window.releaseHistory=null; window.releaseEns=null; window.holdNext=true; window.holdEns=true; ${focus}`);
    await wait(`typeof window.releaseHistory==='function' && typeof window.releaseEns==='function'`);
    await setSession(b);await run(focus);
    await wait(`${rows}.length===1 && /\\b43\\b/.test(${rows}[0])`);
    await run(`window.releaseHistory(); window.releaseEns(); new Promise(resolve=>setTimeout(resolve,100))`);
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
    await wait(`${rows}.length===2`);
    await run(`window.releaseHistory=null; window.holdNext=true; ${focus}`);
    await wait(`!window.holdNext && typeof window.releaseHistory==='function'`);
    await run(`document.querySelector('#account-logout').click()`);
    await wait(`${history}.hidden && ${rows}.length===0 && document.querySelector('#account-status').textContent==='Guest'`);
    await run(`window.releaseHistory(); new Promise(resolve=>setTimeout(resolve,100))`);
    assert.deepEqual(await run(rows),[]);
    assert.equal(await run(`${history}.hidden`),true);
    assert.equal(await run(`document.querySelector('#leaderboard-list').textContent`),board);
  } finally {
    browser.kill();
    await exited;
  }
});
