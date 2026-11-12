import {connectorsForWallets} from '@rainbow-me/rainbowkit';
import {metaMaskWallet,walletConnectWallet,ledgerWallet,base,rainbowWallet,safeWallet} from '@rainbow-me/rainbowkit/wallets';
import {rainbowkitBurnerWallet} from 'burner-connector';

// Same factories/order as SE-2 main wagmiConnectors.tsx; no substitute signer.
export const upstreamWallets=[
 {id:'metaMask',name:'MetaMask',factory:metaMaskWallet},
 {id:'walletConnect',name:'WalletConnect',factory:walletConnectWallet},
 {id:'ledger',name:'Ledger',factory:ledgerWallet},
 {id:'base',name:'Base',factory:base},
 {id:'rainbow',name:'Rainbow',factory:rainbowWallet},
 {id:'safe',name:'Safe',factory:safeWallet},
];
export function walletPolicy({burnerWalletMode='disabled',targetNetworks=[1]}={}) {
 if(!['disabled','localNetworksOnly','allNetworks'].includes(burnerWalletMode))throw Error('Invalid burnerWalletMode');
 if(!Array.isArray(targetNetworks)||!targetNetworks.length||targetNetworks.some(id=>!Number.isSafeInteger(id)||id<1))throw Error('Invalid targetNetworks');
 const hasOnlyLocalTargetNetworks=targetNetworks.every(id=>id===31337);
 return {showBurner:burnerWalletMode!=='disabled'&&(burnerWalletMode==='allNetworks'||hasOnlyLocalTargetNetworks)};
}
export function createWalletConnectors(wallet) {
 const {chainId=1,targetNetworks=[chainId],projectId:rawProjectId='',rpcUrl,burnerWalletMode='disabled'}=wallet;
 if(chainId!==1||targetNetworks.length!==1||targetNetworks[0]!==1)throw Error('Wallet target networks are not supported by this backend');
 const {showBurner}=walletPolicy({burnerWalletMode,targetNetworks});
 const projectId=rawProjectId||'';
 if(projectId&&(!/^[a-fA-F0-9]{32}$/.test(projectId)||projectId==='3a8170812b534d0ff9d794f19a901d64'))throw Error('Configure your own registered WalletConnect project ID');
 const options={appName:'HASTERRAD',projectId};
 const available=[],gaps=[],factories=[];
 for(const entry of upstreamWallets){
  try {
   // RK factories determine whether the actual injected/mobile path needs WC.
   // Do not fabricate an ID to get a connector through this configuration gate.
   entry.factory(options);
   factories.push(entry.factory);available.push(entry.id);
  }catch(error){
   if(!projectId&&String(error.message).includes('No projectId found'))gaps.push({id:entry.id,name:entry.name,reason:'Requires a registered WalletConnect project ID for this connection path.'});
   else throw error;
  }
 }
 if(showBurner){
  if(!rpcUrl)gaps.push({id:'burnerWallet',name:'Burner Wallet',reason:'Requires an explicit public RPC URL; no default RPC fallback.'});
  else {
   // Official factory settings. LocalStorage is the upstream default. Merely
   // constructing factories never loads/generates a key. No auto reconnect.
   rainbowkitBurnerWallet.useSessionStorage=false;
   rainbowkitBurnerWallet.rpcUrls={[chainId]:rpcUrl};
   factories.push(rainbowkitBurnerWallet);available.push('burnerWallet');
  }
 }
 return {connectors:connectorsForWallets([{groupName:'Supported Wallets',wallets:factories}],options),available,gaps,showBurner};
}
