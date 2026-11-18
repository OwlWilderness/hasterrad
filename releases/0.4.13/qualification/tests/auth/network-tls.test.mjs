import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {scratch} from './helpers.mjs';

const run=(script,env)=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--input-type=module','--eval',script],{env,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';
  child.stdout.on('data',chunk=>stdout+=chunk);
  child.stderr.on('data',chunk=>stderr+=chunk);
  child.on('error',reject);
  child.on('close',code=>code===0?resolve(JSON.parse(stdout)):reject(new Error(`child exit ${code}: ${stderr}`)));
});

test('trusted verifier uses URL hostname for TLS, not public HTTP Host',async t=>{
  const dir=scratch();t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const cert=join(dir,'verifier.pem'),key=join(dir,'verifier.key'),config=join(dir,'cert.cnf');
  writeFileSync(config,'[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=local-verifier\n[ext]\nsubjectAltName=IP:127.0.0.1\nbasicConstraints=CA:TRUE\nkeyUsage=digitalSignature,keyEncipherment,keyCertSign\n');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-config',config],{stdio:'ignore'});
  let receivedHost;
  const server=https.createServer({key:readFileSync(key),cert:readFileSync(cert)},(req,res)=>{receivedHost=req.headers.host;res.setHeader('content-type','text/plain');res.end('synthetic verifier');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const network=fileURLToPath(new URL('../../server/network.mjs',import.meta.url));
  const script=`import {trustedRequest} from ${JSON.stringify('file://'+network)};try{const r=await trustedRequest('https://127.0.0.1:${server.address().port}/~/name',{headers:{Host:'public.example.test',Accept:'text/plain'}});console.log(JSON.stringify({status:r.status,text:r.text}));}catch(e){console.log(JSON.stringify({error:e.code||e.name}));}`;
  const result=await run(script,{...process.env,NODE_EXTRA_CA_CERTS:cert});
  assert.deepEqual(result,{status:200,text:'synthetic verifier'});
  assert.equal(receivedHost,'public.example.test');
  const untrusted=await run(script,{...process.env,NODE_EXTRA_CA_CERTS:''});
  assert.deepEqual(untrusted,{error:'DEPTH_ZERO_SELF_SIGNED_CERT'});
});
