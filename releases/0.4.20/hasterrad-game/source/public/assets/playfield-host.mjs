// Trusted, repo-local scenery only. No script discovery or game-core dependency.
export function createPlayfieldHost(document, window) {
  const slots = new Map(['backdrop','strip'].map(name => [name, document.querySelector(`[data-playfield-slot="${name}"]`)]));
  const entries = new Map(), claimed = new Set();
  let state;

  function stop(entry) {
    const active = entry.active;
    if (!active) return;
    entry.active = null;
    active.controller.abort();
    window.clearTimeout?.(active.expiry);
    for (const {root, generated} of active.nodes) {
      if (generated) root.remove();
      else root.setAttribute('hidden', '');
    }
    try { active.dispose?.(); } catch { /* Optional scenery cannot block flight. */ }
  }

  function reconcile(entry) {
    if (!state || document.hidden || state.revoking || state.error) return stop(entry);
    const {spec} = entry, session = spec.eligible ? state.session : null;
    const end = Date.parse(session?.expiresAt);
    if (spec.eligible) {
      try { if (!session?.authenticated || !(end > Date.now()) || !spec.eligible(session)) return stop(entry); }
      catch { return stop(entry); }
    }
    const key = session ? JSON.stringify([session.user?.id, session.csrf, end]) : '';
    if (entry.active?.key === key) return;
    stop(entry);
    const controller = new AbortController(), roots = {};
    const active = entry.active = {key, controller, nodes:[]};
    try {
      for (const [name, anchor, authored] of entry.bindings) {
        const root = authored ?? document.createElement('div');
        active.nodes.push({root, generated:!authored});
        root.dataset.playfieldRoot = name;
        root.dataset.playfieldModule = spec.id;
        if (name === 'backdrop') {
          root.setAttribute('aria-hidden','true');
          root.inert = true;
        }
        if (!authored) {
          if (name === 'backdrop') anchor.prepend(root);
          else anchor.append(root);
        }
        roots[name] = root;
      }
      active.dispose = spec.mount({document,window,roots,session,signal:controller.signal});
      if (session) active.expiry = window.setTimeout(() => stop(entry), Math.max(0, end-Date.now()));
    } catch { stop(entry); }
  }

  return {
    register(spec) {
      if (!/^[a-z][a-z0-9-]*$/.test(spec.id) || entries.has(spec.id) || typeof spec.mount !== 'function') throw new TypeError('Invalid or duplicate playfield module');
      const bindings = Object.entries(spec.slots ?? {}).map(([name, selector]) => {
        if (!slots.has(name) || !(selector === true || typeof selector === 'string')) throw new TypeError('Invalid playfield slot');
        return [name,slots.get(name),selector === true ? null : document.querySelector(selector),selector === true];
      });
      if (!bindings.length) throw new TypeError('Playfield module needs a slot');
      if (bindings.some(([,anchor,root,generated]) => !anchor || (!generated && !root))) return () => {};
      for (const [name,anchor,root] of bindings) {
        if ((name === 'strip' && claimed.has(anchor)) || (root && (claimed.has(root) || !anchor.contains(root)))) throw new TypeError('Playfield slot already owned or outside its anchor');
      }
      for (const [name,anchor,root] of bindings) { if (name === 'strip') claimed.add(anchor); if (root) claimed.add(root); }
      const entry = {spec,bindings};
      entries.set(spec.id,entry);
      reconcile(entry);
      return () => {
        if (entries.get(spec.id) !== entry) return;
        entries.delete(spec.id);stop(entry);
        for (const [name,anchor,root] of bindings) { if (name === 'strip') claimed.delete(anchor); if(root) claimed.delete(root); }
      };
    },
    update(next) { state = next; for (const entry of entries.values()) reconcile(entry); },
    clear() { state = undefined; for (const entry of entries.values()) stop(entry); },
  };
}
