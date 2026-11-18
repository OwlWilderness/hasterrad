import http from 'node:http';
import {diagnosticFields} from './diagnostics.mjs';
import {timingSafeEqual} from 'node:crypto';
import {Store,AuthError,requireAuth} from './store.mjs';
const loopback = host => ['127.0.0.1','localhost','[::1]'].includes(host);
export function validateOrigin(value,dev=false){const url=new URL(value);requireAuth(url.origin===value&&!url.username&&!url.password&&(url.protocol==='https:'||(dev&&url.protocol==='http:'&&loopback(url.hostname))),500,'invalid_configuration');return url;}
export async function createApp(options={}) {
  const origin=options.origin??'https://hasterrad.quantumtekh.com',dev=options.dev===true;
  const publicUrl=validateOrigin(origin,dev);requireAuth(!dev||loopback(publicUrl.hostname),500,'dev_requires_loopback_origin');const cookieName=dev?'hasterrad_dev_session':'__Host-hasterrad_session';
  const burnerWalletMode=options.burnerWalletMode??'disabled';requireAuth(['disabled','localNetworksOnly','allNetworks'].includes(burnerWalletMode),500,'invalid_burner_wallet_mode');
  const store=new Store(options.dbPath??'private/auth.sqlite',options.clock);
  const providers={urbit:false,remilianet:false,wallet:false};
  const wallet={chainId:1,projectId:null,rpcUrl:null,burnerWalletMode};
  const cookie=(res,token)=>res.setHeader('Set-Cookie',`${cookieName}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${dev?'':'; Secure'}`);
  const shape=row=>({authenticated:!!row.user,csrf:row.csrf,user:row.user?JSON.parse(row.user):null,providers:{...providers},wallet:{...wallet},...(row.user?{expiresAt:new Date(row.expires).toISOString()}: {})});
  const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  const readCookie=req=>{const pairs=(req.headers.cookie??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(cookieName+'='));return pairs.length===1?pairs[0].slice(cookieName.length+1):undefined;};
  const csrf=(req,row)=>{requireAuth(req.headers.origin===origin&&row&&row.expires>store.clock(),403,'csrf_failed');const value=req.headers['x-csrf-token'];requireAuth(typeof value==='string'&&Buffer.byteLength(value)===Buffer.byteLength(row.csrf)&&timingSafeEqual(Buffer.from(value),Buffer.from(row.csrf)),403,'csrf_failed');};
  const body=async req=>{requireAuth(/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']??''),415,'json_required');let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;requireAuth(bytes<=16384,413,'body_too_large');chunks.push(chunk);}try{const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));requireAuth(data&&typeof data==='object'&&!Array.isArray(data),400,'invalid_body');return data;}catch(error){if(error instanceof AuthError)throw error;throw new AuthError(400,'invalid_body');}};
  const exact=(data,keys)=>requireAuth(Object.keys(data).sort().join(',')===[...keys].sort().join(','),400,'invalid_body');
  const handlers=[];let lastPrune=0;
  const context={origin,publicUrl,dev,store,providers,wallet,cookie,shape,json,csrf,body,exact,options};
  if(options.urbit) {const {urbitHandler}=await import('./urbit.mjs');handlers.push(await urbitHandler(context));}
  if(options.oidc) {const {oidcHandler}=await import('./oidc.mjs');handlers.push(await oidcHandler(context));}
  if(options.wallet) {const {walletHandler}=await import('./wallet.mjs');handlers.push(await walletHandler(context));}
  if(options.staticDir) {const {staticHandler}=await import('./static.mjs');handlers.push(staticHandler(options.staticDir,{connectOrigins:options.connectOrigins,inlineStyles:options.inlineStyles}));}
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
    try {
      requireAuth(req.url.startsWith('/')&&!req.url.startsWith('//'),400,'invalid_path');
      const url=new URL(req.url,origin);requireAuth(req.url.split('?')[0]===url.pathname,400,'noncanonical_path');
      // Never use X-Forwarded-* to establish authority. Exact ingress Host required.
      const shipCallback=url.pathname==='/hasterrad-auth'&&providers.urbit;
      requireAuth(req.headers.host===(shipCallback?new URL(options.urbit.publicOrigin).host:publicUrl.host),421,'misdirected_request');
      requireAuth(!req.headers['x-forwarded-host']&&!req.headers['x-forwarded-proto'],421,'untrusted_forwarded_headers');
      if(store.clock()-lastPrune>=60000){store.prune();lastPrune=store.clock();}
      store.rate('ip:'+req.socket.remoteAddress,300);
      const token=readCookie(req),row=store.lookup(token);
      const state={req,res,url,row,token};
      if(req.method==='GET'&&['/api/session','/api/wallet/session'].includes(url.pathname)) {
        if(store.valid(row)&&row.user&&JSON.parse(row.user).provider==='ethereum'){
          if(context.checkWalletSession)await context.checkWalletSession(row);
          else store.run('UPDATE sessions SET revoked=1 WHERE id=?',row.id);
        }
        const session=store.bootstrap(token);if(session.token)cookie(res,session.token);return json(res,200,shape(session.row));}
      if((req.method==='POST'&&url.pathname==='/auth/logout')||(req.method==='DELETE'&&url.pathname==='/api/wallet/session')) {csrf(req,row);const data=await body(req);exact(data,[]);const session=store.logout(row);cookie(res,session.token);return json(res,200,shape(session.row));}
      for(const handler of handlers)if(await handler(state))return;
      if(req.method==='GET'&&url.pathname==='/auth/done'){res.writeHead(303,{Location:'/'});return res.end();}
      if(req.method==='GET'&&/^\/auth\/(urbit|remilianet)\/start$/.test(url.pathname))throw new AuthError(503,'provider_unavailable');
      throw new AuthError(404,'not_found');
    }catch(error){if(!res.headersSent)json(res,error instanceof AuthError?error.status:500,{error:error instanceof AuthError?error.code:'internal_error',...diagnosticFields(error,options.oidc?.failureDiagnostics===true&&req.method==='GET'&&req.url.split('?')[0]==='/auth/remilianet/callback'&&error instanceof AuthError&&error.status===401&&error.code==='authentication_failed')});else res.destroy();}
  });
  server.requestTimeout=10000;server.headersTimeout=10000;server.maxHeadersCount=50;
  let closed=false;
  return {store,server,context,listen:(port=0,host='127.0.0.1')=>new Promise((resolve,reject)=>{requireAuth(!dev||loopback(host),500,'dev_must_bind_loopback');server.once('error',reject);server.listen(port,host,()=>{server.removeListener('error',reject);resolve(server.address());});}),close:()=>new Promise((resolve,reject)=>{if(closed)return resolve();closed=true;server.close(error=>{store.close();if(error&&error.code!=='ERR_SERVER_NOT_RUNNING')reject(error);else resolve();});server.closeIdleConnections();})};
}
