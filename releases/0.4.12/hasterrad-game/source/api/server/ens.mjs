// A reverse record alone is not an identity claim: verify the forward record too.
export async function confirmedEnsName(client,address){
  if(!/^0x[0-9a-fA-F]{40}$/.test(address))return null;
  try{
    const name=await client.getEnsName({address});
    if(typeof name!=='string'||name.length>64||! /^(?:[a-z0-9-]+\.)+eth$/.test(name))return null;
    const resolved=await client.getEnsAddress({name});
    return typeof resolved==='string'&&resolved.toLowerCase()===address.toLowerCase()?name:null;
  }catch{return null;}
}
