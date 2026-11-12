// Run only after a successful pinned install. No environment/config embedding.
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
process.chdir(root);
const pkg=JSON.parse(await fs.readFile('package.json','utf8'));
const lock=JSON.parse(await fs.readFile('package-lock.json','utf8'));
for(const [name,version] of Object.entries({...pkg.dependencies,...pkg.devDependencies})) {
 if(lock.packages?.[`node_modules/${name}`]?.version!==version)throw Error(`Lock mismatch: ${name}`);
}
const result=await build({entryPoints:['src/index.jsx'],bundle:true,alias:{'@react-native-async-storage/async-storage':path.join(root,'vendor/async-storage-web-2.2.0/AsyncStorage.js')},splitting:false,format:'esm',platform:'browser',target:['es2022'],outdir:'dist',write:false,metafile:true,minify:true,legalComments:'eof',entryNames:'index',chunkNames:'chunks/[name]-[hash]',assetNames:'assets/[name]-[hash]',define:{'process.env.NODE_ENV':'"production"'},loader:{'.svg':'dataurl','.png':'dataurl','.woff2':'file'}});
for(const output of Object.values(result.metafile.outputs))if(output.imports.some(i=>i.external))throw Error('External runtime import not allowed: '+JSON.stringify(output.imports.filter(i=>i.external)));
const packages=new Map();
const included=new Set(Object.values(result.metafile.outputs).flatMap(output=>Object.entries(output.inputs).filter(([,info])=>info.bytesInOutput>0).map(([name])=>name)));
for(const input of included) {
 if(!input.includes('node_modules/'))continue;
 let dir=path.dirname(path.resolve(input));
 while(dir.startsWith(root)&&dir!==root) {
  try {const info=JSON.parse(await fs.readFile(path.join(dir,'package.json'),'utf8'));if(info.name&&info.version&&dir.endsWith(path.join('node_modules',...info.name.split('/')))){packages.set(dir,info);break;}}catch(error){if(error.code!=='ENOENT')throw error;}
  dir=path.dirname(dir);
 }
}
const supplements=JSON.parse(await fs.readFile('licenses/supplements.json','utf8'));
let licenses='HASTERRAD wallet island — bundled dependency notices\n\n';
const vendor=JSON.parse(await fs.readFile('vendor/async-storage-web-2.2.0/provenance.json','utf8'));
for(const [name,expected] of Object.entries(vendor.files)){
 const bytes=await fs.readFile(path.join('vendor/async-storage-web-2.2.0',name));
 if(createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('Vendor integrity mismatch: '+name);
}
licenses+=`=== ${vendor.package}@${vendor.version} (MIT; genuine published browser implementation) ===\nSource: ${vendor.source}\n${await fs.readFile('vendor/async-storage-web-2.2.0/LICENSE','utf8')}\n`;
packages.set(path.join(root,'vendor/async-storage-web-2.2.0'),{name:vendor.package,version:vendor.version,license:'MIT'});
for(const [dir,info] of [...packages.entries()].sort((a,b)=>a[1].name.localeCompare(b[1].name))) {
 const names=(await fs.readdir(dir)).filter(n=>/^(licen[sc]e|copying|notice)(\.|$)/i.test(n)).sort();
 if(!names.length){
  const supplement=supplements[`${info.name}@${info.version}`];
  if(!supplement?.files?.length)throw Error(`Missing bundled license text for ${info.name}; review before export`);
  licenses+=`\n=== ${info.name}@${info.version} (${JSON.stringify(info.license||'see text')}) ===\nPublished tarball omits license text; authentic upstream supplements follow.\n`;
  for(const file of supplement.files){
   const bytes=await fs.readFile(path.join('licenses',file.file));
   if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('Supplement integrity mismatch: '+file.file);
   licenses+=`Source: ${file.url}\nVersion-specific reference: ${file.versionSpecific?'yes':'NO; current upstream only; rights qualification remains OPEN'}\n${bytes.toString('utf8')}\n`;
  }
  continue;
 }
 licenses+=`\n=== ${info.name}@${info.version} (${JSON.stringify(info.license||'see text')}) ===\n`;
 for(const name of names){const stat=await fs.stat(path.join(dir,name));if(stat.isFile())licenses+=await fs.readFile(path.join(dir,name),'utf8')+'\n';}
}
const payload=new Map(result.outputFiles.map(file=>[path.relative(path.resolve('dist'),file.path),file.contents]));
payload.set('LICENSES.txt',Buffer.from(licenses));
if(!payload.has('index.js')||!payload.has('index.css'))throw Error('Missing entry JS/CSS');
const files={};
for(const [name,bytes] of [...payload].sort(([a],[b])=>a.localeCompare(b)))files[name]=createHash('sha256').update(bytes).digest('hex');
await fs.mkdir('dist'); // refuse to overlay a previous build
for(const [name,bytes] of payload){await fs.mkdir(path.dirname(path.join('dist',name)),{recursive:true});await fs.writeFile(path.join('dist',name),bytes);}
await fs.writeFile('dist/bundle.json',JSON.stringify({format:1,files,inputs:[...included].sort(),packages:[...packages.values()].map(p=>({name:p.name,version:p.version,license:p.license})).sort((a,b)=>a.name.localeCompare(b.name))},null,2)+'\n');
console.log(`Built ${payload.size} wallet files with ${packages.size} dependency notice entries`);
