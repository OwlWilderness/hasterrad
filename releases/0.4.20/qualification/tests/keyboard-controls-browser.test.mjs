import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {historyFixture} from './personal-history-fixture.mjs';

const binary = process.env.HASTERRAD_TEST_CHROMIUM;
async function withBrowser({origin,root}, exercise) {
  const browser = spawn(binary, ['--headless=new','--disable-background-networking','--disable-component-update',
    '--disable-sync','--no-first-run','--no-default-browser-check','--remote-debugging-pipe',
    '--proxy-server=http://127.0.0.1:1',`--proxy-bypass-list=<-loopback>;${new URL(origin).host}`,
    `--user-data-dir=${join(root,'browser')}`,'about:blank'], {stdio:['ignore','ignore','ignore','pipe','pipe']});
  const exited = once(browser,'close');
  let sequence=0, buffer='';
  const pending=new Map();
  function closePending() { for (const fail of pending.values()) fail(); }
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
  try {
    const {targetId}=await command('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});
    const send=(method,params)=>command(method,params,sessionId);
    const run=async expression=>{
      const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
      assert.ok(!result.exceptionDetails, 'browser JS evaluation failed');return result.result.value;
    };
    async function wait(expression){
      for(let i=0;i<100;i++){if(await run(expression))return;await delay(40);}
      assert.fail(`Browser state did not settle: ${expression}`);
    }
    const keyEvent=(code,type,autoRepeat=false)=>{
      const keys={Enter:['Enter',13],KeyP:['p',80],KeyR:['r',82],KeyH:['h',72],Escape:['Escape',27]};
      const [key,windowsVirtualKeyCode]=keys[code]??[code,0];
      const enter=code==='Enter'&&type==='rawKeyDown';
      return send('Input.dispatchKeyEvent',{type:enter?'keyDown':type,key,code,autoRepeat,windowsVirtualKeyCode,...(enter?{text:'\r'}:{})});
    };
    const down=(code,repeat=false)=>keyEvent(code,'rawKeyDown',repeat), up=code=>keyEvent(code,'keyUp');
    const press=async code=>{await down(code);await up(code);};
    await send('Page.enable');
    await exercise({send,run,wait,down,up,press,version:await command('Browser.getVersion')});
  } finally {
    browser.kill();
    await exited;
  }
}

for (const route of ['/', '/asteroids.html']) for (const account of [false,true]) {
  test(`Brave ${route} ${account?'account':'guest'}: Enter focus and P toggle`, {skip:!binary,timeout:25000}, async t=>{
    const fixture=await historyFixture(t);
    const {origin,a,owner,seed}=fixture;
    if(account) seed(owner,'fixture-previous-run',80,1700000000);
    await withBrowser(fixture, async ({send,run,wait,down,up,press,version})=>{
      t.diagnostic(version.product);
      await send('Page.addScriptToEvaluateOnNewDocument',{source:`(() => {
        const real=window.fetch.bind(window);
        window.runPosts=0;
        window.fetch=async (url, options) => {
          if(url==='/api/runs/start'){
            window.runPosts++;
            await new Promise(resolve=>{window.releaseStart=resolve;});
            const response=await real(url,options); window.startAccepted=response.ok; return response;
          }
          if(url==='/api/session') {
            const response=await real(url,options); window.sessionSeen=true; return response;
          }
          return real(url,options);
        };
        window.addEventListener('click',event=>{
          if(event.target.closest('.home-link')){event.preventDefault();window.linkActivated=true;}
        });
      })()`});
      if(account) assert.equal((await send('Network.setCookie',{url:origin,name:'hasterrad_dev_session',httpOnly:true,sameSite:'Lax',value:a.token})).success,true);
      await send('Page.navigate',{url:origin+route});
      await wait(`window.sessionSeen && document.querySelector('#leaderboard-status').textContent !== 'Loading account scores…'`);
      const mode=`document.querySelector('#flight-status').textContent`;
      const ready=`${mode}==='READY WHEN YOU ARE'`, paused=`${mode}==='FLIGHT SUSPENDED'`;
      const playing=`${mode}.startsWith('HYPERSPACE /')`;
      const label=`document.querySelector('#pause').innerText`;
      const focused=id=>`document.activeElement.id===${JSON.stringify(id)}`;
      const focus=selector=>run(`document.querySelector(${JSON.stringify(selector)}).focus()`);
      if(account){
        await wait(`document.querySelector('#personal-history-list tbody tr')?.textContent.includes('80')`);
        assert.equal(await run(`document.querySelector('#personal-history').querySelector('summary, details')`),null);
        await focus('#personal-history-list');
        assert.equal(await run(focused('personal-history-list')),true);
        await press('Enter');
        assert.deepEqual(await run(`[${ready},document.querySelector('#start').disabled,window.runPosts]`),[true,false,0],'Enter while reading the focused score list must not start a run');
        assert.equal(await run(`document.querySelector('#leaderboard-list a, #leaderboard-list button, #leaderboard-list [tabindex]')`),null);
      } else assert.equal(await run(`document.querySelector('#personal-history').hidden`),true);

      await focus('.home-link');
      await press('Enter');
      assert.equal(await run(`window.linkActivated && (${ready})`),true,'native Enter must activate the focused link');

      await focus('#space');
      assert.equal(await run(focused('space')),true);
      await down('Enter',true); await up('Enter');
      assert.deepEqual(await run(`[${ready},document.querySelector('#start').disabled,window.runPosts]`),[true,false,0],'an already-held Enter must not start when focus reaches the game');
      assert.equal(await run(label),'Pause (P)');
      if (!account && route === '/') {
        await run(`document.activeElement.blur()`);
        assert.equal(await run(`document.activeElement===document.body`),true);
      }
      await down('Enter');
      if(account){
        await wait(`window.runPosts===1 && document.querySelector('#start').disabled`);
        await down('Enter',true); await up('Enter'); await press('Enter');
        assert.equal(await run(`window.runPosts`),1,'pending authenticated start must not issue duplicate requests');
        await run('window.releaseStart()');
      } else await up('Enter');
      await wait(`${playing} && ${focused('space')}`);
      assert.equal(await run(`window.runPosts`),account?1:0);
      if(account) assert.equal(await run(`window.startAccepted`),true);
      assert.equal(await run(label),'Pause (P)');
      await down('KeyH'); await wait(`${playing} && ${mode}!=='HYPERSPACE / READY'`); await up('KeyH');

      await down('KeyP'); await wait(`${paused} && ${focused('start')}`);
      assert.equal(await run(label),'Resume (R/P)');
      await down('KeyP',true); await down('KeyP',true);
      assert.equal(await run(paused),true,'holding P must not resume');
      await up('KeyP');
      await down('Enter',true); await up('Enter');
      assert.equal(await run(paused),true,'held Enter must not click the focused Resume button');
      if(account){
        await focus('#personal-history-list'); await press('Enter');
        assert.equal(await run(paused),true,'Enter in the actual history panel must not resume');
      }
      await press('KeyP'); await wait(`${playing} && ${focused('space')}`);
      await down('KeyR');
      assert.equal(await run(playing),true,'R must not pause');
      await press('KeyP'); await wait(paused);
      await down('KeyR',true); await up('KeyR');
      assert.equal(await run(paused),true,'an already-held R must not resume');
      await press('KeyR'); await wait(`${playing} && ${focused('space')}`);
      await press('Escape'); await wait(paused);
      await press('Enter'); await wait(`${playing} && ${focused('space')}`);
      await focus('#pause'); await press('Enter'); await wait(paused);
      assert.equal(await run(label),'Resume (R/P)');
      await focus('#pause'); await press('Enter'); await wait(playing);
      assert.equal(await run(`window.runPosts`),account?1:0,'resume must not start another account run');
    });
  });
}
