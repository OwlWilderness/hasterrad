// Keep account history in the DOM only for the active session and document.
export function mountHistory(doc, win, retry) {
  const panel=doc.getElementById('personal-history');
  if(!panel)return {clear(){},show(){}};
  const list=doc.getElementById('personal-history-list'), status=doc.getElementById('personal-history-status');
  const button=doc.getElementById('personal-history-retry');
  const format=new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'});
  let active;
  const clear=()=>{
    active?.abort();active=null;
    list.replaceChildren();status.textContent='';button.hidden=true;panel.hidden=true;
  };
  button.addEventListener('click',retry);
  async function show(session){
    clear();
    if(!session?.authenticated||doc.hidden)return;
    const request=new AbortController();active=request;
    const timeout=win.setTimeout(()=>request.abort(),3500);
    panel.hidden=false;status.textContent='Loading your scores…';
    try{
      const response=await win.fetch('/api/me/score-history',{credentials:'same-origin',cache:'no-store',redirect:'error',
        headers:{'X-CSRF-Token':session.csrf},signal:request.signal});
      if(!response.ok)throw Error('history unavailable');
      const {scores}=await response.json();
      if(active!==request||doc.hidden)return;
      if(!Array.isArray(scores)||scores.length>10)throw Error('invalid history');
      const rows=scores.map(row=>{
        if(!Number.isSafeInteger(row?.score)||row.score<0||!Number.isSafeInteger(row.level)||row.level<1||
           typeof row.finishedAt!=='string'||!Number.isFinite(Date.parse(row.finishedAt)))throw Error('invalid score');
        const item=doc.createElement('li'), time=doc.createElement('time');
        time.dateTime=row.finishedAt;time.textContent=format.format(new Date(row.finishedAt));
        item.append(`${row.score.toLocaleString()} · LV ${row.level} · `,time);return item;
      });
      list.replaceChildren(...rows);status.textContent=rows.length?'':'No finished scores yet.';
    }catch{
      if(active!==request||doc.hidden)return;
      status.textContent='Score history unavailable.';button.hidden=false;
    }finally{win.clearTimeout(timeout);}
  }
  return {clear,show};
}
