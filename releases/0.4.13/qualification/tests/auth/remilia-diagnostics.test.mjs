import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {createApp} from '../../server/app.mjs';
import {request,scratch} from './helpers.mjs';
test('opt-in callback diagnostic exposes only checked lookup enum',async t=>{
 const app=await createApp({origin:'http://127.0.0.1:18997',dev:true,dbPath:join(scratch(),'auth.sqlite'),oidc:{clientId:'fixture-client',failureDiagnostics:true}});
 await app.listen(18997);t.after(()=>app.close());
 const response=await request('http://127.0.0.1:18997','/auth/remilianet/callback?state=synthetic&code=synthetic');
 assert.equal(response.status,401);
 assert.deepEqual(response.json(),{error:'authentication_failed',diagnostic_stage:'flow_lookup'});
 assert.equal(response.headers['cache-control'],'no-store');
});
