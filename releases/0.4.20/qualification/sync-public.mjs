// Check the complete static inventory, or mirror and regenerate it with --write.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const src=fileURLToPath(new URL('../hasterrad-game/source/public/',import.meta.url));
const api=fileURLToPath(new URL('../hasterrad-game/source/api/public/',import.meta.url));
const write=process.argv[2]==='--write';
function files(root,sub='') {
  return readdirSync(join(root,sub),{withFileTypes:true}).flatMap(entry=>{
    const name=sub+entry.name;
    if(entry.isDirectory())return files(root,name+'/');
    assert.ok(entry.isFile(),`Unexpected non-file: ${name}`);
    return name==='artifact.json'?[]:[name];
  }).sort();
}
const names=files(src), hashes={};
for(const name of names){
  const bytes=readFileSync(join(src,name)), mirror=join(api,name);
  hashes[name]=createHash('sha256').update(bytes).digest('hex');
  if(write){mkdirSync(dirname(mirror),{recursive:true});writeFileSync(mirror,bytes);}
  assert.ok(bytes.equals(readFileSync(mirror)),`Public copies differ: ${name}`);
}
assert.deepEqual(files(api),names);
const manifest=JSON.stringify({files:hashes,format:1,mode:'auth-ui'},null,2)+'\n';
for(const root of [src,api]){
  const path=join(root,'artifact.json');
  if(write)writeFileSync(path,manifest);
  assert.equal(readFileSync(path,'utf8'),manifest);
}
console.log(`Verified both public trees and manifests: ${names.length} files per tree.`);
