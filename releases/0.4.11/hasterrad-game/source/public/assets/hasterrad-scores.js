/* Same-origin account scores. Guest flight remains device-local when the API is unavailable. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const list = $('leaderboard-list'), status = $('leaderboard-status'), retryButton = $('score-retry');
  const providerIcons=Object.freeze({
    urbit:Object.freeze({src:'assets/brands/urbit.svg',alt:'Urbit'}),
    remilianet:Object.freeze({src:'assets/brands/remilia.png',alt:'RemiliaNET'}),
    ethereum:Object.freeze({src:'assets/brands/ethereum.svg',alt:'Ethereum'})
  });
  async function request(path, data, csrf) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 3500);
    const options = { credentials:'include', cache:'no-store', signal:controller.signal };
    if (data !== undefined) {
      options.method = 'POST';
      options.headers = { 'Content-Type':'application/json', 'X-CSRF-Token':csrf };
      options.body = JSON.stringify(data);
    }
    try {
      const response = await fetch(path, options);
      if (!response.ok) throw new Error('account_service_unavailable');
      return await response.json();
    } finally { clearTimeout(timer); }
  }
  async function refresh() {
    try {
      const data = await request('/api/leaderboard');
      if (!Array.isArray(data.board)) throw new Error('invalid_board');
      list.replaceChildren();
      for (const row of data.board.slice(0,5)) {
        const badge=Object.prototype.hasOwnProperty.call(providerIcons,row.provider)?providerIcons[row.provider]:null;
        if (!badge || typeof row.name !== 'string' || !Number.isSafeInteger(row.score) || row.score < 0 ||
            !Number.isSafeInteger(row.level) || row.level < 1 || row.level > 1000) continue;
        const item=document.createElement('li'), entry=document.createElement('span');
        const icon=document.createElement('img'), name=document.createElement('span');
        const level=document.createElement('span'), score=document.createElement('span');
        entry.className='board-entry';icon.className='board-provider';icon.src=badge.src;icon.alt=badge.alt;
        name.className='board-name';name.textContent=row.name;
        level.className='board-level';level.textContent=`LV ${String(row.level).padStart(2,'0')}`;
        score.className='board-score';score.textContent=row.score.toLocaleString();
        entry.append(icon,name,level,score);item.append(entry);list.append(item);
      }
      status.textContent=list.children.length?'':'No account scores yet. Sign in to save a run.';
    } catch { list.replaceChildren(); status.textContent='Leaderboard unavailable · local play still works.'; }
  }
  async function start(width, height) {
    try {
      const session=await request('/api/session');
      if (!session.authenticated || typeof session.csrf !== 'string') return null;
      const issued=await request('/api/runs/start',{version:'hasterrad-3',mode:'classic',width,height},session.csrf);
      if (!Number.isInteger(issued.seed) || issued.seed<0 || issued.seed>0xffffffff) return null;
      return {id:issued.run_id,seed:issued.seed,width,height,csrf:session.csrf};
    } catch { return null; }
  }
  let retry=null, saving=false;
  async function finish(run,counters) {
    if (!run || saving) return;
    const save=async()=>{
      if (saving) return;
      saving=true;retryButton.disabled=true;
      try {
        await request('/api/runs/'+encodeURIComponent(run.id)+'/finish',counters,run.csrf);
        retry=null;retryButton.hidden=true;
        await refresh();
      } catch {
        retry=save;retryButton.hidden=false;
        status.textContent='Score not saved to account. Retry while still signed in.';
      } finally { saving=false;retryButton.disabled=false; }
    };
    await save();
  }
  retryButton.addEventListener('click',()=>{ if(retry) void retry(); });
  window.addEventListener('focus',()=>{ void refresh(); });
  window.HasterradScores=Object.freeze({start,finish,refresh});
  void refresh();
})();
