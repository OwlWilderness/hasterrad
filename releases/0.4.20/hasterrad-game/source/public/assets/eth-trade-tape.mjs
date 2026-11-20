const POLL_MS = 1500;
const MAX_AGE_MS = 15_000;
const MAX_ROWS = 100;
const MAX_QUEUE = 6;
const MAX_ACTIVE = 12;
const SPEED = 76; // CSS pixels per second, independent of fill rate and travel distance.
const ENTRY_MS = 1050;
const STILL_MS = 1350;

const trimDecimal = s => s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
const decimal = s => typeof s === 'string' && s.length <= 24 && /^\d+(?:\.\d+)?$/.test(s) && Number(s)>0 && Number(s)<=1e9;

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function comparePrice(a, b) {
  const parts = s => s.replace(/^0+(?=\d)/, '').split('.');
  const [ai, af = ''] = parts(a), [bi, bf = ''] = parts(b);
  const places = Math.max(af.length, bf.length);
  return compare(ai.length, bi.length) || compare(ai, bi) || compare(af.padEnd(places, '0'), bf.padEnd(places, '0'));
}

function observation(trade, now) {
  const iso = typeof trade?.time === 'string' && /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/.exec(trade.time);
  const stamp = iso ? Date.parse(trade.time) : NaN;
  if (typeof trade?.id !== 'string' || !/^[1-9][0-9]{0,31}$/.test(trade.id) || !Number.isFinite(stamp) ||
      stamp <= now-MAX_AGE_MS || stamp > now+2000 || new Date(stamp).toISOString().slice(0,19) !== iso[1] ||
      !decimal(trade.price) || !decimal(trade.size) || !['buy','sell'].includes(trade.side)) return null;
  return {trade, stamp, subsecond:(iso[2] ?? '').padEnd(9, '0'), id:BigInt(trade.id), expires:stamp+MAX_AGE_MS};
}
const chronological = (a, b) => a.stamp-b.stamp || compare(a.subsecond,b.subsecond) || compare(a.id,b.id);
const translate = (x, y) => `translate(${x}px, ${y}px)`;
const GUTTER = 8;
const MAX_COLUMNS = 8;
const RETRY_MS = 100;
const pixelTime = pixels => pixels / SPEED * 1000;

function columnLayout(width, height, controls, footprint, rowHeight) {
  const track = (left, right) => {
    const lo = left + GUTTER / 2, hi = right - footprint - GUTTER / 2;
    const center = (lo + hi) / 2;
    const positions = [center, lo, hi, ...controls.flatMap(r => [r.left - footprint - 2, r.right + 2])];
    let best;
    for (const x of positions) {
      if (x < lo || x > hi) continue;
      const bottom = Math.min(height, ...controls.filter(r => x < r.right + 2 && x + footprint > r.left - 2)
        .map(r => r.top - 2));
      if (bottom < rowHeight + GUTTER) continue;
      if (!best || bottom > best.bottom || (bottom === best.bottom && Math.abs(x-center) < Math.abs(best.x-center))) {
        best = {x, bottom};
      }
    }
    return best;
  };
  const build = (left, right, count) => {
    const step = (right-left) / count;
    if (step < footprint + GUTTER) return;
    const tracks = Array.from({length:count}, (_,i) => track(left+i*step, left+(i+1)*step));
    if (!tracks.every(Boolean)) return;
    let split;
    if (!controls.length && count >= 5 && count % 2) {
      // Split the middle encounter while keeping each track center in its
      // logical column. Any overhang is reserved by x, not column number.
      const middle = Math.floor(count/2), center = (left+right)/2;
      const pitch = footprint+GUTTER;
      const inner = tracks.slice(1,-1).map(({x,bottom},i) => {
        const j = i+1-middle;
        return {x:x+Math.sign(j)*Math.max(0,(Math.abs(j)+.5)*pitch-Math.abs(j)*step),bottom};
      });
      const pair = [-1,1].map(side => ({x:center-footprint/2+side*pitch/2,bottom:height}));
      const fits = ({x}, index) => {
        const anchor = x+footprint/2;
        return x >= left+GUTTER/2 && x+footprint <= right-GUTTER/2 &&
          anchor > left+index*step && anchor < left+(index+1)*step;
      };
      if (inner.every((leg,i) => fits(leg,i+1)) && pair.every(leg => fits(leg,middle))) {
        tracks.splice(1,inner.length,...inner);
        split = {index:middle,up:pair[0],down:pair[1]};
      }
    }
    return {tracks,count,footprint,rowHeight,split};
  };
  const target = Math.min(MAX_COLUMNS, Math.max(3, Math.floor(width / 210)));
  const bounds = [[0,width], ...controls.flatMap(r => [[0,r.left-2],[r.right+2,width]])];
  for (let n = target; n >= 1; n--) {
    for (const [left,right] of bounds) {
      const layout = build(left,right,n);
      if (layout) return layout;
    }
  }
}

function cascade(layout, direction) {
  const up = direction === 'up';
  // Opposite edge columns are entry-only. Both directions travel all inner
  // columns; a roomy odd layout can split the middle encounter horizontally.
  const indices = layout.tracks.flatMap((_,i) => layout.count === 1 || (up ? i < layout.count-1 : i > 0) ? [i] : []);
  if (!up) indices.reverse();
  return indices.map(index => {
    const {x,bottom} = index === layout.split?.index ? layout.split[direction] : layout.tracks[index];
    const from = up ? bottom : -layout.rowHeight, to = up ? -layout.rowHeight : bottom;
    return {index,x,bottom,from,to,travel:pixelTime(bottom + layout.rowHeight)};
  });
}

// Each leg has an immutable offset from route entry. Project its conflicts
// back onto that single entry time, then find the first hole in their union.
// Separate horizontal tracks never conflict. On a shared track parallel rows
// need only headway; opposing travelers cannot pass, but each can use the
// track before/after the other without owning it for their whole cascade.
function plan(layout, direction, still, occupied, stillSlot) {
  const h = layout.rowHeight;
  const stillY = bottom => (bottom-h)*.4;
  const crossing = ({from,direction}, y) => pixelTime(direction === 'up' ? from-y : y-from);
  const sharesInk = (a,b) => Math.abs(a-b) < layout.footprint + GUTTER;
  const headway = pixelTime(h + GUTTER);
  const n = layout.tracks.length;
  if (still) {
    for (let i=0; i<n; i++) {
      const index = (stillSlot+i)%n;
      if (n > 2 && (index === 0 || index === n-1)) continue;
      if (n === 2 && index !== (direction === 'up' ? 0 : 1)) continue;
      const {x,bottom} = layout.tracks[index];
      if (occupied.some(leg => {
        if (!sharesInk(leg.x,x) || leg.start >= STILL_MS || leg.end <= 0) return false;
        if (leg.still) return true;
        const middle = crossing(leg,stillY(bottom));
        return leg.start+middle-headway < STILL_MS && leg.start+middle+headway > 0;
      })) continue;
      return [{index,x,bottom,y:stillY(bottom),start:0,end:STILL_MS,still:true}];
    }
    return;
  }
  let offset = 0;
  const blocks = [];
  const path = cascade(layout,direction).map(leg => {
    const start = offset;
    offset += leg.travel;
    for (const other of occupied) {
      if (!sharesInk(other.x,leg.x)) continue;
      const first = other.start-offset, last = other.end-start;
      if (other.still) {
        const middle = crossing({...leg,direction},other.y);
        blocks.push([Math.max(first,other.start-middle-headway-start), Math.min(last,other.end-middle+headway-start)]);
      } else if (other.direction === direction) {
        // Equal-speed legs have constant relative y, including on adjacent
        // overhung tracks. Block when they are too close while both in use.
        const coincident = other.start-start+pixelTime((leg.from-other.from)*(direction === 'up' ? -1 : 1));
        blocks.push([Math.max(first,coincident-headway), Math.min(last,coincident+headway)]);
      } else {
        blocks.push([first,last]);
      }
    }
    return {...leg,start,end:offset};
  });
  let delay = 0;
  for (const [from,until] of blocks.sort((a,b) => a[0]-b[0])) {
    if (from > delay) break;
    if (until > delay && until > from) delay = until;
  }
  return {path,delay};
}

export function mountEthTradeTape({document, window, roots, session, signal}) {
  const root = roots.backdrop;
  root.classList.add('playfield-copy');
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const flightControls = [...document.querySelectorAll('#flight-stick, #touch-controls button')];
  const queue = [], rows = new Set();
  // Keep the chronological watermark across gaps to prevent replay, but never
  // compare against its price once the separate continuity baseline is lost.
  let watermark, baseline, primed = false, pollTimer, emitTimer, stopped = false;
  let stillSlot = 0, width, height, controlKey, layout, obstacles = [];
  const active = () => !stopped && !document.hidden && !signal.aborted;

  function remove(row) {
    rows.delete(row);
    window.clearTimeout(row.timer);
    if (row.animation) {
      row.animation.onfinish = null;
      row.animation.cancel();
    }
    row.clipAnimation?.cancel();
    row.clip.remove();
  }
  function clearRows() {
    for (const row of rows) remove(row);
    stillSlot = 0;
    layout = undefined;
  }
  function resize() {
    const w = root.clientWidth, h = root.clientHeight;
    const band = root.getBoundingClientRect();
    const next = flightControls.map(control => control.getBoundingClientRect())
      .filter(rect => rect.width && rect.height && rect.bottom > band.top && rect.top < band.top + h)
      .map(rect => ({left:Math.floor(rect.left - band.left), right:Math.ceil(rect.right - band.left),
        top:Math.floor(rect.top - band.top)}));
    const key = JSON.stringify(next);
    if (width === w && height === h && key === controlKey) return;
    width = w;
    height = h;
    controlKey = key;
    obstacles = next;
    clearRows();
  }
  const resizeObserver = window.ResizeObserver && new window.ResizeObserver(resize);
  resizeObserver?.observe(root);
  for (const control of flightControls) resizeObserver?.observe(control);
  // Window resize runs before animation-frame callbacks; ResizeObserver alone
  // runs later and leaves an old path in the new control geometry for a frame.
  window.addEventListener?.('resize', resize);

  function emit() {
    emitTimer = undefined;
    if (!active()) return;
    while (queue.length && queue[0].expires <= Date.now()) queue.shift();
    if (!queue.length) return;
    resize();
    if (!width || !height || rows.size >= MAX_ACTIVE) return schedule(ENTRY_MS);
    const {trade, direction} = queue[0];
    const clip = document.createElement('div'), node = document.createElement('div');
    clip.className = 'eth-tape-clip';
    node.dataset.tradeId = trade.id;
    node.dataset.side = trade.side;
    node.dataset.direction = direction;
    const quote = document.createElement('span'), size = document.createElement('span');
    // The adapter already projects Coinbase maker side to aggressor side.
    quote.textContent = `${trade.side === 'buy' ? '(B)' : '(S)'} $${trimDecimal(trade.price)}`;
    size.textContent = `${trimDecimal(trade.size)} ETH`;
    node.append(quote,size);
    clip.append(node);
    root.append(clip);
    const rowWidth = node.offsetWidth, rowHeight = node.offsetHeight;
    if (layout && (rowWidth > layout.footprint || rowHeight !== layout.rowHeight) && !rows.size) layout = undefined;
    // Round the measured natural width up to a small bucket, so near-identical
    // prices do not churn layout. The CSS never truncates or shrinks the text.
    layout ??= columnLayout(width,height,obstacles,Math.ceil((rowWidth + 1) / 8)*8,rowHeight);
    if (!layout || rowWidth > layout.footprint || rowHeight !== layout.rowHeight) {
      clip.remove();
      // Wait for the current layout to empty; the bounded queue can expire.
      if (rows.size) return schedule(RETRY_MS);
      queue.shift();
      return schedule(ENTRY_MS);
    }
    node.style.width = `${layout.footprint}px`;
    node.dataset.columnCount = String(layout.count);
    const reduced = motion.matches, still = reduced || direction === 'neutral';
    if (layout.count === 2 && direction === 'neutral') {
      // There is no legal neutral column; preserve both entry roles.
      clip.remove();
      queue.shift();
      return schedule(0);
    }
    const now = document.timeline?.currentTime ?? window.performance.now();
    const occupied = [];
    for (const other of rows) {
      const age = now - other.started;
      for (const leg of other.reservations) if (leg.end > age) {
        occupied.push({...leg,direction:other.direction,start:leg.start-age,end:leg.end-age});
      }
    }
    const planned = plan(layout,direction,still,occupied,stillSlot);
    if (!planned || planned.delay > 0) {
      clip.remove();
      // Nothing is admitted or displayed during this wait. Keep the head in
      // place so a newer arrival cannot take its first conflict-free slot.
      const freshFor = queue[0].expires - Date.now();
      return schedule(Math.max(1, Math.min(Math.ceil(planned?.delay || RETRY_MS), freshFor)));
    }
    const reservations = still ? planned : planned.path;
    queue.shift();
    const row = {node,clip,started:now,reservations,still,direction};
    rows.add(row);
    if (still) {
      const {index,x,bottom,y} = reservations[0];
      stillSlot = (index+1)%layout.tracks.length;
      clip.style.height = `${bottom}px`;
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
      if (reduced) row.timer = window.setTimeout(() => remove(row), STILL_MS);
      else row.animation = node.animate([{opacity:0},{opacity:1,offset:.15},
        {opacity:1,offset:.6},{opacity:0}], {duration:STILL_MS});
    } else {
      const duration = reservations.at(-1).end;
      const options = {duration,easing:'linear',fill:'both'};
      const position = [], aperture = [];
      for (const {x,bottom,start,end,from,to} of reservations) {
        // Equal offsets hard-cut to the next column, with no sideways frames.
        position.push({offset:start/duration,transform:translate(x,from)},
          {offset:end/duration,transform:translate(x,to)});
        aperture.push({offset:start/duration,height:`${bottom}px`},
          {offset:end/duration,height:`${bottom}px`});
      }
      row.animation = node.animate(position,options);
      row.clipAnimation = clip.animate(aperture,options);
      row.clipAnimation.startTime = now;
    }
    if (row.animation) {
      row.animation.startTime = now;
      row.animation.onfinish = () => remove(row);
    }
    schedule(ENTRY_MS);
  }

  function schedule(delay) {
    if (emitTimer === undefined) emitTimer = window.setTimeout(emit, delay);
  }
  function accept(trades) {
    const now = Date.now(), fresh = [];
    const unique = new Map();
    for (const trade of trades) {
      const fill = observation(trade, now);
      if (fill && !unique.has(fill.id)) unique.set(fill.id, fill);
    }
    for (const fill of [...unique.values()].sort(chronological)) {
      if (watermark && (fill.id <= watermark.id || chronological(fill, watermark) <= 0)) continue;
      // Require a consecutive Coinbase fill ID as continuity evidence. A jump
      // can mean skipped fills or a truncated page, even in an overlapping poll.
      const delta = baseline?.expires > now && fill.id === baseline.id + 1n
        ? comparePrice(fill.trade.price, baseline.trade.price) : 0;
      watermark = baseline = fill;
      if (primed) fresh.push({...fill, direction:delta > 0 ? 'up' : delta < 0 ? 'down' : 'neutral'});
    }
    if (!unique.size) baseline = undefined;
    primed = true;
    while (queue.length && queue[0].expires <= now) queue.shift();
    const room = MAX_QUEUE-queue.length;
    const batch = room ? fresh.slice(-room) : [];
    // Under overload keep the head and the oldest representative of each
    // pending kind. A missing kind can claim a redundant tail slot; append
    // that exact fill, not an unrelated recent fill from the same poll.
    for (const direction of ['up','down','neutral']) {
      const pending = [...queue,...batch];
      if (pending.some(row => row.direction === direction)) continue;
      const fill = fresh.findLast(row => row.direction === direction);
      if (!fill) continue;
      const index = pending.findLastIndex((row,i) => pending.findIndex(x => x.direction === row.direction) < i);
      if (index < 0) continue;
      if (index < queue.length) queue.splice(index,1);
      else batch.splice(index-queue.length,1);
      batch.push(fill);
    }
    queue.push(...batch.sort(chronological));
    if (queue.length) schedule(0);
  }
  function gap() {
    baseline = undefined;
    queue.length = 0;
  }
  async function poll() {
    if (!active()) return;
    try {
      const response = await window.fetch('/api/eth-market/trades', {
        credentials:'same-origin', cache:'no-store', headers:{'X-CSRF-Token':session.csrf}, signal,
      });
      if (!active()) return;
      if (response.status === 401 || response.status === 403) return stop();
      if (!response.ok) return gap();
      const data = await response.json();
      if (!active()) return;
      if (Array.isArray(data?.trades) && data.trades.length <= MAX_ROWS) accept(data.trades);
      else gap();
    } catch { if (active()) gap(); }
    finally { if (active()) pollTimer = window.setTimeout(poll, POLL_MS); }
  }
  function stop() {
    stopped = true;
    window.clearTimeout(pollTimer);
    window.clearTimeout(emitTimer);
    window.removeEventListener?.('resize', resize);
    motion.removeEventListener('change', clearRows);
    resizeObserver?.disconnect();
    clearRows();
    root.replaceChildren();
    queue.length = 0;
    watermark = baseline = undefined;
  }
  motion.addEventListener('change', clearRows);
  void poll();
  return stop;
}
