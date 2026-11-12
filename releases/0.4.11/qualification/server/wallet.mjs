import {createPublicClient,http,getAddress,isAddress,parseAbi,hashMessage,isErc6492Signature,parseErc6492Signature,isErc8010Signature} from 'viem';import {mainnet} from 'viem/chains';import {createSiweMessage,parseSiweMessage} from 'viem/siwe';
import {AuthError,requireAuth} from './store.mjs';import {validateOrigin} from './app.mjs';
export async function walletHandler(ctx){
 const {options,origin,publicUrl,dev,store,providers,wallet,cookie,json,shape,csrf,body,exact}=ctx,config=options.wallet;
 const rpc=new URL(config.rpcUrl);validateOrigin(rpc.origin,dev);requireAuth(!rpc.hash,500,'invalid_rpc');
 if(config.publicRpcUrl){const url=new URL(config.publicRpcUrl);validateOrigin(url.origin,dev);requireAuth(!url.username&&!url.password&&!url.hash,500,'invalid_public_rpc');wallet.rpcUrl=url.href;}
 if(config.projectId){requireAuth(/^[a-fA-F0-9]{32}$/.test(config.projectId),500,'invalid_project_id');wallet.projectId=config.projectId;}
 const timeout=config.timeout??2000;requireAuth(Number.isInteger(timeout)&&timeout>=1&&timeout<=4000,500,'invalid_rpc_timeout');
 const client=createPublicClient({chain:mainnet,transport:http(config.rpcUrl,{timeout,retryCount:0})});
 const uri=origin+'/auth/wallet';providers.wallet=true;
 const verifyProof=async(saved,signature)=>{
  const now=store.clock(),parsed=parseSiweMessage(saved.message);
  requireAuth(parsed.domain===publicUrl.host&&parsed.uri===uri&&parsed.version==='1'&&parsed.chainId===1&&parsed.nonce===saved.nonce&&parsed.address===saved.address&&parsed.issuedAt?.getTime()<=now+30000&&parsed.expirationTime?.getTime()>now&&parsed.expirationTime.getTime()-parsed.issuedAt.getTime()===86400000);
  try{
   requireAuth(await client.getChainId()===1);
   const code=await client.getCode({address:saved.address});
   requireAuth(await client.verifySiweMessage({message:saved.message,signature,address:saved.address,domain:publicUrl.host,nonce:saved.nonce,time:new Date(now)}));
   // viem auto verification can recover an EOA after a failing contract call.
   // Current ERC1271 authority must ALSO approve deployed/delegated accounts.
   if(code&&code!=='0x'){
    const inner=isErc6492Signature(signature)?parseErc6492Signature(signature).signature:signature;
    requireAuth(await client.readContract({address:saved.address,abi:parseAbi(['function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)']),functionName:'isValidSignature',args:[hashMessage(saved.message),inner]})==='0x1626ba7e');
   }
  }catch(error){if(error instanceof AuthError)throw error;throw new AuthError(401,'wallet_verification_failed');}
  requireAuth(parsed.expirationTime.getTime()>store.clock());return parsed;
 };
 const checking=new Map();
 // Only session reads call this (never static assets). Future privileged mutations
 // MUST call with fresh:true and check store.valid again at their atomic commit.
 ctx.checkWalletSession=async(row,{fresh=false}={})=>{
  const record=store.get('SELECT * FROM wallet_proofs WHERE session=?',row.id),now=store.clock();
  if(!record){store.run('UPDATE sessions SET revoked=1 WHERE id=?',row.id);return false;}
  if(!fresh&&record.checked<=now&&now-record.checked<60000)return store.valid(row);
  if(checking.has(row.id))return checking.get(row.id);
  requireAuth(checking.size<32,503,'wallet_verification_busy');
  const task=(async()=>{
   let valid=false;try{const proof=JSON.parse(record.proof);await verifyProof(proof,proof.signature);valid=true;}catch{}
   const current=store.get('SELECT * FROM sessions WHERE id=?',row.id);
   if(!valid){store.run('UPDATE sessions SET revoked=1 WHERE id=?',row.id);return false;}
   if(!store.valid(current))return false;
   store.run('UPDATE wallet_proofs SET checked=? WHERE session=?',store.clock(),row.id);return true;
  })();checking.set(row.id,task);try{return await task;}finally{checking.delete(row.id);}
 };
 return async({req,res,url,row})=>{
  if(req.method!=='POST'||!['/api/wallet/nonce','/api/wallet/message','/api/wallet/verify'].includes(url.pathname))return false;
  csrf(req,row);requireAuth(store.valid(row));store.rate('wallet:'+url.pathname+':'+row.family,10);const data=await body(req);
  if(url.pathname==='/api/wallet/nonce'){
   exact(data,[]);const issued=store.issue('wallet',row);json(res,200,{nonce:issued.secret,expiresAt:new Date(issued.expires).toISOString()});return true;
  }
  if(url.pathname==='/api/wallet/message'){
   exact(data,['nonce','address','chainId']);requireAuth(data.chainId===1&&typeof data.address==='string'&&isAddress(data.address),400,'invalid_wallet');const address=getAddress(data.address);
   const message=store.message(data.nonce,row,{address,chainId:1,nonce:data.nonce},()=>createSiweMessage({domain:publicUrl.host,address,statement:'Sign in to HASTERRAD. Signing this login message costs no gas and does not authorize a transaction or spending.',uri,version:'1',chainId:1,nonce:data.nonce,issuedAt:new Date(store.clock()),expirationTime:new Date(store.clock()+86400000)}));
   res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});res.end(message);return true;
  }
  exact(data,['message','signature']);requireAuth(typeof data.message==='string'&&typeof data.signature==='string',400,'invalid_body');
  const record=store.get("SELECT * FROM flows WHERE session=? AND kind='wallet' AND phase='message'",row.id);requireAuth(record);
  const saved=JSON.parse(record.data);requireAuth(data.message===saved.message);const flow=store.claim(saved.nonce,'wallet',row);
  // At most 6000 bytes, including factory calldata/wrappers. Request remains 16 KiB.
  requireAuth(/^0x(?:[a-fA-F0-9]{2}){1,6000}$/.test(data.signature),422,'unsupported_wallet_signature');
  requireAuth(!isErc8010Signature(data.signature),422,'unsupported_erc8010_signature');
  const parsed=await verifyProof(saved,data.signature);
  const session=store.finish(flow,{provider:'ethereum',id:'ethereum:1:'+saved.address.toLowerCase(),displayName:saved.address,address:saved.address,chainId:1},parsed.expirationTime.getTime(),{...saved,signature:data.signature});
  cookie(res,session.token);json(res,200,shape(session.row));return true;
 };
}
