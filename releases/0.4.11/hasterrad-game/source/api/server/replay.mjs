import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {AuthError,requireAuth} from './store.mjs';

const workerPath=resolve(dirname(fileURLToPath(import.meta.url)),'replay-worker.mjs');
let active=0;
const dimension=n=>Number.isFinite(n)&&n>=180&&n<=4096&&Math.round(n*64)===n*64;
export function validArena(width,height){return dimension(width)&&dimension(height);}
export async function replayRun(settings,data){
 requireAuth(data&&Object.keys(data).sort().join(',')==='duration_ms,frames,score,ticks,wave',400,'replay_required');
 const {frames,ticks,score,wave,duration_ms}=data;
 requireAuth(Number.isInteger(ticks)&&ticks>=1020&&ticks<=72000&&Array.isArray(frames)&&frames.length>=1&&frames.length<=30000&&
   Number.isSafeInteger(score)&&score>=0&&Number.isInteger(wave)&&wave>=1&&wave<=1000&&Number.isInteger(duration_ms)&&duration_ms>=8500&&duration_ms<=600000,400,'invalid_replay');
 let prior=-1,resizes=0,width=settings.width,height=settings.height;
 for(const frame of frames){
   requireAuth(Array.isArray(frame)&&frame.length===6,400,'invalid_replay');
   const [tick,flags,angle,thrust,w,h]=frame;
   requireAuth(Number.isInteger(tick)&&tick>prior&&tick<ticks&&Number.isInteger(flags)&&flags>=0&&flags<=63&&
     Number.isInteger(angle)&&angle>=-1&&angle<=65535&&Number.isInteger(thrust)&&thrust>=0&&thrust<=255&&validArena(w,h),400,'invalid_replay');
   if(w!==width||h!==height){resizes++;width=w;height=h;}
   prior=tick;
 }
 requireAuth(frames[0][0]===0&&resizes<=64,400,'invalid_replay');
 requireAuth(active<2,503,'replay_busy');active++;
 try{
   const result=await new Promise((resolveResult,rejectResult)=>{
     // Run the same physics in a bounded interpreted subprocess: V8 JIT
     // diverges under linux/amd64 emulation, and Worker rejects --jitless.
     const child=fork(workerPath,[],{execArgv:['--jitless','--max-old-space-size=64'],stdio:['ignore','ignore','ignore','ipc']});
     let done=false;
     const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);child.kill();if(error)rejectResult(error);else resolveResult(value);};
     const timer=setTimeout(()=>finish(new AuthError(503,'replay_timeout')),5000);
     child.once('message',value=>finish(null,value));
     child.once('error',()=>finish(new AuthError(503,'replay_unavailable')));
     child.once('exit',()=>finish(new AuthError(503,'replay_unavailable')));
     child.send({...settings,frames,ticks},error=>{if(error)finish(new AuthError(503,'replay_unavailable'));});
   });
   requireAuth(result.mode==='gameover'&&result.steps===ticks&&result.score===score&&result.wave===wave&&result.duration_ms===duration_ms,400,'replay_mismatch');
   return result;
 }finally{active--;}
}
