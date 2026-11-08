'use strict';
// Real embed module in a simulated origin-bound environment, not rendered QA.
const assert = require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../public/assets/asteroids-embed.js'),'utf8');
for (const embedded of [false,true]) {
  const handlers={}, classes=new Set(), posts=[]; let focuses=0;
  const parent={postMessage:(data,origin)=>posts.push({data,origin})};
  const window={parent,location:{origin:'https://quantumtekh.com',search:embedded?'?embedded=1':''},addEventListener:(type,cb,options)=>{(handlers[type] ||= []).push(cb);if(type==='keydown') assert.equal(options.capture,true);}};
  const document={documentElement:{classList:{add:k=>classes.add(k)}},getElementById:()=>({focus:()=>focuses++})};
  vm.runInNewContext(source,{window,document,URLSearchParams});
  assert.equal(classes.has('arcade-embedded'),embedded);
  if (!embedded) { assert.equal(Object.keys(handlers).length,0); continue; }
  assert.ok(handlers.message?.length,'embedded child must receive an authenticated parent focus command');
  const message=handlers.message[0];
  for(const [origin,sender] of [['https://evil.example',parent],['null',parent],['https://quantumtekh.com',{}]]) {
    message({origin,source:sender,data:{type:'hasterrad:focus'}});
    assert.equal(focuses,0,'wrong origin/source cannot focus the game');
  }
  message({origin:'https://quantumtekh.com',source:parent,data:null});
  assert.equal(focuses,0);
  message({origin:'https://quantumtekh.com',source:parent,data:{type:'hasterrad:focus'}});
  assert.equal(focuses,1,'legitimate exact homepage parent focuses Start');
  let prevented=false,stopped=false;
  handlers.keydown[0]({key:'Escape',preventDefault:()=>prevented=true,stopImmediatePropagation:()=>stopped=true});
  assert.ok(prevented && stopped,'Escape must close before the game pause handler');
  assert.equal(posts.at(-1).origin,'https://quantumtekh.com');
  assert.equal(posts.at(-1).data.type,'hasterrad:close');
}
console.log('PASS: child focus authenticates origin AND parent source; Escape close is capture-first and origin-targeted; standalone untouched.');
