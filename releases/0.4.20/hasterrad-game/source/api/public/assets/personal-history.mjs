// Keep private scores in the DOM only for the active session and document.
export function mountHistory(doc, win, retry) {
  const panel=doc.getElementById('personal-history');
  if(!panel)return {clear(){},show(){}};
  const list=doc.getElementById('personal-history-list'), body=list.querySelector('tbody');
  const status=doc.getElementById('personal-history-status'), button=doc.getElementById('personal-history-retry');
  let active;
  const clear=(keepPanel=false)=>{
    active?.abort();active=null;
    body.replaceChildren();list.hidden=true;button.hidden=true;panel.hidden=!keepPanel;
    status.textContent=keepPanel?'Loading your scores…':'';
  };
  button.addEventListener('click',retry);
  async function show(session){
    const visible=!!session?.authenticated&&!doc.hidden;
    clear(visible);
    if(!visible)return;
    const request=new AbortController();active=request;
    const timeout=win.setTimeout(()=>request.abort(),3500);
    try{
      const response=await win.fetch('/api/me/score-history',{credentials:'same-origin',cache:'no-store',redirect:'error',
        headers:{'X-CSRF-Token':session.csrf},signal:request.signal});
      if(!response.ok)throw Error('history unavailable');
      const {scores}=await response.json();
      if(active!==request||doc.hidden)return;
      if(request.signal.aborted||!Array.isArray(scores)||scores.length>10)throw Error('invalid history');
      const rows=scores.map(row=>{
        if(!Number.isSafeInteger(row?.score)||row.score<0||!Number.isSafeInteger(row.level)||row.level<1)throw Error('invalid score');
        const entry=doc.createElement('tr');
        const cell=doc.createElement('td');
        // Use UTC so a stored finish maps to the same date on every device.
        const finished=Number.isSafeInteger(row.finishedAt)&&row.finishedAt>0?new Date(row.finishedAt):null;
        if(finished&&Number.isFinite(finished.getTime())){
          const time=doc.createElement('time');
          time.dateTime=finished.toISOString();time.textContent=time.dateTime.split('T')[0];cell.append(time);
        }else cell.textContent='—';
        entry.append(cell);
        for(const value of [row.score,row.level]){const cell=doc.createElement('td');cell.textContent=value.toLocaleString();entry.append(cell);}
        return entry;
      });
      body.replaceChildren(...rows);list.hidden=!rows.length;status.textContent=rows.length?'':'No finished scores yet.';
    }catch{
      if(active!==request||doc.hidden)return;
      status.textContent='Score history unavailable.';button.hidden=false;
    }finally{win.clearTimeout(timeout);}
  }
  return {clear,show};
}
