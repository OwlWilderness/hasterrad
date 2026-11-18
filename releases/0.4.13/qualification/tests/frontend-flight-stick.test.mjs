import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {replayRun} from '../../hasterrad-game/source/api/server/replay.mjs';

function flight({scoreAdapter=null,stopAfter=0}={}){
  const handlers=new Map(),elements=new Map(),inputs=[],frames=[];
  let now=0,canvasHeight=844,canvasObserver;
  function element(id){
    if(elements.has(id))return elements.get(id);
    const callbacks=new Map();
    const el={id,hidden:false,disabled:false,style:{transform:''},classList:{add(){},remove(){}},
      addEventListener(name,fn){callbacks.set(name,fn);},setPointerCapture(){},
      setAttribute(){},focus(){},getBoundingClientRect(){
        return id==='flight-stick'?{left:0,top:0,right:140,bottom:140,width:140,height:140}:
          {left:0,top:0,right:390,bottom:canvasHeight,width:390,height:canvasHeight};
      },fire(name,properties={}){callbacks.get(name)?.({pointerId:1,clientX:70,clientY:70,preventDefault(){},...properties});}};
    elements.set(id,el);return el;
  }
  const fire=element('fire'),hyper=element('hyper');
  fire.dataset={action:'fire'};hyper.dataset={action:'hyperspace'};
  const document={getElementById:id=>elements.get(id)||element(id),
    querySelectorAll:selector=>selector==='[data-action]'?[fire,hyper]:[],
    addEventListener(name,fn){handlers.set(name,fn);},hidden:false};
  const ctx=new Proxy({}, {get:(_target,key)=>()=>{},set:()=>true});
  element('space').getContext=()=>ctx;
  const sandbox={document,localStorage:{getItem:()=>null,setItem(){}},HasterradScores:scoreAdapter,
    performance:{now:()=>now},requestAnimationFrame:fn=>frames.push(fn),
    matchMedia:()=>({matches:false}),devicePixelRatio:1,console,
    ResizeObserver:class {constructor(callback){canvasObserver=callback;} observe(){}},
    addEventListener(name,fn){handlers.set(name,fn);}};
  sandbox.window=sandbox;
  vm.createContext(sandbox);
  const asset=name=>readFileSync(fileURLToPath(new URL(`../../hasterrad-game/source/public/assets/${name}`,import.meta.url)),'utf8');
  vm.runInContext(asset('asteroids-core.js'),sandbox);
  const core=sandbox.AsteroidsCore;
  sandbox.AsteroidsCore={...core,createGame:opts=>{
    const game=core.createGame({...opts,random:()=>0.5});
    const original=game.step;
    game.step=(dt,input)=>{inputs.push({...input});original(dt,input);if(stopAfter&&inputs.length>=stopAfter)game.state.mode='gameover';};
    return game;
  }};
  vm.runInContext(asset('asteroids.js'),sandbox);
  element('start').fire('click');
  const pointer=(name,x,y)=>element('flight-stick').fire(name,{clientX:x,clientY:y});
  const step=()=>{now+=17;frames.shift()?.(now);return inputs.at(-1);};
  const action=(button,name,id=2)=>element(button).fire(name,{pointerId:id});
  const key=(name,code)=>handlers.get(name)?.({code,target:{tagName:'BODY'},repeat:false,preventDefault(){}});
  return {pointer,action,key,step,inputs,element,
    relayout:height=>{canvasHeight=height;canvasObserver?.();},
    snapshot:()=>sandbox.AsteroidsDebug.snapshot()};
}

test('canvas backing tracks a mobile viewport relayout without a window resize event',()=>{
  const f=flight(),canvas=f.element('space');
  assert.equal(canvas.height,844);
  f.relayout(600);
  assert.equal(canvas.height,600,'a changed canvas box must not stretch the old bitmap');
});

test('the normal and embedded pad are circles with a centered knob',()=>{
  const css=readFileSync(fileURLToPath(new URL('../../hasterrad-game/source/public/assets/asteroids.css',import.meta.url)),'utf8');
  assert.match(css,/\.flight-stick\s*\{[^}]*width:\s*140px;\s*height:\s*140px;[^}]*border-radius:\s*50%/);
  assert.match(css,/\.arcade-embedded \.flight-stick\s*\{[^}]*width:\s*112px;\s*height:\s*112px;[^}]*border-radius:\s*50%/);
  assert.match(css,/\.stick-knob\s*\{[^}]*left:\s*50%;\s*top:\s*50%/);
});

test('mobile Fire and Hyperspace are separate thumb-size round buttons',()=>{
  const css=readFileSync(fileURLToPath(new URL('../../hasterrad-game/source/public/assets/asteroids.css',import.meta.url)),'utf8');
  assert.match(css,/\.touch-controls \.fire\s*\{[^}]*width:\s*58px;[^}]*height:\s*58px;[^}]*border-radius:\s*50%/);
  assert.match(css,/\.touch-controls \.hyper\s*\{[^}]*width:\s*48px;[^}]*height:\s*48px;[^}]*border-radius:\s*50%/);
  assert.match(css,/\.arcade-embedded \.touch-controls \.fire\s*\{[^}]*width:\s*56px;[^}]*height:\s*56px/);
});

test('the circular joystick rests neutrally at its center',()=>{
  const f=flight();f.pointer('pointerdown',70,70);const input=f.step();
  assert.equal(input.targetAngle,undefined);
  assert.ok(!input.thrust);
  assert.equal(f.element('stick-knob').style.transform,'');
});

test('radial travel gives gentle thrust near center and more at the outer ring',()=>{
  const inner=flight();inner.pointer('pointerdown',70,70);inner.pointer('pointermove',70,55);
  const innerInput=inner.step(),innerSpeed=Math.hypot(inner.snapshot().ship.vx,inner.snapshot().ship.vy);
  const outer=flight();outer.pointer('pointerdown',70,70);outer.pointer('pointermove',70,5);
  const outerInput=outer.step(),outerSpeed=Math.hypot(outer.snapshot().ship.vx,outer.snapshot().ship.vy);
  assert.equal(typeof innerInput.thrust,'number');
  assert.ok(innerInput.thrust>0&&innerInput.thrust<0.35);
  assert.ok(outerInput.thrust>0.8&&outerInput.thrust<=1);
  assert.ok(innerSpeed<outerSpeed/2);
});

test('backward drag does not accelerate in the old forward direction while turning',()=>{
  const f=flight();f.pointer('pointerdown',70,70);f.pointer('pointermove',70,132);
  f.step();
  assert.ok(Math.hypot(f.snapshot().ship.vx,f.snapshot().ship.vy)<0.01);
  for(let i=0;i<65;i++)f.step();
  assert.ok(f.snapshot().ship.vy>0);
});

test('holding backward stick actually rotates the ship to face down',()=>{
  const f=flight();f.pointer('pointerdown',70,70);f.pointer('pointermove',70,132);
  for(let i=0;i<65;i++)f.step();
  assert.ok(Math.abs(f.snapshot().ship.angle-Math.PI/2)<0.05);
});

test('release and cancel clear steering and throttle',()=>{
  for(const event of ['pointerup','pointercancel','lostpointercapture']){
    const f=flight();f.pointer('pointerdown',70,70);f.pointer('pointermove',70,132);
    f.pointer(event,70,132);
    const input=f.step();
    assert.equal(input.targetAngle,undefined);
    assert.ok(!input.thrust);
    assert.equal(f.element('stick-knob').style.transform,'');
  }
});

test('dragging behind the ship requests a half-turn rather than dropping input',()=>{
  const f=flight();f.pointer('pointerdown',70,70);f.pointer('pointermove',70,132);
  const input=f.step();
  assert.ok(Math.abs(input.targetAngle-Math.PI/2)<0.02);
  assert.ok(f.element('stick-knob').style.transform);
});

test('Fire and Hyperspace remain independent of joystick pointer capture',()=>{
  const f=flight();f.pointer('pointerdown',70,70);f.pointer('pointermove',70,8);
  f.action('fire','pointerdown',2);f.action('hyper','pointerdown',3);
  const both=f.step();
  assert.equal(both.fire,true);assert.equal(both.hyperspace,true);
  assert.ok(f.inputs.some(x=>x.firePressed));assert.ok(both.thrust>0);
  f.pointer('pointerup',70,8);
  const after=f.step();
  assert.equal(after.targetAngle,undefined);assert.ok(!after.thrust);
  assert.equal(after.fire,true);assert.equal(after.hyperspace,true);
  f.action('fire','pointerup',2);f.action('hyper','pointercancel',3);
  const ended=f.step();assert.ok(!ended.fire&&!ended.hyperspace);
});

test('keyboard thrust remains full strength and independent of analog stick',()=>{
  const f=flight();f.pointer('pointerdown',70,70);f.pointer('pointermove',70,55);
  f.key('keydown','KeyW');
  const input=f.step();assert.equal(input.thrust,true);
  f.key('keyup','KeyW');
  const analog=f.step();assert.ok(analog.thrust>0&&analog.thrust<0.35);
});

test('signed-in flight sends replay controls and a server seed instead of kill counters',async()=>{
  const calls=[],f=flight({scoreAdapter:{start:(width,height)=>{calls.push({type:'start',width,height});return Promise.resolve({id:'fixture-run',seed:3,width,height});},
    finish:(run,data)=>{calls.push({type:'finish',run,data});return Promise.resolve();}},stopAfter:8});
  await Promise.resolve();await Promise.resolve();
  for(let i=0;i<20&&!calls.some(c=>c.type==='finish');i++)f.step();
  assert.equal(calls[0].type,'start');
  const saved=calls.find(c=>c.type==='finish');assert.ok(saved,'gameover should submit a replay');
  assert.equal(saved.run.seed,3);assert.equal(saved.data.ticks,8);
  assert.equal(saved.data.frames[0][0],0);
  assert.equal(saved.data.frames[0][4],calls[0].width);
  assert.equal(saved.data.frames[0][5],calls[0].height);
  assert.equal(typeof saved.data.score,'number');
  assert.equal('large' in saved.data,false,'client counters are not trusted as a finish proof');
});

test('real controller flight with a mobile relayout replays identically in the API verifier',async()=>{
  let issued,finished;
  const f=flight({scoreAdapter:{start:(width,height)=>{issued={seed:3,width,height};return Promise.resolve({...issued,id:'run'});},
    finish:(_run,data)=>{finished=data;return Promise.resolve();}}});
  await Promise.resolve();await Promise.resolve();
  for(let i=0;i<15000&&!finished;i++){
    if(i===100)f.relayout(600);
    f.step();
  }
  assert.ok(finished,'the real game should eventually reach gameover');
  assert.ok(finished.frames.some(frame=>frame[5]!==issued.height),'new viewport size must be in the proof');
  const result=await replayRun(issued,finished);
  assert.equal(result.score,finished.score);
  assert.equal(result.steps,finished.ticks);
});
