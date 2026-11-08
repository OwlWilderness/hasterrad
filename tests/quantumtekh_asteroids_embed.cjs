'use strict';
// Query-mode integration only; no browser/layout claim.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname,'../public');
const html = fs.readFileSync(path.join(root,'asteroids.html'),'utf8');
assert.match(html, /src="assets\/asteroids-embed.js"/,'Game must opt into compact embedded chrome (scaffold RED)');
const source = fs.readFileSync(path.join(root,'assets/asteroids-embed.js'),'utf8');
for (const search of ['', '?embedded=0', '?embedded=1', '?foo=1&embedded=1']) {
  const classes = new Set();
  vm.runInNewContext(source,{URLSearchParams,window:{location:{search},addEventListener(){}},document:{documentElement:{classList:{add:k=>classes.add(k)}}}});
  assert.equal(classes.has('arcade-embedded'),new URLSearchParams(search).get('embedded')==='1',search || 'Standalone retains chrome');
}
console.log('PASS: standalone chrome retained; embedded=1 opts into compact game layout. Simulated DOM only.');
