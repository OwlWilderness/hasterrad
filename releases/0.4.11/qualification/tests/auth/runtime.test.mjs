import test from 'node:test';import assert from 'node:assert/strict';import {join} from 'node:path';import {writeFileSync,mkdirSync} from 'node:fs';import {createHash} from 'node:crypto';import {spawn} from 'node:child_process';import {once} from 'node:events';
import {createApp} from '../../server/app.mjs';import {browser,request,scratch} from './helpers.mjs';
test('same-origin server serves only hash-pinned exported artifact, independently of disabled auth',async t=>{
 const dir=scratch(),root=join(dir,'static');mkdirSync(root);const html='<!doctype html><title>Guest fixture</title>';writeFileSync(join(root,'index.html'),html);writeFileSync(join(root,'private.txt'),'not public');writeFileSync(join(root,'artifact.json'),JSON.stringify({files:{'index.html':createHash('sha256').update(html).digest('hex')}}));
 const origin='http://127.0.0.1:18999',app=await createApp({origin,dev:true,dbPath:join(dir,'auth.sqlite'),staticDir:root});await app.listen(18999);t.after(()=>app.close());
 const response=await request(origin,'/');assert.equal(response.status,200);assert.equal(response.text,html);assert.match(response.headers['content-security-policy'],/frame-ancestors 'self'/);
 for(const path of ['/private.txt','/artifact.json','/../.env','/%2e%2e/.env','/.git/config'])assert.ok([400,404].includes((await request(origin,path)).status));
 const session=(await (await browser(origin)).get('/api/session')).json();assert.equal(session.authenticated,false);assert.equal(session.providers.wallet,false);
});
test('entrypoint real child-process crash/restart retains opaque session and logout revocation',async t=>{
 const origin='http://127.0.0.1:19000',dbPath=join(scratch(),'auth.sqlite');let child;
 const launch=async()=>{child=spawn(process.execPath,['server/main.mjs'],{cwd:new URL('../..',import.meta.url),env:{...process.env,HASTERRAD_DEV:'1',HASTERRAD_PUBLIC_ORIGIN:origin,HASTERRAD_DB_PATH:dbPath,PORT:'19000'},stdio:['ignore','pipe','pipe']});let stdout='';let stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('entrypoint readiness timeout')),5000);child.once('exit',code=>{clearTimeout(timer);reject(new Error('entrypoint exited '+code));});child.stdout.on('data',()=>{if(stdout.includes('HASTERRAD auth listening')){clearTimeout(timer);resolve();}});});};
 t.after(async()=>{if(child&&child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}});
 await launch();const b=await browser(origin),original=b.cookie,csrf=b.csrf;let done=once(child,'exit');child.kill('SIGKILL');await done;await launch();assert.equal((await b.get('/api/session')).json().csrf,csrf);const logout=await b.post('/auth/logout');assert.equal(logout.status,200);done=once(child,'exit');child.kill('SIGKILL');await done;await launch();assert.notEqual((await request(origin,'/api/session',{headers:{cookie:original}})).json().csrf,csrf);
});
