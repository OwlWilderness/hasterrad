'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createGame } = require('../public/assets/asteroids-core.js');

function fixture(random = () => 0.5) {
  const game = createGame({ random });
  game.start();
  game.state.rocks = [{ x: 90, y: 90, vx: 0, vy: 0, size: 1, radius: 14, angle: 0, spin: 0, vertices: Array(11).fill(1) }];
  return game;
}
function ticks(game, n) { for (let i = 0; i < n; i++) game.step(1 / 120); }

test('target heading settles without endless rotation and keyboard steering stays intact', () => {
  const game = fixture();
  const initial = game.state.ship.angle;
  const target = initial + Math.PI / 2;
  for (let i = 0; i < 200; i++) game.step(1 / 120, { targetAngle: target });
  assert.ok(Math.abs(game.state.ship.angle - target) < 0.001, 'stick reaches intended quarter turn');
  const settled = game.state.ship.angle;
  ticks(game, 100);
  assert.equal(game.state.ship.angle, settled, 'neutral does not keep spinning');
  for (let i = 0; i < 200; i++) game.step(1 / 120, { targetAngle: target });
  assert.equal(game.state.ship.angle, settled, 'holding the stick cannot spin repeatedly');
  game.step(1 / 120, { left: true });
  assert.ok(game.state.ship.angle < settled, 'keyboard turn remains relative');
});

 test('a large saucer periodically enters and crosses the field', () => {
  const game = fixture();
  assert.equal(game.state.saucer, null);
  ticks(game, 1800);
  assert.equal(game.state.saucer.size, 'large');
  const x = game.state.saucer.x;
  ticks(game, 30);
  assert.notEqual(game.state.saucer.x, x);
});

test('player shots destroy both saucers and award arcade points with separate counters', () => {
  const game = fixture();
  assert.deepEqual(game.state.saucerKills, { large: 0, small: 0 });
  for (const [size, total] of [['large', 200], ['small', 1200]]) {
    game.state.saucerTimer = 0;
    game.step(1 / 120);
    assert.equal(game.state.saucer.size, size);
    const saucer = game.state.saucer;
    game.state.bullets = [{ x: saucer.x, y: saucer.y, vx: 0, vy: 0, life: 1 }];
    game.step(1 / 120);
    assert.equal(game.state.saucer, null);
    assert.equal(game.state.bullets.length, 0);
    assert.equal(game.state.score, total);
    assert.equal(game.state.highScore, total);
    assert.equal(game.state.saucerKills[size], 1);
    assert.deepEqual(game.state.killsBySize, [0, 0, 0, 0]);
  }
  game.start();
  assert.deepEqual(game.state.saucerKills, { large: 0, small: 0 });
  assert.equal(game.state.score, 0);
  assert.equal(game.state.highScore, 1200);
});

test('small saucer shoots more accurately toward the ship than large saucer', () => {
  const game = fixture(() => 0.75);
  game.state.ship.x = 600; game.state.ship.y = 400;
  const angles = {};
  for (const size of ['large', 'small']) {
    game.state.saucer = { size, x: 300, y: 400, vx: 0, vy: 0, radius: 20, cooldown: 0 };
    game.state.saucerBullets = [];
    game.step(1 / 120);
    assert.equal(game.state.saucerBullets.length, 1, `${size} fires`);
    const shot = game.state.saucerBullets[0];
    angles[size] = Math.abs(Math.atan2(shot.vy, shot.vx));
    assert.ok(shot.life > 0);
  }
  assert.ok(angles.small < angles.large, 'small saucer aim is closer to player');
});

test('saucer body and shots damage unshielded ship, but not shielded ship', () => {
  const game = fixture();
  const ship = game.state.ship;
  game.state.saucer = { size: 'large', x: ship.x, y: ship.y, vx: 0, vy: 0, radius: 23, cooldown: 10 };
  game.step(1 / 120);
  assert.equal(game.state.lives, 3);
  ship.invulnerable = 0;
  game.step(1 / 120);
  assert.equal(game.state.lives, 2);
  game.state.saucer = null;
  game.state.ship.invulnerable = 0;
  game.state.saucerBullets = [{ x: game.state.ship.x, y: game.state.ship.y, vx: 0, vy: 0, life: 1 }];
  game.step(1 / 120);
  assert.equal(game.state.lives, 1);
  assert.equal(game.state.saucerBullets.length, 0);
});

test('saucer timer, body and projectiles freeze on pause and clear on restart', () => {
  const game = fixture();
  game.state.saucerTimer = 0;
  game.step(1 / 120);
  game.state.saucerBullets = [{ x: 250, y: 250, vx: 100, vy: 0, life: 1 }];
  game.pause();
  const before = JSON.stringify(game.state);
  ticks(game, 100);
  assert.equal(JSON.stringify(game.state), before);
  game.start();
  assert.equal(game.state.saucer, null);
  assert.deepEqual(game.state.saucerBullets, []);
  assert.equal(game.state.saucerTimer, 12);
});

test('controller renders saucer vectors and includes kill counters in finish payload', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/assets/asteroids.js'), 'utf8');
  const strokes = [];
  const ctx = new Proxy({ stroke() { strokes.push(true); } }, { get(o, k) { return o[k] || (() => {}); } });
  const elements = new Proxy({}, { get(o, k) { return o[k] || (o[k] = {
    textContent: '', classList: { add() {}, remove() {} },
    addEventListener(name, cb) { this[name] = cb; }, focus() {}, setAttribute() {},
    getContext: () => ctx, getBoundingClientRect: () => ({ width: 1000, height: 650 })
  }); } });
  let frame, game, submission;
  const sandbox = {
    AsteroidsCore: { createGame(options) { game = createGame({ ...options, random: () => 0.5 }); return game; } },
    HasterradScores: { finish(_run, payload) { submission = payload; } },
    document: { getElementById: id => elements[id], querySelectorAll: () => [], addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} },
    performance: { now: () => 0 }, requestAnimationFrame(cb) { frame = cb; },
    addEventListener() {}, matchMedia: () => ({ matches: false }), Math, console
  };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox);
  game.start(); game.state.rocks = [];
  game.state.saucer = { size: 'large', x: 300, y: 200, radius: 23, vx: 0, vy: 0, cooldown: 10 };
  strokes.length = 0; frame(0);
  const withSaucer = strokes.length;
  game.state.saucer = null; strokes.length = 0; frame(0);
  assert.ok(withSaucer > strokes.length, 'saucer adds vector strokes');
  game.state.saucerKills = { large: 2, small: 1 };
  game.state.lives = 1; game.state.ship.invulnerable = 0;
  game.state.rocks = [{ x: game.state.ship.x, y: game.state.ship.y, vx: 0, vy: 0,
    radius: 49, size: 3, angle: 0, spin: 0, vertices: Array(11).fill(1) }];
  frame(20);
  assert.equal(submission.saucerLarge, 2);
  assert.equal(submission.saucerSmall, 1);
});

test('mobile joystick combines turn and thrust and clears on release, cancel, blur and pause', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/asteroids.html'), 'utf8');
  assert.match(html, /id="flight-stick"/);
  assert.match(html, /id="stick-knob"/);
  const css = fs.readFileSync(path.join(__dirname, '../public/assets/asteroids.css'), 'utf8');
  assert.match(css, /\.arcade-embedded \.flight-stick\s*\{/);
  assert.match(css, /\.flight-stick[^\{]*\{[^}]*border-radius:\s*\d+px\s+\d+px\s+\d+px\s+\d+px/s, 'forward-only semicircle');
  const source = fs.readFileSync(path.join(__dirname, '../public/assets/asteroids.js'), 'utf8');
  const handlers = {};
  const elements = new Proxy({}, { get(o, k) { return o[k] || (o[k] = {
    textContent: '', style: {}, classList: { add() {}, remove() {} },
    addEventListener(name, cb) { this[name] = cb; }, focus() {}, setAttribute() {},
    setPointerCapture(id) { this.captured = id; }, releasePointerCapture() {},
    getContext: () => new Proxy({}, { get: () => () => {} }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 120, height: 80, bottom: 80 })
  }); } });
  let frame, game;
  const sandbox = {
    AsteroidsCore: { createGame(options) { game = createGame({ ...options, random: () => 0.5 }); return game; } },
    document: { getElementById: id => elements[id], querySelectorAll: () => [],
      addEventListener(name, cb) { handlers[name] = cb; } },
    localStorage: { getItem: () => null, setItem() {} },
    performance: { now: () => 0 }, requestAnimationFrame(cb) { frame = cb; },
    addEventListener(name, cb) { handlers[name] = cb; },
    matchMedia: () => ({ matches: false }), Math, console
  };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox);
  game.start(); game.state.rocks = [{ x: 50, y: 50, vx: 0, vy: 0, size: 1, radius: 14, angle: 0, spin: 0, vertices: Array(11).fill(1) }];
  const stick = elements['flight-stick'];
  let now = 0;
  const tick = () => { now += 20; frame(now); };
  const event = (x, y, pointerId = 7) => ({ clientX: x, clientY: y, pointerId, preventDefault() {} });
  stick.pointerdown(event(60, 60));
  assert.equal(stick.captured, 7);
  const initial = game.state.ship.angle; tick();
  assert.equal(game.state.ship.angle, initial, 'deadzone neutral');
  stick.pointermove(event(100, 10)); tick();
  assert.ok(game.state.ship.angle > initial, 'diagonal right turns');
  assert.ok(Math.hypot(game.state.ship.vx, game.state.ship.vy) > 0, 'diagonal up thrusts');
  for (let i = 0; i < 120; i++) tick();
  const held = game.state.ship.angle;
  assert.ok(held - initial <= Math.PI / 2 + 0.01, 'held right is bounded to a quarter turn');
  for (let i = 0; i < 120; i++) tick();
  assert.equal(game.state.ship.angle, held, 'holding right does not spin indefinitely');
  stick.pointermove(event(60, 100)); tick();
  assert.equal(game.state.ship.angle, held, 'below forward arc is neutral, not reverse steering');
  stick.pointerup(event(100, 10));
  const stopped = game.state.ship.angle; tick(); assert.equal(game.state.ship.angle, stopped);
  stick.pointerdown(event(10, 60)); tick();
  assert.ok(game.state.ship.angle < stopped, 'left steers without thrust');
  stick.pointercancel(event(10, 60));
  const canceled = game.state.ship.angle; tick(); assert.equal(game.state.ship.angle, canceled);
  stick.pointerdown(event(100, 10)); handlers.blur();
  assert.equal(game.state.mode, 'paused');
  const frozen = game.state.ship.angle; tick(); assert.equal(game.state.ship.angle, frozen);
  game.pause(); tick(); assert.equal(game.state.ship.angle, frozen, 'no stale joystick after resume');
});
