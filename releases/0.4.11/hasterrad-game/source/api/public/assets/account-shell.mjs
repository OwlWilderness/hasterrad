// Dependency-free entry; importing a failed wallet bundle never affects flight.
export function installInputShield(doc, win, isOpen) {
  const keydown=event=>{if(isOpen()||doc.querySelector('[data-rk] [role="dialog"]'))event.stopPropagation();};
  doc.addEventListener('keydown',keydown);
  return {release:()=>win.dispatchEvent(new win.Event('blur')),dispose:()=>doc.removeEventListener('keydown',keydown)};
}
export async function mountAccount({document:doc=globalThis.document,window:win=globalThis.window,importWallet=()=>import('./wallet/index.js'),loadSession=()=>import('./auth-session.mjs')}={}) {
  const panel=doc.querySelector('.account-controls');if(!panel)return;
  const urbit=doc.getElementById('urbit-login'),remilia=doc.getElementById('remilianet-login'),wallet=doc.getElementById('wallet-login'),logout=doc.getElementById('account-logout'),inline=doc.getElementById('account-status');
  const {AuthSession}=await loadSession();
  const modal=doc.createElement('section');modal.className='hasterrad-auth';modal.hidden=true;modal.dataset.hasterradAuth='';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','auth-title');
  const heading=doc.createElement('h2');heading.id='auth-title';heading.textContent='Ethereum wallet';modal.append(heading);
  const status=doc.createElement('p');status.setAttribute('role','status');modal.append(status);
  // RainbowKit renders its chooser into a body-level portal; keep its React
  // root mounted without showing a separate explanatory dialog first.
  const island=doc.createElement('div');island.id='hasterrad-wallet';island.hidden=true;doc.body.append(island);
  const guidance=doc.createElement('p');guidance.textContent='For embedded games, open the standalone game on its own origin to sign in. Cross-origin homepage login is not supported.';modal.append(guidance);
  const standalone=doc.createElement('a');standalone.href=new URL('/',win.location.origin).href;standalone.target='_blank';standalone.rel='noopener';standalone.textContent='Open standalone game ↗';modal.append(standalone);
  const close=doc.createElement('button');close.type='button';close.textContent='Return to flight';modal.append(close);doc.body.append(modal);
  let walletMounted=false,walletLoading=false,walletHandle,lastFocus,channel;
  const auth=new AuthSession({changed:state=>{
    const data=state.session||auth.config;
    inline.textContent=state.revoking?'Signing out…':state.error?'Account unavailable · guest':state.session?.authenticated?`${state.session.user.provider}: ${state.session.user.displayName}`:'Guest';
    inline.title=state.error||`${inline.textContent} · scores stay on this device. Unconfigured providers are disabled.`;
    status.textContent=state.error||inline.title;
    for(const [button,name,label] of [[urbit,'urbit','Urbit'],[remilia,'remilianet','RemiliaNET'],[wallet,'wallet','Ethereum wallet']]){
      button.disabled=!data?.providers[name]||state.revoking||(name==='wallet'&&walletLoading);
      button.title=!data?.providers[name]?`${label} · unavailable: provider is not configured`:`${label} · optional sign in`;
    }
    logout.disabled=state.revoking;logout.hidden=!state.session?.authenticated&&!state.error&&!state.revoking;
    const logoutLabel=state.error?'Retry sign out':'Sign out';
    logout.setAttribute('aria-label',logoutLabel);logout.title=logoutLabel;
  }});
  const shield=installInputShield(doc,win,()=>!modal.hidden),background=new Map();
  const show=(opener=doc.activeElement)=>{
    if(!modal.hidden)return;
    lastFocus=opener;shield.release();modal.hidden=false;
    for(const sibling of doc.body.children)if(sibling!==modal){background.set(sibling,sibling.inert);sibling.inert=true;}
    close.focus();
  };
  const hide=()=>{modal.hidden=true;for(const [sibling,inert] of background)sibling.inert=inert;background.clear();(lastFocus||wallet).focus();};
  const embedded=()=>win.self!==win.top;
  const act=(button,action)=>button.addEventListener('click',()=>Promise.resolve().then(action).catch(()=>{show(button);status.textContent=auth.state.error||'Account action unavailable or cancelled. Guest flight still works.';}));
  const provider=async(name,opener)=>{
    if(!(auth.state.session||auth.config)?.providers[name])return;
    if(embedded()){heading.textContent='Open standalone to sign in';show(opener);return;}
    await auth.logout();
    // Fixed same-origin EAuth/PKCE start; no tokens, popup polling or query identity.
    win.top.location.href=new URL(`/auth/${name}/start`,win.location.origin).href;
  };
  act(urbit,()=>provider('urbit',urbit));act(remilia,()=>provider('remilianet',remilia));
  act(wallet,async()=>{
    if(embedded()){heading.textContent='Open standalone to sign in';show(wallet);return;}
    if(walletLoading)return;
    if(walletMounted){walletHandle?.open?.();return;}
    walletLoading=true;wallet.disabled=true;
    try{
      const sdk=await importWallet();
      const css=doc.createElement('link');css.rel='stylesheet';css.href='assets/wallet/index.css';doc.head.append(css);
      walletHandle=await sdk.mount(island,auth,{openOnMount:true});walletMounted=true;
    }catch(_){show(wallet);status.textContent='Wallet tools could not load. Retry the Ethereum button, choose another available provider, or continue as guest.';}
    finally{walletLoading=false;wallet.disabled=!(auth.state.session||auth.config)?.providers.wallet||auth.state.revoking;}
  });
  act(logout,async()=>{await auth.logout();await auth.refresh();});
  urbit.disabled=remilia.disabled=wallet.disabled=true;logout.hidden=true;
  close.addEventListener('click',hide);
  doc.addEventListener('keydown',event=>{
    if(modal.hidden||doc.querySelector('[data-rk] [role="dialog"]'))return;
    if(event.key==='Escape'){event.preventDefault();hide();}
    if(event.key==='Tab'){
      const list=[...modal.querySelectorAll('button:not([hidden]):not(:disabled),a[href],input:not(:disabled),[tabindex="0"]')],first=list[0],last=list.at(-1);
      if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first?.focus();}
    }
  });
  if('BroadcastChannel' in win){channel=new win.BroadcastChannel('hasterrad-auth-invalidation');channel.onmessage=()=>auth.reconcile();auth.invalidated=()=>channel.postMessage('invalidate');}
  win.addEventListener('focus',()=>auth.refresh());
  await auth.refresh();return {auth,show,hide,modal};
}
if(typeof document!=='undefined')mountAccount().catch(()=>{});
