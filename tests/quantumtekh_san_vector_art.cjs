'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const base = path.join(__dirname, '../public');
const paths = []; let current = []; let frame; let game;
const ctx = new Proxy({
  beginPath() { current = []; },
  moveTo(x, y) { current.push([x, y]); },
  lineTo(x, y) { current.push([x, y]); },
  stroke() { paths.push(current); },
  arc() {}, fill() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
  setTransform() {}, clearRect() {}, fillRect() {}, closePath() {}
}, { set(o, k, v) { o[k] = v; return true; } });
const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    id, hidden: false, disabled: false, textContent: '', tagName: id === 'start' ? 'BUTTON' : 'DIV',
    dataset: {}, classList: { add() {}, remove() {} }, listeners: {},
    addEventListener(type, cb) { this.listeners[type] = cb; }, setAttribute() {}, focus() {},
    getBoundingClientRect() { return { width: 900, height: 600 }; }, getContext() { return ctx; }
  });
  return elements.get(id);
}
const core = require(path.join(base, 'assets/asteroids-core.js'));
const sandbox = {
  AsteroidsCore: { createGame(opts) { game = core.createGame({ ...opts, random: () => 0.45 }); return game; } },
  document: { getElementById: element, querySelectorAll: () => [], addEventListener() {} },
  localStorage: { getItem: () => null, setItem() {} }, performance: { now: () => 0 },
  requestAnimationFrame(cb) { frame = cb; }, addEventListener() {}, devicePixelRatio: 1, Math, console
};
sandbox.window = sandbox;
vm.runInNewContext(fs.readFileSync(path.join(base, 'assets/asteroids.js'), 'utf8'), sandbox);
element('start').listeners.click();
game.state.rocks = [1, 2, 3].map((size, i) => ({ x: 150 + i * 150, y: 140, size,
  radius: [0, 14, 27, 49][size], angle: 0, vertices: Array(11).fill(1), vx: 0, vy: 0, spin: 0 }));
game.state.saucer = { x: 680, y: 140, size: 'large', radius: 23, vx: 0, vy: 0, cooldown: 9 };
frame(0);
const includesPath = (points) => paths.some(p => points.every(([x,y]) => p.some(([a,b]) => a === x && b === y)));
assert.ok(includesPath([[-13,-9],[-5,-9]]), 'player needs one distinct left earbud shell');
assert.ok(includesPath([[-13,9],[-5,9]]), 'player needs a mirrored right earbud shell');
assert.ok(includesPath([[-18,0],[18,0]]), 'player needs a connecting headset headband');
assert.ok(includesPath([[-23,-13],[23,-13]]), 'enemy large saucer becomes angular GT case');
assert.ok(includesPath([[-25,-14],[25,-14]]), 'large rock becomes Quantum charging case');
assert.ok(includesPath([[-31,-9],[-37,3],[-30,17]]), 'Quantum case needs the visible side earbud dock/wing');
assert.ok(includesPath([[-16,-3],[0,13],[16,-3]]), 'GAMETYPE needs a deep lower chevron, not a flying saucer');
assert.ok(includesPath([[-11,-4],[10,-4],[14,0],[10,4],[-11,4]]), 'Cortex needs an elongated inset face');
assert.ok(includesPath([[-23,0],[-18,0]]), 'Cortex needs a cable entry rather than a generic rectangle');
assert.ok(includesPath([[-6,-6],[2,-6],[7,-1],[4,6],[-3,7],[-8,2]]), 'single earbud needs a tapered six-facet shell');
assert.ok(includesPath([[-10,-7],[3,-12],[10,-8],[-10,-7],[2,-5],[3,-12]]), 'paired ship shells need visible triangular ridge facets');
assert.ok(includesPath([[-15,-8],[15,-8]]), 'medium rock becomes Hardwire Audio Cortex');
console.log('PASS: player headset, GT case, Quantum case, Hardwire Cortex, and earbud draw distinct product-inspired vectors');
