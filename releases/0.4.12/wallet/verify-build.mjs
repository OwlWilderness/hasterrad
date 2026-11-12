// Verify a clean wallet build against the accepted release; never deploy it.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const manifest=JSON.parse(await readFile(path.join(root,'../hasterrad-game/source/public/artifact.json'),'utf8'));
for(const name of ['index.js','index.css','LICENSES.txt']){
  const actual=createHash('sha256').update(await readFile(path.join(root,'dist',name))).digest('hex');
  const expected=manifest.files[`assets/wallet/${name}`];
  if(actual!==expected)throw Error(`Wallet build differs from accepted release: ${name}`);
  console.log(`PASS ${name}: ${actual}`);
}
