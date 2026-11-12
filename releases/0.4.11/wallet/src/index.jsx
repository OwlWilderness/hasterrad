import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {WagmiProvider, createConfig, http, custom, useAccount, useDisconnect} from 'wagmi';
import {createWalletConnectors} from './connectors.mjs';
// Import the owning module directly: the wagmi re-export loses eager chain
// initialization in this pinned, lazy-connector esbuild graph.
import {mainnet} from 'viem/chains';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {RainbowKitProvider, RainbowKitAuthenticationProvider, ConnectButton, createAuthenticationAdapter, darkTheme, useConnectModal, useAccountModal} from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';

// SE-2 provider/connector composition, adapted to a lazy client-only island.
// No faucet, transaction hooks, ENS/balance polling, or demo project ID.
export async function mount(node, auth, {openOnMount=false}={}) {
  const session=auth.state.session||auth.config;
  if(!session?.providers.wallet||session.wallet.chainId!==1)throw Error('Wallet login unavailable');
  const {rpcUrl}=session.wallet;
  const {connectors,gaps,showBurner}=createWalletConnectors(session.wallet);
  const transport=rpcUrl?http(rpcUrl):custom({async request(){throw Error('Public RPC is not configured');}});
  const config=createConfig({chains:[mainnet],connectors,transports:{[mainnet.id]:transport},multiInjectedProviderDiscovery:true});
  const query=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});
  const adapter=createAuthenticationAdapter({
    getNonce:()=>auth.getNonce(),
    createMessage:fields=>auth.createMessage(fields),
    getMessageBody:({message})=>message,
    verify:proof=>auth.verify(proof),
    signOut:()=>auth.logout(),
  });
  let openChooser;
  function ChooserBridge() {
    const {openConnectModal}=useConnectModal(), {openAccountModal}=useAccountModal();
    const account=useAccount();
    const open=account.isConnected?openAccountModal:openConnectModal;
    useEffect(()=>{openChooser=open;return()=>{openChooser=undefined;};},[open]);
    useEffect(()=>{if(openOnMount&&open){openOnMount=false;open();}},[open]);
    return null;
  }
  function Controls() {
    const account=useAccount(), {disconnectAsync}=useDisconnect();
    const [state,setState]=useState(auth.state), [error,setError]=useState(null);
    useEffect(()=>{const prior=auth.changed;const listener=s=>{prior(s);setState(s);};auth.changed=listener;setState(auth.state);return()=>{auth.changed=prior;};},[]);
    useEffect(()=>{auth.observe({status:account.status,address:account.address,chainId:account.chainId});},[account.status,account.address,account.chainId]);
    useEffect(()=>{query.clear();},[state.session?.user?.id,account.address,account.chainId]);
    const signStatus=state.status==='loading'?'loading':state.session?.authenticated&&state.session.user.provider==='ethereum'?'authenticated':'unauthenticated';
    return <RainbowKitAuthenticationProvider adapter={adapter} status={signStatus}>
      <RainbowKitProvider theme={darkTheme()} modalSize="compact" appInfo={{appName:'HASTERRAD'}}>
        <ChooserBridge/>
        <p>{account.isConnected?`Connected: ${account.address}. ${signStatus==='authenticated'?'Server-verified wallet login.':'Not signed in. A separate login signature is required.'}`:'Connect a wallet, then explicitly sign the login message.'}</p>
        <p>Connection is not verified login. Signature eligibility is checked by the account service on the configured chain; a listed wallet is not a guarantee of successful verification.</p>
        {gaps.map(gap=><p role="status" key={gap.id}>{gap.name}: {gap.reason} Other configured wallet paths and guest play remain available.</p>)}
        {showBurner&&<p role="note">Burner Wallet is a disposable browser-local wallet, not secure custody. Its unencrypted private key is stored in this origin's localStorage and is accessible to scripts on this origin. Clearing site data loses it; signing out does not erase it. Do not deposit funds or use it for valuable assets. Selecting Burner Wallet creates or reuses it locally. Login signing happens only after you explicitly choose the separate sign-in action.</p>}
        <ConnectButton label="Connect wallet" accountStatus="address" chainStatus="name" showBalance={false}/>
        {account.isConnected&&<button type="button" onClick={async()=>{try{await auth.logout();await disconnectAsync();await auth.refresh();}catch(_){setError('Server sign out not confirmed. Retry before signing in again.');}}}>Disconnect and sign out</button>}
        {(error||state.error)&&<p role="alert">{error||state.error}</p>}
        <p>Ethereum mainnet login only. Connecting is not authentication. No transactions, funds or persistent account scores.</p>
      </RainbowKitProvider>
    </RainbowKitAuthenticationProvider>;
  }
  const root=createRoot(node);
  root.render(<WagmiProvider config={config} reconnectOnMount={false}><QueryClientProvider client={query}><Controls/></QueryClientProvider></WagmiProvider>);
  return {open:()=>openChooser?.(),dispose:()=>root.unmount()};
}
