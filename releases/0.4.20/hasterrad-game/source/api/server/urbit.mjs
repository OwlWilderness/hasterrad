import {validateOrigin} from './app.mjs';import {requireAuth} from './store.mjs';import {trustedRequest,redirect} from './network.mjs';
const shipPattern=/^~(?:[a-z]{3}|[a-z]{6}(?:-[a-z]{6}){0,7})$/;
export async function urbitHandler(ctx){
 const {store,options,providers,origin,dev,cookie}=ctx;const config=options.urbit;
 const publicUrl=validateOrigin(config.publicOrigin,false),verifier=validateOrigin(config.verifierOrigin,dev);
 requireAuth(shipPattern.test(config.ship),500,'invalid_urbit_ship');
 // Both origins and host ship are operator-pinned as one relying-party ship.
 const nativeCookie=`urbauth-${config.ship}`;providers.urbit=true;
 return async({req,res,url,row,token})=>{
  if(req.method!=='GET')return false;
  if(url.pathname==='/auth/urbit/start'){
   const binding=store.bootstrap(token);if(binding.token)cookie(res,binding.token);store.rate('urbit:'+binding.row.family,10);
   const flow=store.issue('urbit',binding.row);const login=new URL('/~/login',publicUrl);login.searchParams.set('eauth','');login.searchParams.set('redirect','/hasterrad-auth?state='+flow.secret);redirect(res,login.href);return true;
  }
  if(url.pathname==='/hasterrad-auth'){
   requireAuth([...url.searchParams.keys()].join(',')==='state',400,'invalid_callback');
   const flow=store.claim(url.searchParams.get('state'),'urbit');
   const cookies=(req.headers.cookie??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(nativeCookie+'='));
   requireAuth(cookies.length===1&&new RegExp('^'+nativeCookie.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'=[a-zA-Z0-9._~-]{1,4096}$').test(cookies[0]));
   const response=await trustedRequest(new URL('/~/name',verifier),{headers:{Host:publicUrl.host,Cookie:cookies[0],Accept:'text/plain'},maxBytes:1024,timeout:config.timeout??4000});
   requireAuth(response.status===200&&(response.headers['content-type']??'').startsWith('text/plain'));
   const ship=response.text.trim();requireAuth(shipPattern.test(ship));
   const code=store.completion(flow,{provider:'urbit',id:ship,displayName:ship});redirect(res,origin+'/auth/urbit/complete?code='+code);return true;
  }
  if(url.pathname==='/auth/urbit/complete'){
   requireAuth([...url.searchParams.keys()].join(',')==='code',400,'invalid_callback');
   const flow=store.flow(url.searchParams.get('code'),'urbit');store.bound(flow,row);requireAuth(flow.phase==='completion');
   const session=store.finish(flow,flow.data.user);cookie(res,session.token);redirect(res,'/auth/done');return true;
  }
  return false;
 };
}
