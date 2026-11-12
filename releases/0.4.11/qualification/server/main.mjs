import {createApp} from './app.mjs';import {fileURLToPath} from 'node:url';import {resolve} from 'node:path';
export function configFromEnv(env=process.env){
 const config={origin:env.HASTERRAD_PUBLIC_ORIGIN??'https://hasterrad.quantumtekh.com',dev:env.HASTERRAD_DEV==='1',dbPath:env.HASTERRAD_DB_PATH??'private/auth.sqlite',staticDir:env.HASTERRAD_STATIC_DIR,connectOrigins:(env.HASTERRAD_CONNECT_ORIGINS??'').split(/\s+/).filter(Boolean),inlineStyles:env.HASTERRAD_INLINE_STYLES==='1'};
 if(env.HASTERRAD_URBIT_ENABLED==='1'&&env.HASTERRAD_URBIT_PUBLIC_ORIGIN&&env.HASTERRAD_URBIT_VERIFIER_ORIGIN&&env.HASTERRAD_URBIT_SHIP)config.urbit={publicOrigin:env.HASTERRAD_URBIT_PUBLIC_ORIGIN,verifierOrigin:env.HASTERRAD_URBIT_VERIFIER_ORIGIN,ship:env.HASTERRAD_URBIT_SHIP};
 if(env.HASTERRAD_REMILIANET_ENABLED==='1'&&env.HASTERRAD_REMILIANET_CLIENT_ID)config.oidc={clientId:env.HASTERRAD_REMILIANET_CLIENT_ID,failureDiagnostics:env.HASTERRAD_REMILIANET_FAILURE_DIAGNOSTICS==='1'};
 if(env.HASTERRAD_WALLET_AUTH_ENABLED==='1'&&env.HASTERRAD_AUTH_RPC_URL)config.wallet={rpcUrl:env.HASTERRAD_AUTH_RPC_URL,publicRpcUrl:env.HASTERRAD_PUBLIC_RPC_URL,projectId:env.HASTERRAD_WALLETCONNECT_PROJECT_ID};
 config.burnerWalletMode=env.HASTERRAD_BURNER_WALLET_MODE??'disabled';
 return config;
}
export async function main(env=process.env){
 const app=await createApp(configFromEnv(env));const port=Number(env.PORT??8787),host=env.HOST??'127.0.0.1';
 if(!Number.isInteger(port)||port<1||port>65535){await app.close();throw new Error('invalid_port');}
 await app.listen(port,host);
 // Deliberately no URLs, query strings, tokens, cookies, signatures or config values in logs.
 console.log('HASTERRAD auth listening');
 const stop=async()=>{await app.close();process.exit(0);};process.once('SIGTERM',stop);process.once('SIGINT',stop);return app;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('HASTERRAD auth startup failed; check nonsecret configuration and private store permissions');process.exitCode=1;});
