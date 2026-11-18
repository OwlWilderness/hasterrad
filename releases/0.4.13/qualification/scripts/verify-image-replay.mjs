// Run inside the built linux/amd64 API image, with no network or auth secrets.
import {replayRun} from '/app/server/replay.mjs';
const settings={seed:3,width:780,height:620};
// Deterministic fixture from the native game core: no input, complete gameover.
const proof={ticks:2984,frames:[[0,0,-1,0,780,620]],score:0,wave:1,duration_ms:24867};
for(let attempt=0;attempt<3;attempt++){
  const result=await replayRun(settings,proof);
  if(result.mode!=='gameover'||result.steps!==proof.ticks||result.score!==proof.score)process.exit(1);
}
let tampered=false;
try{await replayRun(settings,{...proof,score:1});}catch(error){tampered=error.status===400;}
if(!tampered)process.exit(1);
console.log(JSON.stringify({verified:true,attempts:3,ticks:proof.ticks,tamperedRejected:true}));
