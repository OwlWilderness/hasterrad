// Exact reviewed exclusions, never a severity-wide npm audit suppression.
const excluded=new Map([
 ['zod','https://github.com/advisories/GHSA-mrhx-c7xc-m3w5'],
 ['deepmerge','https://github.com/advisories/GHSA-gcqx-w48m-w2h4'],
]);
export function classify(audit,inputs){
 if(!audit?.vulnerabilities||typeof audit.vulnerabilities!=='object'||!Array.isArray(inputs))throw Error('Invalid audit/provenance response');
 const findings=[];
 for(const [name,item] of Object.entries(audit.vulnerabilities)){
  if(!Array.isArray(item.via)||!Array.isArray(item.nodes))throw Error('Invalid audit entry');
  for(const advisory of item.via){
   if(typeof advisory==='string'){
    if(!audit.vulnerabilities[advisory])throw Error('Invalid dependency advisory reference');
    continue; // This package inherits risk; direct advisory is checked separately.
   }
   if(excluded.get(name)!==advisory.url)throw Error(`Unreviewed advisory: ${name} ${advisory.url}`);
   const emitted=inputs.filter(input=>item.nodes.some(node=>input.startsWith(node+'/')));
   if(emitted.length)throw Error(`Vulnerable input emitted: ${name}`);
   findings.push({name,advisory:advisory.url,disposition:'not-emitted',nodes:item.nodes});
  }
 }
 return findings;
}
