/* One standalone game, compact chrome only when the homepage embeds it. */
(() => {
  'use strict';
  if (new URLSearchParams(window.location.search).get('embedded') !== '1') return;
  document.documentElement.classList.add('arcade-embedded');
  const homeOrigin = window.location.origin;
  window.addEventListener('message', event => {
    if (event.origin !== homeOrigin || event.source !== window.parent || window.parent === window) return;
    if (event.data && event.data.type === 'hasterrad:focus') {
      document.getElementById('start').focus({preventScroll:true});
    }
  });
  // Capture before the controller's Escape/pause listener. No cross-origin DOM.
  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || window.parent === window) return;
    event.preventDefault(); event.stopImmediatePropagation();
    window.parent.postMessage({type:'hasterrad:close'}, homeOrigin);
  }, {capture:true});
})();
