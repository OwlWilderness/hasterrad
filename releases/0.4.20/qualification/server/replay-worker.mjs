import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const core=require('../public/assets/asteroids-core.js');
process.once('message',({seed,width,height,frames,ticks})=>{
const game=core.createGame();game.state.width=width;game.state.height=height;game.start(seed);
let at=0,controls,completed=0;
for(let tick=0;tick<ticks;tick++){
  if(frames[at]?.[0]===tick){
    const [,flags,angle,thrust,w,h]=frames[at++];
    if(w!==game.state.width||h!==game.state.height)core.resizeGame(game.state,w,h);
    controls=core.decodeInput([flags,angle,thrust]);
  }
  if(game.state.mode!=='playing')break;
  game.step(1/120,controls);completed++;
}
const state=game.state;
process.send({score:state.score,wave:state.wave,kills:state.killsBySize[3]+state.killsBySize[2]+state.killsBySize[1]+state.saucerKills.large+state.saucerKills.small,duration_ms:Math.round(state.time*1000),mode:state.mode,steps:completed},()=>process.exit(0));
});
