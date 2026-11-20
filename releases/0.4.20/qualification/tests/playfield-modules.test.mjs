import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlayfieldHost} from '../../hasterrad-game/source/public/assets/playfield-host.mjs';

const fixture=()=>{
  const field={children:[],prepend(root){this.children.unshift(root);root.remove=()=>this.children.splice(this.children.indexOf(root),1);}};
  const document={querySelector:selector=>selector==='[data-playfield-slot="backdrop"]'?field:null,
    createElement:()=>({dataset:{},setAttribute(){}})};
  return {field,host:createPlayfieldHost(document,{})};
};

// This same descriptor can be added to the built-in registry without a new HTML anchor.
const registration=(mount)=>({id:'test-beacon',slots:{backdrop:true},mount});

test('a third module gets an inert ambient root and unmounts without touching the game',()=>{
  const {field,host}=fixture();
  let mounted=0,cleaned=0,signal;
  const unregister=host.register(registration(context=>{
    mounted++;signal=context.signal;
    context.roots.backdrop.textContent='TEST BEACON';
    return ()=>{cleaned++;assert.equal(signal.aborted,true);};
  }));
  host.update({session:null});host.update({session:null});
  assert.equal(mounted,1);
  assert.equal(field.children.length,1);
  assert.equal(field.children[0].textContent,'TEST BEACON');
  assert.equal(field.children[0].inert,true);
  unregister();unregister();
  assert.equal(cleaned,1);
  assert.deepEqual(field.children,[]);
  host.update({session:null});assert.equal(mounted,1);
});

test('clearing removes the root before delayed work can complete',async()=>{
  const {field,host}=fixture();
  let resolve, signal, work;
  host.register(registration(context=>{
    signal=context.signal;
    work=new Promise(done=>{resolve=done;}).then(()=>{
      if(!signal.aborted) context.roots.backdrop.textContent='late text';
    });
    return ()=>{};
  }));
  host.update({session:null});
  const root=field.children[0];
  host.clear();
  assert.equal(signal.aborted,true);
  assert.deepEqual(field.children,[]);
  resolve();await work;
  assert.equal(root.textContent,undefined);
});
