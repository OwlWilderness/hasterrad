'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const corePath = path.join(__dirname, '../public/assets/asteroids-core.js');
assert.ok(fs.existsSync(corePath), 'Asteroids simulation must exist (scaffold RED)');
const { createGame } = require(corePath);
const game = createGame({ random: () => 0.4 });
assert.equal(game.state.mode, 'ready');
game.start();
assert.equal(game.state.mode, 'playing');
assert.equal(game.state.lives, 3);
assert.equal(game.state.wave, 1);
assert.equal(game.state.rocks.length, 4);
const angle = game.state.ship.angle;
game.step(1 / 60, { right: true, thrust: true, fire: true });
assert.ok(game.state.ship.angle > angle, 'rotation');
assert.ok(Math.hypot(game.state.ship.vx, game.state.ship.vy) > 0, 'thrust');
assert.equal(game.state.bullets.length, 1, 'fire');
const ship = game.state.ship;
ship.x = game.state.width - 1; ship.vx = 200;
game.step(1 / 60);
assert.ok(ship.x < 10, 'screen wrap');
const x = ship.x;
game.pause(); game.step(0.1, { thrust: true });
assert.equal(ship.x, x, 'pause freezes simulation');
game.pause();
assert.equal(game.state.mode, 'playing');
console.log('PASS: start, rotation, thrust, firing, wrap, pause');
// Controlled real simulation fixtures, not browser-only cheats.
function target(size = 3, x = 250, y = 200) {
  return { x, y, vx: 0, vy: 0, size, radius: [0, 14, 27, 49][size], angle: 0, spin: 0, vertices: Array(11).fill(1) };
}
function hit(size) {
  game.state.rocks = [target(size)];
  game.state.bullets = [{ x: 250, y: 200, vx: 0, vy: 0, life: 1 }];
  game.step(1 / 120);
}
hit(3);
assert.equal(game.state.rocks.length, 2, 'large rock splits into two');
assert.ok(game.state.rocks.every(r => r.size === 2));
assert.equal(game.state.score, 20);
hit(2); assert.equal(game.state.score, 70);
hit(1); assert.equal(game.state.score, 170);
assert.equal(game.state.rocks.length, 0);
for (let i = 0; i < 160; i++) game.step(1 / 120);
assert.equal(game.state.wave, 2, 'cleared field advances wave');
assert.equal(game.state.rocks.length, 5);
for (let remaining = 2; remaining >= 0; remaining--) {
  game.state.ship.invulnerable = 0;
  game.state.rocks = [target(1, game.state.ship.x, game.state.ship.y)];
  game.step(1 / 120);
  assert.equal(game.state.lives, remaining, 'collision consumes one life');
  if (remaining > 0) {
    assert.ok(game.state.ship.invulnerable > 0);
    game.state.rocks = [target(1, game.state.ship.x, game.state.ship.y)];
    game.step(1 / 120);
    assert.equal(game.state.lives, remaining, 'spawn shield blocks repeated death');
  }
}
assert.equal(game.state.mode, 'gameover');
assert.equal(game.state.highScore, 170);
game.start(); assert.equal(game.state.score, 0); assert.equal(game.state.highScore, 170);
const oldX = game.state.ship.x;
game.step(1 / 120, { hyperspace: true });
assert.notEqual(game.state.ship.x, oldX, 'hyperspace relocates ship');
assert.ok(game.state.ship.hyperCooldown > 0);
const hyperX = game.state.ship.x;
game.step(1 / 120, { hyperspace: true });
assert.equal(game.state.ship.x, hyperX, 'hyperspace has cooldown');
// Toroidal collision: opposite screen edges are adjacent.
game.state.ship.invulnerable = 0; game.state.ship.x = 2; game.state.ship.y = 200;
game.state.rocks = [target(1, game.state.width - 2, 200)];
game.step(1 / 120); assert.equal(game.state.lives, 2);
console.log('PASS: splitting, score, waves, lives, shield, gameover/restart, high score, hyperspace, edge collision');

// Baseline fire is an edge, not a held-level repeat or finite ammunition.
const firing = createGame({ random: () => 0.4 });
firing.start(); firing.state.rocks = [target(1, 50, 50)];
function ticks(count, input = {}) { for (let i = 0; i < count; i++) firing.step(1 / 120, input); }
ticks(1, { fire: true });
assert.equal(firing.state.bullets.length, 1, 'first press fires once');
ticks(35, { fire: true });
assert.equal(firing.state.bullets.length, 1, 'holding does not repeat before upgrade');
ticks(100, { fire: true });
assert.equal(firing.state.bullets.length, 0, 'holding past expiration must not retrigger');
for (let i = 1; i <= 4; i++) {
  ticks(1); ticks(1, { fire: true });
  assert.equal(firing.state.bullets.length, i, 'each distinct press fires immediately');
}
ticks(1); ticks(1, { fire: true });
assert.equal(firing.state.bullets.length, 4, 'four active bullets is the cap');
firing.state.bullets[0].life = 0;
ticks(2, { fire: true });
assert.equal(firing.state.bullets.length, 3, 'freed slot does not retrigger a consumed press');
ticks(1); ticks(1, { fire: true });
assert.equal(firing.state.bullets.length, 4, 'new press reuses a freed slot');
console.log('PASS: tap edges, hold/expiration, immediate repress, four-live cap and slot reuse');

function earnTo(score) {
  while (firing.state.score < score) {
    firing.state.rocks = [target(1)];
    firing.state.bullets = [{ x: 250, y: 200, vx: 0, vy: 0, life: 1 }];
    ticks(1);
  }
  firing.state.rocks = [target(1, 50, 50)];
  firing.state.bullets = [];
  firing.state.ship.cooldown = 0;
}
firing.start(); earnTo(5000);
ticks(36, { fire: true });
assert.equal(firing.state.bullets.length, 1, 'score alone cannot unlock automatic fire at level 1');
function advanceLevel() {
  const previous = firing.state.wave;
  firing.state.rocks = []; firing.state.bullets = [];
  ticks(145);
  assert.equal(firing.state.wave, previous + 1, 'clearing the field advances the existing level');
  firing.state.rocks = [target(1, 50, 50)];
  firing.state.bullets = []; firing.state.ship.cooldown = 0;
}
advanceLevel();
firing.state.score = 0;
ticks(36, { fire: true });
assert.equal(firing.state.bullets.length, 2, 'level 2 unlocks held automatic fire without points');
const normalCooldown = firing.state.ship.cooldown;
firing.pause();
const paused = JSON.stringify(firing.state);
ticks(60, { fire: true });
assert.equal(JSON.stringify(firing.state), paused, 'pause freezes bullets and fire cooldown');
firing.pause(); ticks(100, { fire: true });
assert.ok(firing.state.bullets.length > 0 && firing.state.bullets.length <= 4, 'auto refills expired slots within cap');
advanceLevel(); advanceLevel();
firing.state.score = 5000; ticks(36, { fire: true });
assert.equal(firing.state.bullets.length, 2, 'score alone cannot unlock faster fire at level 4');
advanceLevel(); firing.state.score = 0; ticks(36, { fire: true });
assert.equal(firing.state.bullets.length, 3, 'level 5 fires faster without points over same interval');
assert.ok(firing.state.ship.cooldown < normalCooldown, 'faster cooldown is meaningfully shorter');
for (let i = 0; i < 180; i++) {
  ticks(1, { fire: true });
  assert.ok(firing.state.bullets.length <= 4, 'rapid auto never exceeds four live bullets');
}
firing.state.ship.invulnerable = 0;
firing.state.rocks = [target(1, firing.state.ship.x, firing.state.ship.y)];
ticks(1);
assert.equal(firing.state.lives, 2);
firing.state.rocks = [target(1, 50, 50)]; firing.state.bullets = [];
ticks(36, { fire: true });
assert.ok(firing.state.bullets.length >= 3, 'upgrade survives losing a ship');
firing.start(); firing.state.rocks = [target(1, 50, 50)];
ticks(36, { fire: true });
assert.equal(firing.state.bullets.length, 1, 'new run resets to tap fire');
assert.equal(firing.state.highScore, 5000, 'restart retains earned high score');
console.log('PASS: level 2/5 unlocks, score-only refusal, faster cadence, auto cap/refill, pause, life retention and new-run reset');
