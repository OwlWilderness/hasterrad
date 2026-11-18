import {createLocalJWKSet,jwtVerify,errors} from 'jose';import {createHash} from 'node:crypto';
import {markDiagnostic} from './diagnostics.mjs';
import {random,requireAuth,AuthError} from './store.mjs';import {trustedRequest,providerJson,redirect} from './network.mjs';import {validateOrigin} from './app.mjs';
const REMILIA='https://www.remilia.net/oidc/realms/remilia';
const jwtErrorStages=new Map([
 [errors.JWTInvalid,'jwt_invalid'],[errors.JWSInvalid,'jwt_jws_invalid'],
 [errors.JWKInvalid,'jwt_jwk_invalid'],[errors.JWKSInvalid,'jwt_jwks_invalid'],
 [errors.JWKSNoMatchingKey,'jwt_no_matching_key'],[errors.JWKSMultipleMatchingKeys,'jwt_multiple_matching_keys'],
 [errors.JWSSignatureVerificationFailed,'jwt_bad_signature'],[errors.JOSEAlgNotAllowed,'jwt_algorithm_not_allowed'],
 [errors.JOSENotSupported,'jwt_not_supported'],[errors.JWTExpired,'jwt_temporal']
]);
const missingClaimStages=new Map([['iss','jwt_missing_iss'],['sub','jwt_missing_sub'],['aud','jwt_missing_aud'],['exp','jwt_missing_exp'],['iat','jwt_missing_iat'],['nonce','jwt_missing_nonce']]);
const invalidClaimStages=new Map([['iat','jwt_invalid_iat'],['exp','jwt_invalid_exp'],['nbf','jwt_invalid_nbf']]);
function jwtFailureStage(error){
 if(error?.constructor!==errors.JWTClaimValidationFailed)return jwtErrorStages.get(error?.constructor);
 if(error.reason==='missing')return missingClaimStages.get(error.claim);
 if(error.reason==='invalid')return invalidClaimStages.get(error.claim);
 if(error.reason==='check_failed'){
  if(error.claim==='iss')return 'jwt_issuer_mismatch';
  if(error.claim==='aud')return 'jwt_audience_mismatch';
  if(['iat','exp','nbf'].includes(error.claim))return 'jwt_temporal';
 }
 // Unrecognized classes, subclasses, claim names and reasons remain generic.
}
export async function oidcHandler(ctx){
 const {options,origin,dev,store,providers,cookie}=ctx;const config=options.oidc;const issuer=config.issuer??REMILIA;const issuerUrl=new URL(issuer);validateOrigin(issuerUrl.origin,dev);requireAuth(!issuerUrl.search&&!issuerUrl.hash&&!issuerUrl.username&&!issuerUrl.password&&!issuer.endsWith('/'),500,'invalid_oidc_issuer');
 requireAuth(issuer===REMILIA||(dev&&issuerUrl.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(issuerUrl.hostname)),500,'untrusted_oidc_issuer');
 requireAuth(typeof config.clientId==='string'&&/^[a-zA-Z0-9._-]{1,128}$/.test(config.clientId),500,'invalid_oidc_client');
 const callback=origin+'/auth/remilianet/callback';
 const metadata=async()=>{const data=providerJson(await trustedRequest(issuer+'/.well-known/openid-configuration'));requireAuth(data.issuer===issuer,502,'untrusted_oidc_metadata');for(const key of ['authorization_endpoint','token_endpoint','jwks_uri']){const url=new URL(data[key]);requireAuth(url.origin===issuerUrl.origin&&!url.username&&!url.password&&!url.hash&&!url.search,502,'untrusted_oidc_metadata');}return data;};
 providers.remilianet=true;
 return async({req,res,url,row,token})=>{
  if(req.method!=='GET')return false;
  if(url.pathname==='/auth/remilianet/start'){
   const binding=store.bootstrap(token);if(binding.token)cookie(res,binding.token);store.rate('oidc:'+binding.row.family,10);
   const discovery=await metadata(),verifier=random(),nonce=random();const flow=store.issue('oidc',binding.row,{verifier,nonce});
   const login=new URL(discovery.authorization_endpoint);for(const [key,value] of Object.entries({client_id:config.clientId,redirect_uri:callback,response_type:'code',scope:'openid',state:flow.secret,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}))login.searchParams.set(key,value);
   redirect(res,login.href);return true;
  }
  if(url.pathname==='/auth/remilianet/callback'){
   requireAuth(url.searchParams.getAll('state').length===1&&url.searchParams.getAll('code').length<=1&&url.searchParams.getAll('error').length<=1,400,'invalid_callback');
   const flow=store.claim(url.searchParams.get('state'),'oidc',row);store.bound(flow,row);
   requireAuth(!url.searchParams.has('error')&&typeof url.searchParams.get('code')==='string'&&url.searchParams.get('code').length>0&&url.searchParams.get('code').length<=4096,401,'authentication_failed','callback_shape');
   const discovery=await metadata();const form=new URLSearchParams({grant_type:'authorization_code',code:url.searchParams.get('code'),client_id:config.clientId,redirect_uri:callback,code_verifier:flow.data.verifier});
   const tokens=providerJson(await trustedRequest(discovery.token_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:form.toString()}));
   requireAuth(typeof tokens.id_token==='string'&&tokens.id_token.length<=32768,401,'authentication_failed','token_shape');
   const jwks=providerJson(await trustedRequest(discovery.jwks_uri));
   let payload;
   try{({payload}=await jwtVerify(tokens.id_token,createLocalJWKSet(jwks),{issuer,audience:config.clientId,algorithms:['RS256','EdDSA'],requiredClaims:['iss','sub','aud','exp','iat','nonce'],currentDate:new Date(store.clock()),clockTolerance:0,maxTokenAge:'5m'}));}catch(error){
    // Read only exact library type and allowlisted claim/reason; never payload/header/message/stack.
    const failure=new AuthError();
    markDiagnostic(failure,jwtFailureStage(error));
    throw failure;
   }
   const now=Math.floor(store.clock()/1000);requireAuth(payload.nonce===flow.data.nonce&&typeof payload.sub==='string'&&payload.sub.length>0&&payload.sub.length<=512&&Number.isInteger(payload.iat)&&payload.iat<=now+30&&Number.isInteger(payload.exp)&&payload.exp>now,401,'authentication_failed','nonce_subject');
   requireAuth((!Array.isArray(payload.aud)||payload.aud.length===1||payload.azp===config.clientId)&&(!payload.azp||payload.azp===config.clientId),401,'authentication_failed','audience_party');
   requireAuth(typeof tokens.access_token==='string'&&tokens.access_token.length>0&&tokens.access_token.length<=16384&&!/[\r\n]/.test(tokens.access_token),401,'authentication_failed','token_shape');
   const profile=providerJson(await trustedRequest(issuerUrl.origin+'/api/v1/me',{headers:{Authorization:'Bearer '+tokens.access_token},maxBytes:262144,timeout:8000}));
   requireAuth(profile?.isOwnProfile===true&&typeof profile.user?.username==='string'&&/^[a-zA-Z0-9_.-]{1,64}$/.test(profile.user.username),502,'provider_invalid_response');
   const user={provider:'remilianet',id:issuer+'#'+payload.sub,displayName:'~'+profile.user.username};
   const session=store.finish(flow,user);cookie(res,session.token);redirect(res,'/auth/done');return true;
  }
  return false;
 };
}
