'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict');
const {createGame}=require('../public/assets/asteroids-core.js');
function fixture(size,variant,offset=0) {
  const g=createGame({random:()=>0.4}); g.start();
  g.state.rocks=[{size,radius:[0,14,27,49][size],x:200+offset,y:200,vx:0,vy:0,spin:0,angle:0}];
  g.state.saucer={size:variant,radius:variant==='large'?23:13,x:200,y:200,vx:0,vy:0,cooldown:1};
  return g;
}
for(const variant of ['large','small']) for(const size of [1,2,3]) {
  test(`${variant} enemy ship is destroyed once by rock size ${size}, without player credit`,()=>{
    const g=fixture(size,variant), rock=g.state.rocks[0];
    g.state.bullets=[{x:50,y:50,vx:10,vy:0,life:1}];
    g.state.saucerBullets=[{x:80,y:80,vx:10,vy:0,life:1}];
    g.step(1/120);
    assert.equal(g.state.saucer,null,'rock impact must destroy enemy ship');
    assert.equal(g.state.saucerTimer,12,'ordinary next-visit timer restarts');
    assert.equal(g.state.rocks.length,1); assert.equal(g.state.rocks[0],rock,'environmental collision does not split the rock');
    assert.equal(g.state.score,0); assert.equal(g.state.highScore,0);
    assert.deepEqual(g.state.saucerKills,{large:0,small:0}); assert.deepEqual(g.state.killsBySize,[0,0,0,0]);
    assert.equal(g.state.lives,3); assert.ok(g.state.ship.invulnerable>0,'existing player spawn shield is retained');
    assert.equal(g.state.bullets.length,1); assert.equal(g.state.saucerBullets.length,1,'already-fired shots continue');
    assert.ok(g.state.bullets[0].x>50); assert.ok(g.state.saucerBullets[0].x>80);
    const particles=g.state.particles.length; assert.ok(particles>0,'impact has a destruction burst');
    g.step(1/120); assert.equal(g.state.particles.length,particles,'one burst, not repeated deaths');
    assert.equal(g.state.saucer,null); assert.ok(g.state.saucerTimer<12);
  });
}
test('enemy ship retains ordinary movement when clear of rocks and freezes while paused',()=>{
  const g=fixture(3,'large',150); g.state.saucer.vx=110;
  g.pause(); const frozen=JSON.stringify(g.state); g.step(1/120);
  assert.equal(JSON.stringify(g.state),frozen);
  g.pause(); g.step(1/120);
  assert.ok(g.state.saucer && g.state.saucer.x>200,'no blanket saucer removal');
});
test('rock impacts include opposite toroidal edges and multiple rocks still produce one destruction',()=>{
  const g=fixture(1,'small'); g.state.saucer.x=2; g.state.rocks[0].x=g.state.width-2;
  g.state.rocks.push({...g.state.rocks[0]}); g.step(1/120);
  assert.equal(g.state.saucer,null); assert.equal(g.state.particles.length,16);
  assert.deepEqual(g.state.saucerKills,{large:0,small:0}); assert.equal(g.state.score,0);
});
