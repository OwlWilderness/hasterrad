import http from 'node:http';import https from 'node:https';
import {requireAuth,AuthError} from './store.mjs';
// Native request: no redirect following, ambient proxy or cookie jar. Bounded body/time.
export function trustedRequest(url,{method='GET',headers={},body,maxBytes=65536,timeout=4000}={}){
 return new Promise((resolve,reject)=>{
  const target=new URL(url);const req=(target.protocol==='https:'?https:http).request(target,{method,headers,...(target.protocol==='https:'?{servername:target.hostname}:{})},res=>{
   const chunks=[];let bytes=0;res.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes){res.destroy(new AuthError(502,'provider_response_too_large'));return;}chunks.push(chunk);});res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString('utf8')}));
  });
  const timer=setTimeout(()=>req.destroy(new AuthError(502,'provider_timeout')),timeout);timer.unref();req.on('close',()=>clearTimeout(timer));req.on('error',reject);req.end(body);
 });
}
export function providerJson(response){requireAuth(response.status===200,502,'provider_failed');try{return JSON.parse(response.text);}catch{throw new AuthError(502,'provider_invalid_response');}}
export function redirect(res,url){res.writeHead(303,{Location:url});res.end();}
