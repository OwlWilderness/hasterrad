import http from 'node:http';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
export const scratch=()=>mkdtempSync(join(tmpdir(),'auth-fixture-'));
export const request=(origin,path,{method='GET',headers={},body}={})=>new Promise((resolve,reject)=>{
  const url=new URL(path,origin);const req=http.request(url,{method,path,headers:{connection:'close',...headers}},res=>{const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>{const text=Buffer.concat(chunks).toString();resolve({status:res.statusCode,headers:res.headers,text,json:()=>JSON.parse(text),cookie:res.headers['set-cookie']?.[0]?.split(';')[0]});});});req.on('error',reject);req.end(body);
});
export async function browser(origin){const first=await request(origin,'/api/session');return {origin,cookie:first.cookie,csrf:first.json().csrf,async get(path,headers={}){return request(origin,path,{headers:{cookie:this.cookie,...headers}});},async post(path,data={},headers={}){const response=await request(origin,path,{method:'POST',headers:{cookie:this.cookie,origin,'x-csrf-token':this.csrf,'content-type':'application/json',...headers},body:JSON.stringify(data)});if(response.cookie)this.cookie=response.cookie;return response;}};}
export async function fixture(handler){const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));return {server,origin:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(r=>server.close(r))};}
