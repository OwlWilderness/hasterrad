const TRUSTED_ORIGIN = 'https://api.exchange.coinbase.com';
const MINUTE = 60_000;
const HISTORY = 180;
const MAX_BYTES = 32_768;
const FRESHNESS = 150_000;
const LIVE_FRESHNESS = 15_000;

const TAPE_PAGE = 50;
const TAPE_ROWS = 100;
const TAPE_AGE = 15_000;
const TAPE_FUTURE = 2000;
const TAPE_POLL = 1500;
const decimalText = value => typeof value === 'string' && value.length <= 24 &&
  /^\d+(?:\.\d+)?$/.test(value) && Number(value)>0 && Number(value)<=1e9;

function projectFill(raw, now) {
  const {trade_id:id, time, price, size, side} = raw ?? {};
  if (typeof id !== 'string' || !/^[1-9][0-9]{0,31}$/.test(id) ||
      !decimalText(price) || !decimalText(size) || !['buy','sell'].includes(side)) return null;
  const stamp = typeof time === 'string' && /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/.exec(time);
  const ms = stamp && Date.parse(time);
  if (!Number.isFinite(ms) || ms <= now-TAPE_AGE || ms > now+TAPE_FUTURE ||
      new Date(ms).toISOString().slice(0,19) !== stamp[1]) return null;
  return {ms, subsecond:(stamp[2]??'').padEnd(9,'0'), fill:{id,time,price,size,side:side==='sell'?'buy':'sell'}};
}

// Preserve JSON integer tokens before Number rounding; trade IDs are never used for arithmetic.
function readTradeId(key, value, context) {
  return key === 'trade_id' && typeof value === 'number' ? context.source : value;
}

async function readJson(response, reviver) {
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_BYTES) {
    void response.body?.cancel().catch(() => {});
    return null;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '', bytes = 0;
  while (true) {
    const {done,value} = await reader.read();
    if (done) return JSON.parse(text + decoder.decode(), reviver);
    bytes += value.byteLength;
    if (bytes > MAX_BYTES) { void reader.cancel().catch(() => {}); return null; }
    text += decoder.decode(value,{stream:true});
  }
}

// One demand-driven cache per server process; no user input or identity enters this closure.
export function createEthMarket(origin, {clock=Date.now, fetcher=globalThis.fetch} = {}) {
  if (origin !== TRUSTED_ORIGIN) return null;
  let snapshot = null, inFlight = null, nextAttempt = 0;
  let latest = null, tickInFlight = null, nextTick = 0, retry = 1000;
  let tape = [], tapeFlight = null, nextTape = 0, tapeRetry = TAPE_POLL, tapeReady = false;
  async function request(productPath,query,reviver) {
    const url = new URL('/products/ETH-USD/'+productPath,origin);
    if (query) url.search = new URLSearchParams(query);
    try {
      const response = await fetcher(url,{headers:{Accept:'application/json'},credentials:'omit',redirect:'error',signal:AbortSignal.timeout(4000)});
      return await readJson(response,reviver);
    } catch { return null; }
  }
  async function history(now) {
    const end = Math.floor(now / MINUTE) * MINUTE, start = end - HISTORY * MINUTE;
    const rows = await request('candles',{granularity:'60',start:new Date(start).toISOString(),end:new Date(end).toISOString()});
    if (!Array.isArray(rows) || rows.length > 360) return null;
    const closes = new Map();
    for (const row of rows) {
      if (!Array.isArray(row) || row.length !== 6) return null;
      const [time,,,,close] = row;
      if (!Number.isSafeInteger(time) || time % 60 || !Number.isFinite(close) || close <= 0 || close > 1e9) return null;
      if (time >= start / 1000 && time < end / 1000) {
        if (closes.has(time)) return null;
        closes.set(time,close);
      }
    }
    const points = [...closes].sort((a,b)=>a[0]-b[0]);
    if (points.length < 2) return null;
    const expiresAt = points.at(-1)[0]*1000 + MINUTE + FRESHNESS;
    return expiresAt > clock() ? {points,expiresAt} : null;
  }
  const decimal = value => {
    const n = typeof value==='string' && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
    return n > 0 && n <= 1e9 ? n : null;
  };
  async function tick() {
    const now=clock();
    if (!tickInFlight && now >= nextTick) {
      tickInFlight=request('ticker').then(raw=>{
        const price=decimal(raw?.price), asOf=typeof raw?.time==='string'?Date.parse(raw.time):NaN;
        const time=clock(), id=raw?.trade_id;
        if (price!==null && Number.isSafeInteger(id) && id>0 && Number.isFinite(asOf) &&
            asOf<=time+5000 && asOf+LIVE_FRESHNESS>time &&
            (!latest || asOf>=latest.asOf && id>=latest.id)) {
          if (!latest || id>latest.id) latest={price,asOf,id};
          retry=1000;
        } else retry=Math.min(30_000,retry*2);
        nextTick=retry===1000?now+retry:time+retry;
      }).finally(()=>{tickInFlight=null;});
    }
    if(tickInFlight)await tickInFlight;
    if(!latest || latest.asOf+LIVE_FRESHNESS<=clock())return null;
    return {price:latest.price,asOf:latest.asOf,expiresAt:latest.asOf+LIVE_FRESHNESS};
  }
  async function trades() {
    const now=clock();
    if (!tapeFlight && now >= nextTape) {
      tapeFlight=request('trades',{limit:String(TAPE_PAGE)},readTradeId).then(rows=>{
        const time=clock();
        if (!Array.isArray(rows) || rows.length>TAPE_PAGE) {
          tapeRetry=Math.min(30_000,tapeRetry*2);
          nextTape=time+tapeRetry;
          tapeReady=false;
          return;
        }
        const unique=new Map(tape.filter(row=>row.ms>time-TAPE_AGE).map(row=>[row.fill.id,row]));
        // Exchange pages arrive newest-first; reverse for stable ordering on equal timestamps.
        for (const raw of rows.slice().reverse()) {
          const row=projectFill(raw,time);
          if (row && !unique.has(row.fill.id)) unique.set(row.fill.id,row);
        }
        tape=[...unique.values()].sort((a,b)=>a.ms-b.ms || a.subsecond.localeCompare(b.subsecond)).slice(-TAPE_ROWS);
        tapeRetry=TAPE_POLL;
        nextTape=time+TAPE_POLL;
        tapeReady=true;
      }).finally(()=>{tapeFlight=null;});
    }
    if (tapeFlight) await tapeFlight;
    return tapeReady ? {trades:tape.filter(row=>row.ms>clock()-TAPE_AGE).map(row=>row.fill)} : null;
  }
  function daily(stats) {
    const open=decimal(stats?.open), last=decimal(stats?.last), high=decimal(stats?.high), low=decimal(stats?.low);
    // Use the rolling stats snapshot's own open and last, not a mismatched ticker or short candles.
    return open!==null&&last!==null&&high!==null&&low!==null&&low<=last&&last<=high ? {change:(last-open)/open*100,high,low} : null;
  }
  return {tick,trades,async get() {
    const now = clock();
    if (!inFlight && now >= nextAttempt) {
      nextAttempt = Math.floor(now/MINUTE)*MINUTE+MINUTE;
      inFlight = Promise.all([history(now),request('stats'),tick()])
        .then(([chart,stats,trade])=>{
          const day=daily(stats), dayExpiresAt=now+FRESHNESS;
          snapshot={chart:chart??snapshot?.chart,day,dayExpiresAt,
            quote:trade?{...trade,expiresAt:trade.asOf+FRESHNESS,day}:null};
        })
        .finally(()=>{inFlight=null;});
    }
    if (inFlight) await inFlight;
    const time=clock();
    const chart=snapshot?.chart?.expiresAt>time?snapshot.chart:null;
    const quote=snapshot?.quote?.expiresAt>time?snapshot.quote:null;
    const day=snapshot?.dayExpiresAt>time&&snapshot.day?{...snapshot.day,expiresAt:snapshot.dayExpiresAt}:null;
    return chart||quote||day?{points:[],expiresAt:0,...chart,quote,day}:null;
  }};
}
