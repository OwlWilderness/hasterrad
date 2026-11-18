import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const core=require('../../hasterrad-game/source/api/public/assets/asteroids-core.js');

test('a server-issued seed and quantized controls reproduce the exact game state',()=>{
  const play=seed=>{
    const game=core.createGame();game.state.width=780;game.state.height=620;game.start(seed);
    for(let tick=0;tick<2400;tick++){
      const controls=core.decodeInput(core.encodeInput({targetAngle:tick%200<100?1.2:-2.4,thrust:tick%240/240,fire:tick%17<8,firePressed:tick%17===0,hyperspace:tick===800}));
      game.step(1/120,controls);
    }
    return {score:game.state.score,wave:game.state.wave,lives:game.state.lives,rocks:game.state.rocks.map(r=>[r.x,r.y,r.vx,r.vy])};
  };
  assert.deepEqual(play(12345),play(12345));
  assert.notDeepEqual(play(12345),play(12346));
});

test('replay resizing applies the same scaling to simulated bodies as the browser',()=>{
  const game=core.createGame();game.state.width=780;game.state.height=620;game.start(123);
  const x=game.state.rocks[0].x,y=game.state.rocks[0].y;
  core.resizeGame(game.state,390,310);
  assert.equal(game.state.rocks[0].x,x/2);
  assert.equal(game.state.rocks[0].y,y/2);
  assert.equal(game.state.width,390);
});
