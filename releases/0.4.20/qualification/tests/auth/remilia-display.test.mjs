import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {exportJWK,generateKeyPair,SignJWT} from 'jose';
import {createApp} from '../../../hasterrad-game/source/api/server/app.mjs';
import {fixture,browser} from './helpers.mjs';

export const displayPath='/api/remilianet/display';
export async function setup(t,{origin:requestedOrigin,staticDir,scoreDb=false}={}){
 let origin,app,dir;
 const {publicKey,privateKey}=await generateKeyPair('RS256');
 const jwk={...(await exportJWK(publicKey)),kid:'fixture',alg:'RS256'};
 const full='openid remilia:beetle.read remilia:chat.read';
 const controls={scope:full,expires:900,user:'pilot_a',now:Date.now(),calls:[],mode:'ok',requests:new Map()};
 const cookieSafeTokens={};
 const provider=await fixture(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  const send=(data,status=200)=>{res.statusCode=status;res.end(JSON.stringify(data));};
  const base=provider.origin;
  if(req.url==='/realm/.well-known/openid-configuration')return send({issuer:base+'/realm',authorization_endpoint:base+'/authorize',token_endpoint:base+'/token',jwks_uri:base+'/jwks'});
  if(req.url==='/jwks')return send({keys:[jwk]});
  if(req.url==='/token'){
   let body='';for await(const p of req)body+=p;const form=new URLSearchParams(body);
   const key=form.get('code'),record=controls.requests.get(key);
   if(!record||createHash('sha256').update(form.get('code_verifier')).digest('base64url')!==record.challenge||form.get('grant_type')!=='authorization_code'||form.get('redirect_uri')!==origin+'/auth/remilianet/callback'||form.has('client_secret'))return send({},400);
   const stamp=Math.floor(controls.now/1000),access='fixture-access-'+key;cookieSafeTokens[access]=record.user;
   const token=await new SignJWT({iss:base+'/realm',aud:'tpa-hasterrad',sub:record.user,nonce:record.nonce,iat:stamp,exp:stamp+300}).setProtectedHeader({alg:'RS256',kid:'fixture'}).sign(privateKey);
   return send({id_token:token,access_token:access,scope:controls.scope,expires_in:controls.expires,refresh_token:'fixture-refresh-unused'});
  }
  const user=cookieSafeTokens[req.headers.authorization?.slice(7)];
  if(!user||req.method!=='GET'||!req.headers.authorization.startsWith('Bearer '))return send({},401);
  if(req.url==='/api/v1/me')return send({isOwnProfile:true,user:{username:user}});
  controls.calls.push(req.url);
  if(req.url==='/api/v1/me/beetle'){
   if(controls.mode==='denied')return send({error:{code:'insufficient_scope',message:'private sentinel'}},403);
   if(controls.mode==='redirect'){res.setHeader('Location',base+'/should-not-follow');return send({},302);}
   if(controls.mode==='oversize')return send({data:{extra:'x'.repeat(100000)}});
   return send({data:{level:7,xp:1234,inventory:{cheese:0,secret:99},extra:'private sentinel'}});
  }
  if(/^\/api\/v1\/global-chat\/messages\?limit=(9|20)$/.test(req.url)){
   if(controls.mode==='hold')await new Promise(resolve=>{controls.release=resolve;});
   if(controls.mode==='denied')return send({error:{code:'insufficient_scope'}},403);
   const messages=controls.messages??[{id:1,author:{handle:'private sentinel'},text:'Synthetic signal from '+user,media:{url:'https://invalid.test/never'}},{id:2,text:'<b>literal</b> https://invalid.test'},{id:3,text:'Synthetic third transmission'}];
   return send({data:{messages}});
  }
  return send({},404);
 });
 t.after(async()=>{controls.release?.();try{await app?.close();}finally{await provider.close();if(dir)await rm(dir,{recursive:true,force:true});}});
 dir=await mkdtemp(join(tmpdir(),'hasterrad-remilia-'));
 // The app validates its complete origin before listen. Let the OS select a
 // port, then retry only an actual bind collision in the probe-to-listen gap.
 for(let attempt=0;;attempt++){
  if(requestedOrigin)origin=requestedOrigin;
  else{const probe=await fixture((_,res)=>res.writeHead(503).end());origin=probe.origin;await probe.close();}
  app=await createApp({origin,dev:true,clock:()=>controls.now,dbPath:join(dir,'auth.sqlite'),scoreDbPath:scoreDb?join(dir,'scores.sqlite'):undefined,staticDir,oidc:{issuer:provider.origin+'/realm',clientId:'tpa-hasterrad'}});
  try{await app.listen(Number(new URL(origin).port));break;}
  catch(error){await app.close();app=undefined;if(requestedOrigin||error.code!=='EADDRINUSE'||attempt>=4)throw error;}
 }
 const callbackFor=(location,user=controls.user)=>{
  const params=new URL(location).searchParams;
  assert.equal(params.get('scope'),'openid');assert.equal(params.get('code_challenge_method'),'S256');
  const code='code-'+controls.requests.size;controls.requests.set(code,{user,nonce:params.get('nonce'),challenge:params.get('code_challenge')});
  return `/auth/remilianet/callback?${new URLSearchParams({state:params.get('state'),code})}`;
 };
 const login=async(b,user)=>{
  const start=await b.get('/auth/remilianet/start');assert.equal(start.status,303);
  const result=await b.get(callbackFor(start.headers.location,user));assert.equal(result.status,303);
  b.cookie=result.cookie;const session=await b.get('/api/session');b.csrf=session.json().csrf;
  assert.equal(session.json().user.provider,'remilianet');assert.doesNotMatch(session.text+result.text,/fixture-access|fixture-refresh/);
  return session;
 };
 const read=b=>b.get(displayPath,{'x-csrf-token':b.csrf});
 return {controls,app,origin,login,read,callbackFor};
}

test('OIDC login grants gate two minimized no-store reads, with independent failure and session isolation',async t=>{
 const {controls,origin,login,read}=await setup(t);
 const a=await browser(origin),b=await browser(origin);
 assert.equal((await read(b)).status,401);
 await login(a);assert.deepEqual(controls.calls,[],'data cannot delay the callback');
 assert.equal((await a.get(displayPath,{'x-csrf-token':b.csrf})).status,403);
 const [view,concurrent]=await Promise.all([read(a),read(a)]);
 assert.equal(view.status,200);assert.equal(view.headers['cache-control'],'no-store');
 assert.deepEqual(view.json().beetle,{level:7,xp:1234,cheese:0});
 assert.deepEqual(view.json().chat[0],{id:'1',text:'Synthetic signal from pilot_a'});
 assert.equal(concurrent.text,view.text);
 assert.deepEqual(controls.calls.sort(),['/api/v1/global-chat/messages?limit=20','/api/v1/me/beetle']);
 await read(a);assert.equal(controls.calls.length,2,'repeated display reads use the cache');
 assert.doesNotMatch(view.text,/fixture-access|fixture-refresh|private sentinel|inventory|media/);
 for(const scope of [undefined,'openid remilia:directory.read remilia:stats.read','openid remilia:beetle.read.extra']){
  controls.scope=scope;await login(b,'pilot_b');assert.equal((await read(b)).status,204);
 }
 assert.equal(controls.calls.length,2);
 controls.scope='openid remilia:chat.read';controls.mode='hold';await login(b,'pilot_b');
 const pending=read(b);for(let i=0;i<100&&!controls.release;i++)await new Promise(r=>setTimeout(r,10));assert.ok(controls.release);
 const old={...b};assert.equal((await b.post('/auth/logout')).status,200);controls.release();
 assert.equal((await pending).status,401);assert.equal((await read(old)).status,401);
 controls.scope='openid remilia:beetle.read remilia:chat.read';
 for(const mode of ['denied','redirect','oversize']){
  controls.mode=mode;await login(b,'pilot_b');const data=(await read(b)).json();assert.equal(data.beetle,null);
  if(mode==='denied')assert.equal(data.chat,null);else assert.equal(data.chat[0].text,'Synthetic signal from pilot_b');
  assert.equal((await b.get('/api/session')).json().authenticated,true);
 }
 assert.ok(!controls.calls.includes('/should-not-follow'));
 controls.expires=1;controls.mode='ok';await login(b,'pilot_b');controls.now+=1001;
 assert.equal((await read(b)).status,204);assert.equal((await b.get('/api/session')).json().authenticated,true);
});

test('chat requests one documented-size page and projects only bounded unique ID/text rows',async t=>{
 const {controls,origin,login,read}=await setup(t);
 const player=await browser(origin);await login(player);
 controls.messages=Array.from({length:23},(_,i)=>({id:i+1,text:'x'.repeat(300),author:'not rendered'}));
 controls.messages[20]={id:20,text:'duplicate'};
 controls.messages[21]={id:22,text:'\u0000\u2028'};
 const view=(await read(player)).json().chat;
 assert.deepEqual(view.map(row=>row.id),[4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,23].map(String));
 assert.ok(view.every(row=>Object.keys(row).join()==='id,text'&&row.text.length===140));
 assert.deepEqual(controls.calls.filter(path=>path.includes('/global-chat/')),['/api/v1/global-chat/messages?limit=20']);
});

test('documented decimal IDs retain precision and deduplicate safe legacy numbers',async t=>{
 const {controls,origin,login,read}=await setup(t);
 const player=await browser(origin);await login(player);
 controls.messages=[{id:'58575',text:'Documented string'}, {id:58575,text:'Legacy duplicate'},
  {id:'9007199254740992',text:'Precise first'}, {id:'9007199254740993',text:'Precise second'},
  {id:9007199254740992,text:'Unsafe numeric'}, {id:'9'.repeat(33),text:'Overlong'},
  ...['0','01','1e2','12\n',' 12','-1'].map(id=>({id,text:'Not canonical decimal'})),
  {id:7,text:'Legacy only'}];
 const view=await read(player);
 assert.equal(view.status,200);
 assert.deepEqual(view.json().chat,[{id:'58575',text:'Documented string'},
  {id:'9007199254740992',text:'Precise first'}, {id:'9007199254740993',text:'Precise second'},
  {id:'7',text:'Legacy only'}]);
});
