/* Verified account attribution only; client counters are NOT anti-cheat proof. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const api = 'https://hasterrad.quantumtekh.com';
  let session = null, loginPoll = null, retry = null;
  async function request(path, data, csrf) {
    const options = { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(8000) };
    if (data !== undefined) {
      options.method = 'POST'; options.headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || '' };
      options.body = JSON.stringify(data);
    }
    const response = await fetch(api + path, options);
    if (!response.ok) throw new Error('Account service unavailable or request refused');
    return response.json();
  }
  async function refresh() {
    try {
      session = await request('/api/session');
      $('urbit-login').hidden = session.authenticated || !session.providers.urbit;
      $('remilianet-login').hidden = session.authenticated || !session.providers.remilianet;
      $('account-logout').hidden = !session.authenticated;
      $('account-status').textContent = session.authenticated ? `${session.user.provider || 'Account'} ${session.user.name} · new runs save to this account`
        : session.providers.urbit ? 'Guest · device-local score only. Sign in as your ship via EAuth.'
          : 'Guest · Urbit callback setup pending; device-local score only.';
      if (session.authenticated) {
        const mine = await request('/api/me/scores'); $('account-best').textContent = String(mine.best);
      } else $('account-best').textContent = '—';
      const board = await request('/api/leaderboard');
      $('account-board').replaceChildren();
      for (const row of board.board.slice(0, 5)) {
        const item = document.createElement('li'); item.textContent = `${row.name} · ${row.score}`;
        $('account-board').appendChild(item);
      }
    } catch (_) {
      session = null; $('urbit-login').hidden = true; $('account-logout').hidden = true;
      $('remilianet-login').hidden = true;
      $('account-status').textContent = 'Guest · account service offline; device-local score still works.';
      $('account-best').textContent = '—';
    }
  }
  function login(provider) {
    // Deliberate top-level window. Eyre asks for ship NAME and discovers its EAuth URL.
    // No provider UI in the homepage iframe; no tokens/messages passed to its opener.
    window.open(api + '/auth/' + provider + '/start', '_blank', 'noopener,noreferrer');
    clearInterval(loginPoll);
    let attempts = 0;
    loginPoll = setInterval(() => { refresh(); if (++attempts >= 150 || (session && session.authenticated)) clearInterval(loginPoll); }, 2000);
    $('account-status').textContent = 'Complete login in the new window, then return here. Provider may refuse; availability is not yet verified. If blocked, allow this login window.';
  }
  $('urbit-login').addEventListener('click', () => login('urbit'));
  $('remilianet-login').addEventListener('click', () => login('remilianet'));
  $('account-logout').addEventListener('click', async () => {
    try { if (session && session.authenticated) await request('/auth/logout', {}, session.csrf); await refresh(); }
    catch (_) { $('account-status').textContent = 'Logout not confirmed. Try again when online.'; }
  });
  async function start() {
    if (!session || !session.authenticated) return null;
    const csrf = session.csrf;
    try {
      const issued = await request('/api/runs/start', { version: 'hasterrad-2', mode: 'classic' }, csrf);
      return { id: issued.run_id, csrf };
    } catch (_) {
      $('account-status').textContent = 'This run is device-local only: account run could not start.';
      return null;
    }
  }
  async function finish(run, counters) {
    if (!run) return;
    const save = async () => {
      $('score-retry').disabled = true;
      try {
        await request('/api/runs/' + encodeURIComponent(run.id) + '/finish', counters, run.csrf);
        retry = null; $('score-retry').hidden = true;
        await refresh(); $('account-status').textContent = 'Run saved to your account. Client counters are not cheat-proof.';
      } catch (_) {
        retry = save; $('score-retry').hidden = false;
        $('account-status').textContent = 'Account save not confirmed. Device score retained; retry this same run while signed in.';
      } finally { $('score-retry').disabled = false; }
    };
    await save();
  }
  $('score-retry').addEventListener('click', () => { if (retry) retry(); });
  window.addEventListener('focus', refresh);
  window.addEventListener('pagehide', () => clearInterval(loginPoll));
  window.HasterradScores = Object.freeze({ start, finish, refresh });
  refresh();
})();
