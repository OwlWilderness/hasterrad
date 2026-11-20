const PAGE=20,SEEN_LIMIT=128;
const BURST_SIZES=[3,2,4,2,4,3];
// A drop takes 30s (see CSS). Gaps over half a drop allow two desktop
// groups per lane, and a full drop between narrow entries allows only one.
const GAPS=[15800,17400,16000,17900,16100,17100], NARROW_GAP=31000;

// Normalize only safe legacy numbers; retain provider string IDs exactly.
const chatId=value=>{
 if(Number.isSafeInteger(value)&&value>0)return String(value);
 return typeof value==='string'&&value.length>0&&value.length<=32&&value[0]!=='0'&&!/[^0-9]/.test(value)?value:null;
};

function chatStream(doc,win,chat){
 const narrow=win.matchMedia('(max-width: 700px), (max-height: 540px)');
 const still=win.matchMedia('(prefers-reduced-motion: reduce)');
 const seen=new Set();
 let pending=[],latest=[],burst=0,nextEntry=0;
 const wipe=()=>{
  burst=0;nextEntry=0;chat.replaceChildren();chat.hidden=true;
 };
 const makeCluster=(column,rows)=>{
  const node=doc.createElement('div');node.dataset.column=column;
  for(const {id,text} of rows){
   const row=doc.createElement('span');row.dataset.messageId=id;row.textContent=text;node.append(row);
  }
  return node;
 };
 const drain=()=>{
  const now=win.performance.now(),compact=narrow.matches,capacity=compact?3:6;
  while(pending.length&&chat.childElementCount<capacity){
   const start=Math.max(now,nextEntry);
   const size=compact?1:BURST_SIZES[burst%BURST_SIZES.length];
   const node=makeCluster(2,pending.splice(0,size));
   node.style.setProperty('--entry-delay',`${start-now}ms`);
   nextEntry=start+(compact?NARROW_GAP:GAPS[burst++%GAPS.length]);
   node.addEventListener('animationend',event=>{
    if(event.animationName!=='remilia-fall'||node.parentNode!==chat)return;
    node.remove();drain();
   });
   chat.append(node);
  }
  chat.hidden=!chat.childElementCount;
 };
 const renderStatic=()=>{
  const rows=latest.slice(-3);
  if(rows.length!==chat.childElementCount||rows.some(({id,text},i)=>{
   const row=chat.children[i]?.firstElementChild;
   return row?.dataset.messageId!==id||row.textContent!==text;
  }))chat.replaceChildren(...rows.map((row,i)=>makeCluster(i,[row])));
  chat.hidden=!rows.length;
 };
 const modeChange=()=>{
  pending=[];wipe();
  if(still.matches)renderStatic();
 };
 narrow.addEventListener('change',modeChange);still.addEventListener('change',modeChange);
 return {
  dispose(){narrow.removeEventListener('change',modeChange);still.removeEventListener('change',modeChange);},
  hide(){pending=[];latest=[];wipe();},
  reset(){seen.clear();this.hide();},
  receive(data){
   const page=new Map();
   for(const row of Array.isArray(data)?data.slice(-PAGE):[]){
    const id=chatId(row?.id);
    if(id!==null&&typeof row.text==='string'&&row.text.length>0&&row.text.length<=140&&!page.has(id))page.set(id,{id,text:row.text});
   }
   latest=[...page.values()];
   if(!latest.length){this.hide();return;}
   const added=[];
   for(const row of latest){
    if(seen.has(row.id))continue;
    seen.add(row.id);added.push(row);
    if(seen.size>SEEN_LIMIT)seen.delete(seen.values().next().value);
   }
   if(still.matches){renderStatic();return;}
   if(!added.length)return;
   pending=[...pending,...added].slice(narrow.matches?-3:-PAGE);drain();
  },
 };
}

// Optional scenery, independent of the login and score queues.
export function mountRemiliaDisplay(doc,win,chat){
 const box=doc.getElementById('beetle-status');
 if(!box||!chat)return {dispose(){},show(){}};
 const fields=[...box.querySelectorAll('[data-beetle-field]')];
 const format=new Intl.NumberFormat('en-US');
 const stream=chatStream(doc,win,chat);
 let active,poll,expiry;
 const hide=()=>{box.hidden=true;for(const field of fields)field.textContent='';stream.hide();};
 const clear=()=>{
  active?.abort.abort();active=null;clearTimeout(poll);clearTimeout(expiry);hide();stream.reset();
 };
 const show=state=>{
  const s=state.session;
  if(doc.hidden||state.revoking||state.error||s?.authenticated!==true||s.user?.provider!=='remilianet'||!(Date.parse(s.expiresAt)>Date.now()))return clear();
  if(active?.id===s.user.id&&active.csrf===s.csrf)return;
  clear();const key=active={id:s.user.id,csrf:s.csrf,abort:new AbortController()};
  const current=()=>active===key&&!doc.hidden&&!key.abort.signal.aborted;
  const update=async()=>{
   const start=performance.now();
   try{
    const response=await win.fetch('/api/remilianet/display',{cache:'no-store',credentials:'same-origin',redirect:'error',headers:{'X-CSRF-Token':key.csrf},signal:AbortSignal.any([key.abort.signal,AbortSignal.timeout(3500)])});
    if(!current())return;
    if([204,401,403,404].includes(response.status)){hide();return;}
    if(!response.ok)throw Error('Display unavailable');
    const data=await response.json();if(!current())return;
    const remaining=Math.min(Date.parse(s.expiresAt)-Date.now(),data.validForMs-(performance.now()-start),30*60*1000);
    if(!Number.isFinite(remaining)||remaining<=0){hide();return;}
    clearTimeout(expiry);expiry=setTimeout(clear,remaining);
    box.hidden=true;
    for(const field of fields){
     const value=data.beetle?.[field.dataset.beetleField],valid=Number.isSafeInteger(value)&&value>=0;
     field.textContent=valid?format.format(value):'—';if(valid)box.hidden=false;
    }
    stream.receive(data.chat);
    if(remaining<=30000)return;
   }catch{if(!current())return;hide();}
   poll=setTimeout(()=>{if(current())void update();},30000);
  };
  void update();
 };
 return {dispose(){clear();stream.dispose();},show};
}
