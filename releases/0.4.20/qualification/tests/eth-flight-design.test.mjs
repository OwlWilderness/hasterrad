import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

for(const mirror of ['public','api/public'])for(const route of ['index.html','asteroids.html'])test(`flight chart visuals stay inside the ETH module: ${mirror}/${route}`,()=>{
  const html=readFileSync(new URL(`../../hasterrad-game/source/${mirror}/${route}`,import.meta.url),'utf8');
  const strip=html.match(/<section id="eth-market-box"[^>]*hidden[^>]*>([\s\S]*?)<\/section>/);
  assert.ok(strip,'one market strip starts hidden before eligibility is known');
  assert.ok(html.indexOf('<main id="arcade"')<strip.index&&strip.index<html.indexOf('</main>'),'market strip is inside the playfield');
  assert.match(html.slice(html.indexOf('id="weapon-unlocks"'),strip.index),/<\/div>\s*<\/div>\s*$/,'market strip directly follows the HUD stats');
  assert.equal(html.match(/class="eth-legend"/g)?.length,1);
  assert.doesNotMatch(html, /id="eth-chart-key"/);
  assert.doesNotMatch(html.slice(0,html.indexOf('</header>')), /data-market-field|eth-market-box/);
  assert.doesNotMatch(strip[1],/<(?:a|button|input)\b|tabindex=/);
  const context=strip[1].match(/<p class="eth-context">([\s\S]*?)<\/p>/)?.[1];
  assert.ok(context,'one compact context line');
  assert.deepEqual([...context.matchAll(/class="sr-only">([^<]+)/g)].map(m=>m[1]),
    ['Coinbase','2h window','1m candles','1s ticker','RSI guides 25/75']);
  assert.equal(context.match(/<svg aria-hidden="true"/g)?.length,2,'local decorative candle and pulse glyphs');
  assert.equal(strip[1].match(/Coinbase/g)?.length,1);
  assert.deepEqual([...strip[1].matchAll(/<li><svg[^>]+><path data-trace="([^"]+)"[^>]+\/><\/svg><span aria-hidden="true">([^<]+)<\/span><span class="sr-only">([^<]+)<\/span><\/li>/g)].map(m=>m.slice(1)),
    [['price','$','Price in US dollars'],['rsi','RSI 14','Relative strength index, 14 periods'],
     ['rsiAvg','SMA 14','Simple moving average of RSI, 14 periods'],
     ['macd','MACD 12/26','Moving average convergence divergence, 12 and 26 periods'],['signal','Sig 9','MACD signal, 9 periods']]);
  assert.doesNotMatch(strip[1],/<time|as of/i);
  assert.equal(html.match(/id="utc-clock"/g)?.length,1);
  assert.match(html.slice(html.indexOf('</main>')),/<footer[^>]*>[\s\S]*<time id="utc-clock" hidden><\/time>[\s\S]*<\/footer>/);
  const plot=html.match(/<svg id="eth-chart"[^>]*>([\s\S]*?)<\/svg>/)?.[1];
  assert.ok(plot?.includes('class="eth-grid"'));
  assert.deepEqual([...plot.matchAll(/<line class="eth-rsi-guide" data-rsi-guide="(\d+)"[^>]*x2="1000"/g)].map(m=>m[1]),['75','25']);
  assert.ok(plot.indexOf('data-rsi-guide="25"')<plot.indexOf('class="eth-scroll"'),'guides are outside the scrolling group');
  assert.doesNotMatch(plot,/<(?:rect|text|title)\b/);
  assert.doesNotMatch(html,/SIMULATED|FLIGHT CHART|Flight telemetry/i);
});
