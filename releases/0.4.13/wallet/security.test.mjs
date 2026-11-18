import test from 'node:test';
import assert from 'node:assert/strict';
import {v4,v5} from 'uuid';
import {readFile} from 'node:fs/promises';

test('bundle records emitted input paths for vulnerability reachability review',async()=>{
  const manifest=JSON.parse(await readFile(new URL('./dist/bundle.json',import.meta.url)));
  assert.ok(Array.isArray(manifest.inputs),'missing emitted input provenance');
  assert.ok(manifest.inputs.length>0);
  assert.ok(manifest.inputs.every(x=>typeof x==='string'&&!x.startsWith('/')));
});

test('UUID v5 rejects undersized output buffers rather than partially writing',()=>{
  const buffer=new Uint8Array(8).fill(170);
  assert.throws(()=>v5('hasterrad',v5.DNS,buffer,4),RangeError);
  assert.deepEqual(buffer,new Uint8Array(8).fill(170));
});
test('UUID v4 and deterministic v5 remain usable by wallet consumers',()=>{
  assert.match(v4(),/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(v5('hasterrad',v5.DNS),v5('hasterrad',v5.DNS));
});
