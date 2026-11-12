import test from 'node:test';import assert from 'node:assert/strict';import {join} from 'node:path';import {readFileSync} from 'node:fs';
import {generateKeyPair,exportJWK,SignJWT,errors} from 'jose';
import {createApp} from '../../server/app.mjs';import {configFromEnv} from '../../server/main.mjs';
import {AuthError} from '../../server/store.mjs';import {diagnosticFields,markDiagnostic} from '../../server/diagnostics.mjs';
import {browser,fixture,request,scratch} from './helpers.mjs';
const allowed=['flow_lookup','flow_expiry','flow_family','flow_binding','flow_phase','callback_shape','token_shape','jwt_temporal','jwt_crypto_or_claims','jwt_missing_nonce','jwt_invalid','jwt_jws_invalid','jwt_jwk_invalid','jwt_jwks_invalid','jwt_no_matching_key','jwt_multiple_matching_keys','jwt_bad_signature','jwt_algorithm_not_allowed','jwt_not_supported','jwt_missing_iss','jwt_missing_sub','jwt_missing_aud','jwt_missing_exp','jwt_missing_iat','jwt_invalid_iat','jwt_invalid_exp','jwt_invalid_nbf','jwt_issuer_mismatch','jwt_audience_mismatch','nonce_subject','audience_party','finish_guard'];
test('allowlist is exact, unknown or forged errors emit nothing and opt-in is strict',()=>{
 const channel=readFileSync(new URL('../../server/diagnostics.mjs',import.meta.url),'utf8');
 const declared=[...channel.match(/new Set\(\[([^\]]*)\]\)/)[1].matchAll(/'([^']*)'/g)].map(x=>x[1]);
 assert.deepEqual(declared,allowed);
 for(const stage of allowed)assert.deepEqual(diagnosticFields(markDiagnostic(new Error('synthetic-secret'),stage),true),{diagnostic_stage:stage});
 for(const stage of ['unknown','',null,{},'synthetic-secret'])assert.deepEqual(diagnosticFields(markDiagnostic(new Error(),stage),true),{});
 const forged={diagnostic_stage:'flow_lookup',stage:'flow_lookup',toJSON(){throw Error('must not serialize');}};
 for(const error of [forged,new AuthError(),null,undefined,'synthetic-secret'])assert.deepEqual(diagnosticFields(error,true),{});
 for(const enabled of [false,undefined,1,'1'])assert.deepEqual(diagnosticFields(markDiagnostic(new AuthError(),'flow_lookup'),enabled),{});
 assert.equal(configFromEnv({HASTERRAD_REMILIANET_ENABLED:'1',HASTERRAD_REMILIANET_CLIENT_ID:'fixture',HASTERRAD_REMILIANET_FAILURE_DIAGNOSTICS:'1'}).oidc.failureDiagnostics,true);
 assert.equal(configFromEnv({HASTERRAD_REMILIANET_ENABLED:'1',HASTERRAD_REMILIANET_CLIENT_ID:'fixture'}).oidc.failureDiagnostics,false);
});
test('real synthetic callback stages retain rejection, binding, JWT policy and finish guards',async t=>{
 const keys=await generateKeyPair('RS256'),other=await generateKeyPair('RS256'),ed=await generateKeyPair('EdDSA');const jwk=await exportJWK(keys.publicKey);jwk.kid='fixture';jwk.alg='RS256';jwk.use='sig';const edJwk={...await exportJWK(ed.publicKey),kid:'fixture-ed',alg:'EdDSA',use:'sig'};const publicShape=[jwk,{...jwk,kid:'fixture-enc',alg:'RSA-OAEP',use:'enc'},edJwk];
 let mode='valid',nonce,now=1800000000000,exchanges=0,mutate=()=>{};
 let provider;provider=await fixture(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url==='/realm/.well-known/openid-configuration')return res.end(JSON.stringify({issuer:provider.origin+'/realm',authorization_endpoint:provider.origin+'/authorize',token_endpoint:provider.origin+'/token',jwks_uri:provider.origin+'/jwks'}));
  if(req.url==='/jwks')return res.end(JSON.stringify(mode==='jwks'?{}:{keys:mode==='multiple'?[jwk,{...jwk}]:mode==='encryption_key'?[{...jwk,use:'enc'}]:mode==='key_alg'?[{...jwk,alg:'PS256'}]:publicShape}));
  if(req.url==='/api/v1/me'){assert.equal(req.headers.authorization,'Bearer synthetic-access-token');return res.end(JSON.stringify({isOwnProfile:true,user:{username:'radbot',displayName:'Rad Bot'}}));}
  if(req.url==='/token'){
   for await(const part of req){};exchanges++;mutate();
   if(mode==='http'){res.statusCode=400;return res.end('{}');}
   if(mode==='json')return res.end('not-json');
   if(mode==='shape')return res.end('{}');
   if(mode==='malformed')return res.end(JSON.stringify({id_token:'synthetic-malformed'}));
   const seconds=Math.floor(now/1000),claims={iss:provider.origin+'/realm',aud:'fixture',sub:'synthetic-subject',nonce,iat:seconds,exp:seconds+300};
   if(mode==='issuer')claims.iss='https://synthetic.invalid';if(mode==='aud')claims.aud='other';
   if(mode==='azp'){claims.aud=['fixture','other'];claims.azp='other';}
   if(mode==='nonce')claims.nonce='other';if(mode==='subject')claims.sub='';
   if(mode==='expired')claims.exp=seconds;if(mode==='future')claims.iat=seconds+1;
   if(mode==='nbf')claims.nbf=seconds+1;if(mode==='old')claims.iat=seconds-301;
   if(mode==='missing')delete claims.nonce;
   if(mode.startsWith('missing_'))delete claims[mode.slice(8)];
   if(mode.startsWith('invalid_'))claims[mode.slice(8)]='synthetic-invalid';
   if(mode==='fraction')claims.iat=seconds-0.5;
   if(mode==='algorithm')return res.end(JSON.stringify({id_token:await new SignJWT(claims).setProtectedHeader({alg:'EdDSA',kid:'fixture-ed'}).sign(ed.privateKey),access_token:'synthetic-access-token'}));
   const token=await new SignJWT(claims).setProtectedHeader({alg:'RS256',kid:mode==='kid'?'other':'fixture'}).sign(mode==='signature'?other.privateKey:keys.privateKey);
   return res.end(JSON.stringify({id_token:token,access_token:'synthetic-access-token'}));
  }res.statusCode=404;res.end('{}');
 });t.after(()=>provider.close());
 const origin='http://127.0.0.1:18998',options={origin,dev:true,dbPath:join(scratch(),'auth.sqlite'),clock:()=>now,oidc:{issuer:provider.origin+'/realm',clientId:'fixture',failureDiagnostics:true}};
 const app=await createApp(options);await app.listen(18998);t.after(()=>app.close());
 const begin=async()=>{now+=60000;mode='valid';mutate=()=>{};const b=await browser(origin);const r=await b.get('/auth/remilianet/start');assert.equal(r.status,303);const login=new URL(r.headers.location);nonce=login.searchParams.get('nonce');return {b,state:login.searchParams.get('state'),path:'/auth/remilianet/callback?code=synthetic&state='+login.searchParams.get('state')};};
 const fail=async(f,stage,headers)=>{const r=await f.b.get(f.path,headers);assert.equal(r.status,401);assert.deepEqual(r.json(),{error:'authentication_failed',diagnostic_stage:stage});assert.equal(r.headers['cache-control'],'no-store');assert.equal(r.headers['referrer-policy'],'no-referrer');assert.equal(r.cookie,undefined);assert.equal((await f.b.get('/api/session')).json().authenticated,false);return r;};
 for(const [variant,stage] of Object.entries({shape:'token_shape',malformed:'jwt_jws_invalid',jwks:'jwt_jwks_invalid',issuer:'jwt_issuer_mismatch',aud:'jwt_audience_mismatch',signature:'jwt_bad_signature',kid:'jwt_no_matching_key',encryption_key:'jwt_no_matching_key',key_alg:'jwt_no_matching_key',multiple:'jwt_multiple_matching_keys',missing_iss:'jwt_missing_iss',missing_sub:'jwt_missing_sub',missing_aud:'jwt_missing_aud',missing_exp:'jwt_missing_exp',missing_iat:'jwt_missing_iat',invalid_iat:'jwt_invalid_iat',invalid_exp:'jwt_invalid_exp',invalid_nbf:'jwt_invalid_nbf',missing:'jwt_missing_nonce',expired:'jwt_temporal',future:'jwt_temporal',nbf:'jwt_temporal',old:'jwt_temporal',fraction:'nonce_subject',nonce:'nonce_subject',subject:'nonce_subject',azp:'audience_party'})){
  await t.test(variant,async()=>{const f=await begin();mode=variant;await fail(f,stage);await fail(f,'flow_phase');const off=await begin();mode=variant;options.oidc.failureDiagnostics=false;const r=await off.b.get(off.path);assert.equal(r.status,401);assert.deepEqual(r.json(),{error:'authentication_failed'});assert.equal(r.cookie,undefined);options.oidc.failureDiagnostics=true;});
 }
 await t.test('EdDSA signing key accepts a valid bound ID token',async()=>{const f=await begin();mode='algorithm';const r=await f.b.get(f.path);assert.equal(r.status,303);f.b.cookie=r.cookie;assert.equal((await f.b.get('/api/session')).json().authenticated,true);});
 await t.test('no cookie consumes flow without exchange',async()=>{const f=await begin(),before=exchanges;await fail(f,'flow_binding',{cookie:''});assert.equal(exchanges,before);await fail(f,'flow_phase');});
 await t.test('duplicate cookie',async()=>{const f=await begin();await fail(f,'flow_binding',{cookie:f.b.cookie+'; '+f.b.cookie});});
 await t.test('other browser binding does not consume',async()=>{const f=await begin(),thief=await browser(origin),before=exchanges;await fail(f,'flow_binding',{cookie:thief.cookie});assert.equal(exchanges,before);assert.equal((await f.b.get(f.path)).status,303);});
 await t.test('replaced flow',async()=>{const f=await begin();await f.b.get('/auth/remilianet/start');await fail(f,'flow_phase');});
 await t.test('expiry without pruning',async()=>{const f=await begin();app.store.run('UPDATE flows SET expires=?',now);await fail(f,'flow_expiry');});
 await t.test('logout generation',async()=>{const f=await begin();app.store.logout(app.store.lookup(f.b.cookie.split('=')[1]));await fail(f,'flow_family');});
 await t.test('missing flow',async()=>{const f=await begin();app.store.run('DELETE FROM flows');await fail(f,'flow_lookup');});
 await t.test('provider denied or code missing',async()=>{for(const query of ['error=access_denied','code=']){const f=await begin();f.path='/auth/remilianet/callback?'+query+'&state='+f.state;await fail(f,'callback_shape');}});
 await t.test('finish logout race',async()=>{const f=await begin();mutate=()=>app.store.logout(app.store.lookup(f.b.cookie.split('=')[1]));await fail(f,'finish_guard');});
 await t.test('finish session expiry',async()=>{const f=await begin();mutate=()=>app.store.run('UPDATE sessions SET idle=?',now);await fail(f,'finish_guard');});
 for(const [Type,stage] of [[errors.JWTInvalid,'jwt_invalid'],[errors.JWKInvalid,'jwt_jwk_invalid'],[errors.JOSENotSupported,'jwt_not_supported']])await t.test('known library class '+stage,async()=>{const f=await begin(),original=app.store.clock;mutate=()=>{app.store.clock=()=>{app.store.clock=original;throw new Type('synthetic-secret');};};await fail(f,stage);});
 for(const [claim,reason] of [['synthetic-secret','missing'],['nonce','synthetic-secret']])await t.test('unknown claim/reason emits no stage '+claim,async()=>{const f=await begin(),original=app.store.clock;mutate=()=>{app.store.clock=()=>{app.store.clock=original;throw new errors.JWTClaimValidationFailed('synthetic-secret',{private:'synthetic-secret'},claim,reason);};};const r=await f.b.get(f.path);assert.deepEqual(r.json(),{error:'authentication_failed'});});
 await t.test('classifier never reads exception payload message stack or header',async()=>{const f=await begin(),original=app.store.clock;mutate=()=>{app.store.clock=()=>{app.store.clock=original;const e=new errors.JWTClaimValidationFailed('synthetic-secret',{},'nonce','missing');for(const name of ['payload','message','stack','protectedHeader'])Object.defineProperty(e,name,{get(){throw Error('forbidden read');}});throw e;};};await fail(f,'jwt_missing_nonce');});
 await t.test('unknown subclass remains generic',async()=>{const f=await begin(),original=app.store.clock;mutate=()=>{app.store.clock=()=>{app.store.clock=original;throw new(class extends errors.JOSEAlgNotAllowed {})('synthetic-secret');};};assert.deepEqual((await f.b.get(f.path)).json(),{error:'authentication_failed'});});
 await t.test('unknown JOSE error type emits no stage',async()=>{const f=await begin();const original=app.store.clock;mutate=()=>{app.store.clock=()=>{app.store.clock=original;throw new errors.JOSEError('synthetic-secret');};};const r=await f.b.get(f.path);assert.equal(r.status,401);assert.deepEqual(r.json(),{error:'authentication_failed'});});
 await t.test('unknown error inside JWT try emits no stage',async()=>{const f=await begin();const original=app.store.clock;mutate=()=>{app.store.clock=()=>{app.store.clock=original;throw new Error('synthetic-secret');};};const r=await f.b.get(f.path);assert.equal(r.status,401);assert.deepEqual(r.json(),{error:'authentication_failed'});});
 await t.test('unknown DB failure is not a classified guard',async()=>{const f=await begin(),original=app.store.finish;app.store.finish=()=>{throw new Error('synthetic-secret');};const r=await f.b.get(f.path);app.store.finish=original;assert.equal(r.status,500);assert.deepEqual(r.json(),{error:'internal_error'});});
 await t.test('unbranded authentication failure remains generic',async()=>{const f=await begin(),original=app.store.finish;app.store.finish=()=>{const e=new AuthError();e.diagnostic_stage='finish_guard';throw e;};const r=await f.b.get(f.path);app.store.finish=original;assert.deepEqual(r.json(),{error:'authentication_failed'});});
 await t.test('provider HTTP and JSON errors stay distinct',async()=>{for(const [variant,error] of [['http','provider_failed'],['json','provider_invalid_response']]){const f=await begin();mode=variant;assert.deepEqual((await f.b.get(f.path)).json(),{error});}});
 await t.test('disabled, invalid callback, unrelated route and successful login omit diagnostics',async()=>{
  const f=await begin();assert.deepEqual((await f.b.get(f.path+'&state=duplicate')).json(),{error:'invalid_callback'});
  options.oidc.failureDiagnostics=false;mode='nonce';assert.deepEqual((await f.b.get(f.path)).json(),{error:'authentication_failed'});options.oidc.failureDiagnostics=true;
  assert.deepEqual((await f.b.get('/not-found')).json(),{error:'not_found'});
  const good=await begin();const r=await good.b.get(good.path);assert.equal(r.status,303);good.b.cookie=r.cookie;assert.equal((await good.b.get('/api/session')).json().authenticated,true);
 });
});
