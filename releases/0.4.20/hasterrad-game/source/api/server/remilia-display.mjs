import {requireAuth} from './store.mjs';
import {providerJson,trustedRequest} from './network.mjs';

const integer=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const beetle=({data}={})=>{
 const fields={level:integer(data?.level),xp:integer(data?.xp),cheese:integer(data?.inventory?.cheese)};
 return Object.values(fields).some(value=>value!==null)?fields:null;
};
const CHAT_PAGE=20; // The documented default; one page, no pagination.
// Opaque decimal strings: never round through Number. Accept old safe numeric IDs.
const chatId=value=>{
 if(Number.isSafeInteger(value)&&value>0)return String(value);
 return typeof value==='string'&&value.length>0&&value.length<=32&&value[0]!=='0'&&!/[^0-9]/.test(value)?value:null;
};
const chat=({data}={})=>{
 if(!Array.isArray(data?.messages))return null;
 const lines=new Map();
 for(const message of data.messages.slice(-CHAT_PAGE)){
  const id=chatId(message?.id);
  if(id===null||typeof message.text!=='string'||lines.has(id))continue;
  const text=message.text.slice(0,320).replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu,' ').trim().slice(0,140);
  if(text)lines.set(id,{id,text});
 }
 return [...lines.values()];
};
const features=[
 ['beetle','remilia:beetle.read','/api/v1/me/beetle',60000,beetle],
 ['chat','remilia:chat.read',`/api/v1/global-chat/messages?limit=${CHAT_PAGE}`,30000,chat],
];
const MAX_AGE=30*60*1000,MAX_SESSIONS=256;

export function createRemiliaDisplay({store,json,bindSession},origin){
 const sessions=new Map();
 const clear=(id,entry)=>{
  clearTimeout(entry.timer);sessions.delete(id);entry.abort.abort();entry.bearer=null;
 };
 store.onSessionEnd=(id,family)=>{
  for(const [key,entry] of sessions)if(key===id||entry.family===family||(!id&&!family))clear(key,entry);
 };
 return {
  remember(row,tokens,issuedAt){
   // The existing JOSE verifier validates the ID token, not access-token grants.
   // Absent issued scope or lifetime: leave the optional modules off.
   if(typeof tokens.scope!=='string'||tokens.scope.length>4096||!Number.isSafeInteger(tokens.expires_in)||tokens.expires_in<1)return;
   const scopes=new Set(tokens.scope.split(/\s+/));
   const reads=new Map(features.filter(([,scope])=>scopes.has(scope)).map(spec=>[spec[0],{spec}]));
   const expires=Math.min(row.expires,issuedAt+Math.min(MAX_AGE,tokens.expires_in*1000));
   const remaining=expires-store.clock();
   if(!reads.size||remaining<=0)return;
   if(sessions.size>=MAX_SESSIONS){const [key,entry]=sessions.entries().next().value;clear(key,entry);}
   const entry={family:row.family,expires,reads,bearer:tokens.access_token,abort:new AbortController()};
   entry.timer=setTimeout(()=>clear(row.id,entry),remaining);entry.timer.unref();
   sessions.set(row.id,entry);
  },
  async handle({req,res,url,row,token}){
   requireAuth(!url.search,400,'invalid_query');
   requireAuth(store.valid(row)&&row.user,401,'login_required');
   requireAuth(JSON.parse(row.user).provider==='remilianet',403,'remilia_required');
   bindSession(req,row);
   const entry=sessions.get(row.id);
   if(!entry||entry.expires<=store.clock()||!entry.reads.size){
    if(entry)clear(row.id,entry);
    res.writeHead(204).end();return;
   }
   const read=state=>{
    if(state.pending)return state.pending;
    if(state.next>store.clock())return state.value;
    const [name,,path,interval,project]=state.spec;
    state.next=store.clock()+interval;
    state.pending=(async()=>{
     try{
      const response=await trustedRequest(origin+path,{headers:{Authorization:'Bearer '+entry.bearer,Accept:'application/json'},timeout:2000,maxBytes:32768,signal:entry.abort.signal});
      if([401,403].includes(response.status))entry.reads.delete(name);
      return state.value=project(providerJson(response));
     }catch{return state.value=null;}
     finally{state.pending=null;}
    })();
    return state.pending;
   };
   const [beetleState,chatLines]=await Promise.all(['beetle','chat'].map(name=>entry.reads.has(name)?read(entry.reads.get(name)):null));
   requireAuth(store.valid(store.lookup(token)),401,'login_required');
   const validForMs=entry.expires-store.clock();
   if(sessions.get(row.id)!==entry||validForMs<=0){res.writeHead(204).end();return;}
   json(res,200,{beetle:beetleState,chat:chatLines,validForMs});
  },
 };
}
