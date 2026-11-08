'use strict';
// Bounded Node DOM harness, NOT rendered/browser evidence.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = path.join(__dirname, '../public/assets/asteroids.js');
assert.ok(fs.existsSync(source), 'Canvas controller must exist (scaffold RED)');
const handlers = {};
const context = new Proxy({}, { get: (o, k) => o[k] || (() => {}), set: (o, k, v) => { o[k] = v; return true; } });
function element(id) {
  return { id, hidden: false, disabled: false, textContent: '', tagName: 'DIV', listeners: {},
    classList: { add() {}, remove() {}, toggle() {} }, dataset: {},
    addEventListener(k, cb) { this.listeners[k] = cb; }, setAttribute() {}, focus() {},
    getBoundingClientRect: () => ({ width: 1000, height: 650 }),
    getContext: () => context, setPointerCapture() {} };
}
const ids = ['space', 'arcade', 'overlay', 'pause', 'start', 'score', 'best', 'wave', 'lives',
  'message', 'game-title', 'subtitle', 'enter-hint', 'announcement', 'flight-status', 'storage-note', 'weapon-status', 'weapon-unlocks'];
const elements = Object.fromEntries(ids.map(id => [id, element(id)]));
elements.start.tagName = 'BUTTON';
const touch = ['left', 'right', 'thrust', 'fire', 'hyperspace'].map(action => Object.assign(element(action), { dataset: { action } }));
let frame, simulation;
const realCore = require('../public/assets/asteroids-core.js');
const sandbox = { AsteroidsCore: { createGame(options) {
    simulation = realCore.createGame({ ...options, random: () => 0.4 }); return simulation;
  } },
  document: { getElementById: id => elements[id], querySelectorAll: () => touch,
    addEventListener: (k, cb) => { handlers[k] = cb; }, hidden: false },
  localStorage: { getItem() { throw Error('sandbox storage denied'); }, setItem() { throw Error('sandbox storage denied'); } },
  devicePixelRatio: 2, performance: { now: () => 0 },
  requestAnimationFrame: cb => { frame = cb; },
  addEventListener: (k, cb) => { handlers[k] = cb; }, Math, console };
sandbox.window = sandbox;
vm.runInNewContext(fs.readFileSync(source, 'utf8'), sandbox);
assert.equal(typeof sandbox.AsteroidsDebug.snapshot, 'function');
assert.equal(sandbox.AsteroidsDebug.snapshot().mode, 'ready');
elements.start.listeners.click();
assert.equal(sandbox.AsteroidsDebug.snapshot().mode, 'playing');
assert.equal(elements.overlay.hidden, true);
function key(code, target = elements.space) {
  handlers.keydown({ code, target, repeat: false, preventDefault() {} });
}
key('ArrowUp'); key('Space'); frame(20); frame(40); frame(60);
assert.ok(sandbox.AsteroidsDebug.snapshot().bullets > 0);
assert.ok(Math.hypot(sandbox.AsteroidsDebug.snapshot().ship.vx, sandbox.AsteroidsDebug.snapshot().ship.vy) > 0);
key('KeyP'); assert.equal(sandbox.AsteroidsDebug.snapshot().mode, 'paused');
key('Space', elements.start); assert.equal(sandbox.AsteroidsDebug.snapshot().mode, 'paused', 'native button Space is not consumed');
key('KeyP', elements.start); assert.equal(sandbox.AsteroidsDebug.snapshot().mode, 'playing', 'P resumes from focused Resume button');
key('KeyP');
elements.start.listeners.click(); assert.equal(sandbox.AsteroidsDebug.snapshot().mode, 'playing');
handlers.blur(); assert.equal(sandbox.AsteroidsDebug.snapshot().mode, 'paused');
elements.start.listeners.click();
const before = sandbox.AsteroidsDebug.snapshot().ship.angle;
touch[1].listeners.pointerdown({ pointerId: 1, preventDefault() {} }); frame(80); frame(100);
assert.ok(sandbox.AsteroidsDebug.snapshot().ship.angle > before);
touch[1].listeners.pointerup({ pointerId: 1, preventDefault() {} });
const snapshot = sandbox.AsteroidsDebug.snapshot(); snapshot.ship.x = -999;
assert.notEqual(sandbox.AsteroidsDebug.snapshot().ship.x, -999, 'debug snapshot cannot mutate game');
console.log('PASS: controller boot, denied-storage fallback, start, keyboard thrust/fire, pause/resume, native button keys, blur pause, touch rotation, read-only debug');

let now = 100;
function advance(count = 1) { for (let i = 0; i < count; i++) { now += 10; frame(now); } }
function resetFlight() {
  simulation.state.mode = 'gameover'; elements.start.listeners.click();
  simulation.state.rocks = [{ x: 50, y: 50, vx: 0, vy: 0, radius: 14, size: 1, angle: 0, spin: 0, vertices: Array(11).fill(1) }];
}
const keyup = () => handlers.keyup({ code: 'Space' });
function repeat() { handlers.keydown({ code: 'Space', target: elements.space, repeat: true, preventDefault() {} }); }
const pointer = id => ({ pointerId: id, preventDefault() {} });
const fireButton = touch[3];
resetFlight();
key('Space'); keyup(); advance();
assert.equal(simulation.state.bullets.length, 1, 'quick Space tap between frames is not lost');
key('Space'); keyup(); key('Space'); keyup(); advance(2);
assert.equal(simulation.state.bullets.length, 3, 'two separate taps between frames each fire');
repeat(); advance(2);
assert.equal(simulation.state.bullets.length, 3, 'repeat event cannot create a new press');
key('Space'); advance();
assert.equal(simulation.state.bullets.length, 4);
advance(130);
assert.equal(simulation.state.bullets.length, 0, 'held Space never repeats after bullets expire');
repeat(); advance(); assert.equal(simulation.state.bullets.length, 0);
keyup(); key('Space'); advance(); assert.equal(simulation.state.bullets.length, 1);
key('KeyP'); key('KeyP', elements.start); repeat(); advance();
assert.equal(simulation.state.bullets.length, 1, 'pause/resume ignores stale keyboard autorepeat');
keyup(); key('Space'); key('KeyP'); key('KeyP', elements.start); advance();
assert.equal(simulation.state.bullets.length, 1, 'pause clears pending taps');
resetFlight();
fireButton.listeners.pointerdown(pointer(10)); fireButton.listeners.pointerup(pointer(10)); advance();
assert.equal(simulation.state.bullets.length, 1, 'quick touch tap between frames fires');
fireButton.listeners.pointerdown(pointer(11)); advance(30);
assert.equal(simulation.state.bullets.length, 2, 'touch hold stays single-shot');
fireButton.listeners.pointerdown(pointer(11)); advance();
assert.equal(simulation.state.bullets.length, 2, 'duplicate pointerdown does not invent a press');
fireButton.listeners.pointerdown(pointer(12)); advance();
assert.equal(simulation.state.bullets.length, 3, 'distinct second touch is a distinct press');
fireButton.listeners.pointercancel(pointer(11)); fireButton.listeners.lostpointercapture(pointer(12));
advance(110); assert.equal(simulation.state.bullets.length, 0);
fireButton.listeners.pointerdown(pointer(13)); advance();
assert.equal(simulation.state.bullets.length, 1, 'touch can fire after cancel/release');
handlers.blur(); elements.start.listeners.click(); advance(110);
assert.equal(simulation.state.bullets.length, 0, 'blur clears held touch and pending input');
console.log('PASS: quick/multiple Space and touch taps, autorepeat, four-live cap, hold expiry, pause/blur release and pointer cancellation');

resetFlight(); advance();
assert.match(elements['weapon-status'].textContent, /TAP FIRE.*4 LIVE MAX/);
assert.match(elements['weapon-unlocks'].textContent, /AUTO @ Level 2: LOCKED.*FASTER @ Level 5: LOCKED/);
simulation.state.score = 5000; simulation.state.highScore = 5000;
fireButton.listeners.pointerdown(pointer(19)); advance(30);
assert.equal(simulation.state.bullets.length, 1, 'score alone cannot unlock touch automatic fire');
assert.match(elements['weapon-status'].textContent, /TAP FIRE/);
fireButton.listeners.pointerup(pointer(19));
simulation.state.wave = 2; simulation.state.score = 0;
simulation.state.bullets = []; simulation.state.ship.cooldown = 0;
fireButton.listeners.pointerdown(pointer(20)); advance(30);
assert.equal(simulation.state.bullets.length, 2, 'level 2 unlocks touch hold without points');
assert.match(elements['weapon-status'].textContent, /AUTO FIRE.*HOLD/);
assert.match(elements['weapon-unlocks'].textContent, /AUTO @ Level 2: UNLOCKED.*FASTER @ Level 5: LOCKED/);
key('KeyP'); const frozen = JSON.stringify(simulation.state); advance(20);
assert.equal(JSON.stringify(simulation.state), frozen, 'touch auto freezes during pause');
key('KeyP', elements.start); simulation.state.bullets = []; advance(30);
assert.equal(simulation.state.bullets.length, 0, 'resume requires a new touch after input release');
simulation.state.wave = 4; simulation.state.score = 5000;
simulation.state.ship.cooldown = 0;
fireButton.listeners.pointerdown(pointer(22)); advance(30);
assert.equal(simulation.state.bullets.length, 2, 'score alone cannot unlock faster touch fire at level 4');
assert.match(elements['weapon-unlocks'].textContent, /FASTER @ Level 5: LOCKED/);
fireButton.listeners.pointerup(pointer(22));
simulation.state.wave = 5; simulation.state.score = 0;
simulation.state.bullets = []; simulation.state.ship.cooldown = 0;
fireButton.listeners.pointerdown(pointer(21)); advance(30);
assert.equal(simulation.state.bullets.length, 3, 'touch hold uses level 5 faster cadence without points');
assert.match(elements['weapon-status'].textContent, /RAPID AUTO FIRE/);
assert.match(elements['weapon-unlocks'].textContent, /FASTER @ Level 5: UNLOCKED/);
fireButton.listeners.pointerup(pointer(21)); advance(110);
assert.equal(simulation.state.bullets.length, 0, 'release stops upgraded automatic fire');
resetFlight(); advance();
assert.match(elements['weapon-status'].textContent, /TAP FIRE/);
assert.match(elements['weapon-unlocks'].textContent, /AUTO @ Level 2: LOCKED/);
assert.equal(simulation.state.highScore, 5000);
const html = fs.readFileSync(path.join(__dirname, '../public/asteroids.html'), 'utf8');
for (const id of ['weapon-status', 'weapon-unlocks']) assert.ok(html.includes(`id="${id}"`), `${id} is real visible markup`);
assert.match(html, /Level 2.*Level 5/);
assert.match(html, /<title>HASTERRAD · Quantumtekh<\/title>/);
assert.match(html, /<h1 id="game-title">HASTERRAD<\/h1>/);
assert.match(html, /class="hud-label">Level<\/span>/);
assert.ok(!html.includes('Hold fire for repeat shots.'), 'old unconditional repeat instructions removed');
console.log('PASS: visible threshold/status contract, touch auto/rapid/release/pause, upgrade reset and retained high score');

function wasd(code, letter, target = elements.space) {
  let prevented = false;
  handlers.keydown({ code, key: letter, target, repeat: false, preventDefault() { prevented = true; } });
  return prevented;
}
resetFlight();
const initialAngle = simulation.state.ship.angle;
assert.equal(wasd('KeyA', 'a'), true); advance(3);
assert.ok(simulation.state.ship.angle < initialAngle, 'A rotates left');
handlers.keyup({ code: 'KeyA' });
const leftAngle = simulation.state.ship.angle;
advance(2); assert.equal(simulation.state.ship.angle, leftAngle, 'A release stops rotation');
assert.equal(wasd('KeyD', 'D'), true); advance(3);
assert.ok(simulation.state.ship.angle > leftAngle, 'uppercase D rotates right via physical code');
handlers.keyup({ code: 'KeyD' });
assert.equal(wasd('KeyW', 'W'), true); advance(3);
assert.ok(Math.hypot(simulation.state.ship.vx, simulation.state.ship.vy) > 0, 'W thrusts');
handlers.keyup({ code: 'KeyW' });
const speedAfterW = Math.hypot(simulation.state.ship.vx, simulation.state.ship.vy);
advance(2);
assert.ok(Math.hypot(simulation.state.ship.vx, simulation.state.ship.vy) < speedAfterW, 'W release stops acceleration');
const beforeHyper = simulation.state.ship.x;
assert.equal(wasd('KeyS', 's'), true); advance();
assert.notEqual(simulation.state.ship.x, beforeHyper, 'S uses hyperspace, not braking');
assert.ok(simulation.state.ship.hyperCooldown > 0, 'S shares H recharge');
handlers.keyup({ code: 'KeyS' }); simulation.state.ship.hyperCooldown = 0;
advance(2); assert.equal(simulation.state.ship.hyperCooldown, 0, 'S release stops hyperspace');
wasd('KeyW', 'w'); wasd('KeyS', 'S'); handlers.blur();
assert.equal(wasd('KeyS', 's'), false, 'paused WASD does not cancel browser default');
elements.start.listeners.click();
simulation.state.ship.hyperCooldown = 0; simulation.state.ship.vx = 0; simulation.state.ship.vy = 0;
advance(3);
assert.equal(simulation.state.ship.hyperCooldown, 0, 'blur clears held S');
assert.equal(Math.hypot(simulation.state.ship.vx, simulation.state.ship.vy), 0, 'blur clears held W');
assert.equal(wasd('KeyS', 's', elements.start), false, 'native button focus preserves normal keys');
assert.match(html, /WASD/);
assert.match(html, /S \/ H/);
console.log('PASS: WASD lowercase/uppercase, rotate/thrust/S hyperspace, key release/blur, gameplay-only cancellation and native focus');

simulation.state.mode = 'gameover';
key('Enter', { tagName: 'SUMMARY' });
assert.equal(simulation.state.mode, 'gameover', 'native account details Enter must not start a flight');
let begun=0, resolveRun, saved=[];
sandbox.HasterradScores={start(){begun++;return {then(resolve){resolveRun=resolve;}};},finish(run,counters){saved.push({run,counters});}};
elements.start.listeners.click(); elements.start.listeners.click();
assert.equal(begun,1,'asynchronous account run admission locks duplicate start');
assert.equal(simulation.state.mode,'gameover');
resolveRun({id:'fixture-admitted-run',csrf:'fixture'});
assert.equal(simulation.state.mode,'playing');
simulation.state.time=9; simulation.state.killsBySize=[0,1,2,1];
simulation.state.lives=1; simulation.state.ship.invulnerable=0;
simulation.state.rocks=[{x:simulation.state.ship.x,y:simulation.state.ship.y,vx:0,vy:0,radius:49,size:3,angle:0,spin:0,vertices:Array(11).fill(1)}];
advance(3);
assert.equal(saved.length,1,'one finish per actual gameover transition');
assert.equal(saved[0].run.id,'fixture-admitted-run');
assert.equal(saved[0].counters.large,1); assert.equal(saved[0].counters.medium,2); assert.equal(saved[0].counters.small,1);
assert.ok(saved[0].counters.duration_ms>=9000);
console.log('PASS: native account details, async start lock and real controller gameover counter submission (simulated DOM)');
