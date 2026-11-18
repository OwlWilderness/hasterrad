import {readFileSync,realpathSync} from 'node:fs';import {resolve,sep,extname} from 'node:path';import {createHash} from 'node:crypto';import {requireAuth} from './store.mjs';
export function staticHandler(directory,{connectOrigins=[],inlineStyles=false}={}){
 const root=realpathSync(directory),manifest=JSON.parse(readFileSync(resolve(root,'artifact.json'),'utf8'));const payload=new Map();
 const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.txt':'text/plain; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
 requireAuth(manifest.files&&typeof manifest.files==='object',500,'invalid_static_manifest');
 for(const [name,digest] of Object.entries(manifest.files)){
  requireAuth(/^[a-zA-Z0-9_./-]+$/.test(name)&&name.split('/').every(x=>x&&!x.startsWith('.'))&&mime[extname(name)]&&/^[a-f0-9]{64}$/.test(digest),500,'invalid_static_manifest');
  const path=realpathSync(resolve(root,name));requireAuth(path.startsWith(root+sep),500,'invalid_static_path');const bytes=readFileSync(path);requireAuth(createHash('sha256').update(bytes).digest('hex')===digest,500,'static_hash_mismatch');payload.set('/'+name,{bytes,type:mime[extname(name)]});
 }
 for(const value of connectOrigins){const url=new URL(value);requireAuth(['https:','wss:'].includes(url.protocol)&&url.origin===value&&!url.username&&!url.password,500,'invalid_connect_origin');}
 const csp=`default-src 'none'; script-src 'self'; style-src 'self'${inlineStyles?" 'unsafe-inline'":''}; img-src 'self' data:; font-src 'self'; connect-src 'self'${connectOrigins.length?' '+connectOrigins.join(' '):''}; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'`;
 return ({req,res,url})=>{if(!['GET','HEAD'].includes(req.method))return false;const item=payload.get(url.pathname==='/'?'/index.html':url.pathname);if(!item)return false;res.setHeader('Content-Security-Policy',csp);res.writeHead(200,{'Content-Type':item.type});res.end(req.method==='HEAD'?undefined:item.bytes);return true;};
}
