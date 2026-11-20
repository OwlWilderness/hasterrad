import test from 'node:test';import assert from 'node:assert/strict';import {join} from 'node:path';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {createHash} from 'node:crypto';
import {createApp} from '../../server/app.mjs';import {browser,fixture,request,scratch} from './helpers.mjs';
test('OIDC real signed JWT and S256 PKCE browser binding; bad issuer/aud/azp/nonce/key/time and callback replay fail closed',async t=>{
 const keys=await generateKeyPair('RS256'),other=await generateKeyPair('RS256');const jwk=await exportJWK(keys.publicKey);jwk.kid='fixture';jwk.alg='RS256';
 let mode='valid',nonce,challenge,exchanges=0;let provider;
 provider=await fixture(async(req,res)=>{
  res.setHeader('content-type','application/json');
  if(req.url==='/realm/.well-known/openid-configuration')return res.end(JSON.stringify({issuer:provider.origin+'/realm',authorization_endpoint:provider.origin+'/authorize',token_endpoint:provider.origin+'/token',jwks_uri:provider.origin+'/jwks'}));
  if(req.url==='/jwks')return res.end(JSON.stringify({keys:[jwk]}));
  if(req.url==='/api/v1/me') {assert.equal(req.headers.authorization,'Bearer synthetic-access-token');if(mode==='profile_down'){res.statusCode=503;return res.end('{}');}if(mode==='profile_invalid')return res.end(JSON.stringify({isOwnProfile:true,user:{username:'<script>'}}));return res.end(JSON.stringify({isOwnProfile:true,user:{username:'radbot',displayName:'Rad Bot'}}));}
  if(req.url==='/token') {let body='';for await(const part of req)body+=part;exchanges++;const fields=new URLSearchParams(body);assert.equal(fields.get('redirect_uri'),'http://127.0.0.1:18993/auth/remilianet/callback');assert.equal(fields.get('client_id'),'fixture-client');assert.equal(fields.get('grant_type'),'authorization_code');assert.equal(createHash('sha256').update(fields.get('code_verifier')).digest('base64url'),challenge);
   const now=Math.floor(Date.now()/1000);let claims={iss:provider.origin+'/realm',aud:'fixture-client',sub:'immutable-subject',nonce,iat:now,exp:now+300};
   if(mode==='issuer')claims.iss='https://attacker.invalid';if(mode==='aud')claims.aud='other';if(mode==='azp'){claims.aud=['fixture-client','other'];claims.azp='other';}if(mode==='nonce')claims.nonce='wrong';if(mode==='expiry')claims.exp=now-60;if(mode==='future')claims.iat=now+100;
   const token=await new SignJWT(claims).setProtectedHeader({alg:'RS256',kid:mode==='kid'?'unknown':'fixture'}).sign(mode==='signature'?other.privateKey:keys.privateKey);return res.end(JSON.stringify({id_token:token,access_token:'synthetic-access-token'}));
  }res.statusCode=404;res.end('{}');
 });t.after(()=>provider.close());
 const origin='http://127.0.0.1:18993',app=await createApp({origin,dev:true,dbPath:join(scratch(),'auth.sqlite'),oidc:{issuer:provider.origin+'/realm',clientId:'fixture-client'}});await app.listen(18993);t.after(()=>app.close());
 const begin=async b=>{const response=await b.get('/auth/remilianet/start');assert.equal(response.status,303,response.text);const login=new URL(response.headers.location);assert.equal(login.searchParams.get('code_challenge_method'),'S256');assert.equal(login.searchParams.get('scope'),'openid');nonce=login.searchParams.get('nonce');challenge=login.searchParams.get('code_challenge');return '/auth/remilianet/callback?code=fixture-code&state='+login.searchParams.get('state');};
 const normal=await browser(origin),thief=await browser(origin);let callback=await begin(normal);
 assert.equal((await thief.get(callback)).status,401);assert.equal(exchanges,0);
 let success=await normal.get(callback);assert.equal(success.status,303,success.text);normal.cookie=success.cookie;
 const session=(await normal.get('/api/session')).json();assert.equal(session.user.provider,'remilianet');assert.ok(session.user.id.includes('immutable-subject'));assert.equal(session.user.displayName,'~radbot');assert.equal(JSON.stringify(session).includes('synthetic-access-token'),false);assert.equal((await normal.get(callback)).status,401);assert.equal(exchanges,1);
 for(mode of ['issuer','aud','azp','nonce','expiry','future','signature','kid']) {const b=await browser(origin);callback=await begin(b);const bad=await b.get(callback);assert.equal(bad.status,401,mode+': '+bad.text);assert.equal((await b.get('/api/session')).json().authenticated,false,mode);assert.equal((await b.get(callback)).status,401);}
 for(mode of ['profile_down','profile_invalid']){const b=await browser(origin);callback=await begin(b);const bad=await b.get(callback);assert.equal(bad.status,502);assert.equal((await b.get('/api/session')).json().authenticated,false);}
 const b=await browser(origin);mode='valid';callback=await begin(b);const denied=callback.replace('code=fixture-code','error=access_denied');assert.equal((await b.get(denied)).status,401);assert.equal((await b.get(callback)).status,401);
});
