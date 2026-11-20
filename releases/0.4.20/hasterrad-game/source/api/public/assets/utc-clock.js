// Common shell only: the device's wall clock, independent of session and market data.
(() => {
  const clock = document.getElementById('utc-clock');
  if (!clock) return;
  let timer;
  function paint() {
    clearTimeout(timer);
    if (document.hidden) return;
    const now = Date.now(), iso = new Date(now).toISOString();
    const label = `${iso.slice(11,19)} UTC`;
    if (clock.textContent !== label) clock.textContent = label;
    clock.dateTime = iso.slice(0,19) + 'Z';
    clock.hidden = false;
    timer = setTimeout(paint, 1000 - now % 1000);
  }
  document.addEventListener('visibilitychange',paint);
  window.addEventListener('pageshow',paint);
  window.addEventListener('pagehide',() => clearTimeout(timer));
  paint();
})();
