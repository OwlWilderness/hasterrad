'use strict';
const assert = require('node:assert/strict');
const core = require('../public/assets/asteroids-core.js');
const game = core.createGame({random:()=>0.5}); game.start();
assert.deepEqual(game.state.killsBySize, [0,0,0,0], 'run counters start at zero');
for (const size of [3,2,1]) {
  const r=game.state.rocks[0]; r.size=size; r.radius=49;
  game.state.bullets=[{x:r.x,y:r.y,vx:0,vy:0,life:1}];
  game.step(0,{});
}
assert.deepEqual(game.state.killsBySize, [0,1,1,1]);
assert.equal(game.state.score,170);
game.start(); assert.deepEqual(game.state.killsBySize,[0,0,0,0]);
console.log('PASS versioned score counters / reset (real core collisions)');
