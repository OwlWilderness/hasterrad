// Full dependency audit: no package, severity or emitted-code exceptions.
export function classify(audit){
 const total=audit?.metadata?.vulnerabilities?.total;
 if(!Number.isInteger(total)||total<0||!audit.vulnerabilities||typeof audit.vulnerabilities!=='object'||Array.isArray(audit.vulnerabilities))throw Error('Invalid audit response');
 if(total!==0||Object.keys(audit.vulnerabilities).length)throw Error('Audit findings: dependency updates required');
 return [];
}
