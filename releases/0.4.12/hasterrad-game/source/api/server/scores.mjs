// Compatible with the predecessor's v2 score DB; fresh score files use v3. Never consumes legacy auth/session tables.
import {DatabaseSync} from 'node:sqlite';
import {lstatSync,realpathSync,statSync,existsSync,mkdirSync,chmodSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {randomBytes} from 'node:crypto';
import {requireAuth,hash} from './store.mjs';
import {replayRun,validArena} from './replay.mjs';
const VERSION='hasterrad-3';
const columns={users:'id,provider,issuer,subject,label',sessions:'hash,user_id,csrf,expires',auth:'state,binding,expires,phase,subject',oidc:'state,binding,expires,verifier,nonce,used',runs:'id,user_id,session_hash,started,expires,finish_digest,result',scores:'run_id,user_id,score,wave,kills,duration_ms,created',limits:'bucket,count,expires'};
export class Scores {
 constructor(path,authPath,clock){
  requireAuth(resolve(path)!==resolve(authPath),500,'score_auth_database_collision');
  let prior;try{prior=lstatSync(path);}catch(error){if(error.code!=='ENOENT')throw error;}
  requireAuth(!prior?.isSymbolicLink(),500,'score_path_symlink');
  if(!existsSync(path)){
   mkdirSync(dirname(path),{recursive:true,mode:0o700});
   const fresh=new DatabaseSync(path);
   try{fresh.exec(`PRAGMA user_version=3;
    CREATE TABLE users(id TEXT PRIMARY KEY,provider TEXT NOT NULL,issuer TEXT NOT NULL,subject TEXT NOT NULL,label TEXT NOT NULL,UNIQUE(provider,issuer,subject));
    CREATE TABLE runs(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,session_hash TEXT NOT NULL,started REAL NOT NULL,expires REAL NOT NULL,finish_digest TEXT,result TEXT);
    CREATE TABLE scores(run_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,score INTEGER NOT NULL,wave INTEGER NOT NULL,kills INTEGER NOT NULL,duration_ms INTEGER NOT NULL,created REAL NOT NULL);`);
   }finally{fresh.close();}chmodSync(path,0o600);
  }
  requireAuth(!lstatSync(path).isSymbolicLink()&&lstatSync(path).isFile(),500,'invalid_score_database');
  requireAuth(realpathSync(path)!==resolve(authPath),500,'score_auth_database_collision');
  try{const a=statSync(authPath),b=statSync(path);requireAuth(a.dev!==b.dev||a.ino!==b.ino,500,'score_auth_database_collision');}catch(error){if(error.code!=='ENOENT')throw error;}
  // Read-only admission before any writable open: never run the Node auth schema on this file.
  const check=new DatabaseSync(path,{readOnly:true});
  try{
   const version=check.prepare('PRAGMA user_version').get().user_version;
   requireAuth(version===2||version===3,500,'unsupported_score_schema');
   for(const [table,names] of Object.entries(columns))if(version===2||['users','runs','scores'].includes(table))requireAuth(check.prepare(`PRAGMA table_info(${table})`).all().map(x=>x.name).join(',')===names,500,'unsupported_score_schema');
   requireAuth(check.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger'").get().n===0,500,'unsupported_score_schema');
   const indexes=check.prepare('PRAGMA index_list(users)').all().filter(x=>x.unique);
   requireAuth(indexes.some(x=>check.prepare(`PRAGMA index_info('${x.name.replaceAll("'","''")}')`).all().map(x=>x.name).join(',')==='provider,issuer,subject'),500,'unsupported_score_schema');
  }finally{check.close();}
  this.db=new DatabaseSync(path);this.db.exec('PRAGMA busy_timeout=5000');this.clock=clock;
 }
 close(){this.db.close();}
 tx(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 get(sql,...args){return this.db.prepare(sql).get(...args);}
 all(sql,...args){return this.db.prepare(sql).all(...args);}
 run(sql,...args){return this.db.prepare(sql).run(...args);}
 identity(user){
  requireAuth(user&&typeof user.id==='string'&&typeof user.displayName==='string',401,'verified_identity_required');
  if(user.provider==='urbit'&&/^~(?:[a-z]{3}|[a-z]{6}(?:-[a-z]{6}){0,7})$/.test(user.id))return ['urbit','urbit',user.id,user.displayName];
  const issuer='https://www.remilia.net/oidc/realms/remilia';
  if(user.provider==='remilianet'&&user.id.startsWith(issuer+'#')&&user.id.length>issuer.length+1)return ['remilianet',issuer,user.id.slice(issuer.length+1),user.displayName];
  if(user.provider==='ethereum'&&/^ethereum:1:0x[0-9a-fA-F]{40}$/.test(user.id))return ['ethereum','eip155',user.id.slice('ethereum:1:'.length).toLowerCase(),user.displayName];
  requireAuth(false,401,'unsupported_score_identity');
 }
 user(user,create=false){const [provider,issuer,subject,label]=this.identity(user);let row=this.get('SELECT id FROM users WHERE provider=? AND issuer=? AND subject=?',provider,issuer,subject);
  if(!row&&create){const id=randomBytes(32).toString('base64url');this.run('INSERT INTO users(id,provider,issuer,subject,label) VALUES(?,?,?,?,?)',id,provider,issuer,subject,label);row={id};}return row?.id;
 }
 async board(resolveEns){const rows=this.all(`WITH verified AS (
  SELECT scores.* FROM scores JOIN runs ON runs.id=scores.run_id AND runs.finish_digest IS NOT NULL AND (CASE WHEN json_valid(runs.result) THEN json_extract(runs.result,'$.verified') ELSE 0 END)=1
 ), ranked AS (
  SELECT verified.*,ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY score DESC,created ASC,run_id ASC) AS place FROM verified
 ) SELECT users.label AS name,users.provider,users.subject,ranked.score,ranked.wave AS level
 FROM ranked JOIN users ON users.id=ranked.user_id WHERE ranked.place=1
 ORDER BY ranked.score DESC,name ASC,users.id ASC LIMIT 5`);
  const board=await Promise.all(rows.map(async({name,provider,subject,score,level})=>{
   if(provider==='ethereum'){
    const ens=resolveEns?await resolveEns(subject):null;
    name=typeof ens==='string'&&/^(?:[a-z0-9-]+\.)+eth$/.test(ens)&&ens.length<=64?ens:`${subject.slice(0,6)}…${subject.slice(-4)}`;
   }
   return {name,provider,score,level};
  }));return {board,version:VERSION,mode:'classic'};
 }
 mine(user){const id=this.user(user),verified='scores.run_id=runs.id AND runs.finish_digest IS NOT NULL AND (CASE WHEN json_valid(runs.result) THEN json_extract(runs.result,\'$.verified\') ELSE 0 END)=1';return {best:id?this.get(`SELECT COALESCE(MAX(scores.score),0) AS best FROM scores JOIN runs ON ${verified} WHERE scores.user_id=?`,id).best:0,scores:id?this.all(`SELECT score,wave,kills,duration_ms FROM scores JOIN runs ON ${verified} WHERE scores.user_id=? ORDER BY created DESC LIMIT 10`,id):[]};}
 start(row,user,data){requireAuth(JSON.stringify(Object.keys(data).sort())===JSON.stringify(['height','mode','version','width'])&&data.version===VERSION&&data.mode==='classic'&&validArena(data.width,data.height),400,'unsupported_version_or_mode');return this.tx(()=>{const id=this.user(user,true),run=randomBytes(32).toString('base64url'),seed=randomBytes(4).readUInt32LE(0),now=this.clock()/1000;this.run('UPDATE users SET label=? WHERE id=?',user.displayName,id);this.run('INSERT INTO runs VALUES(?,?,?,?,?,NULL,?)',run,id,'node:'+row.id,now,now+21600,JSON.stringify({seed,width:data.width,height:data.height,version:VERSION}));return {run_id:run,seed,version:VERSION,mode:'classic'};});}
 async finish(row,user,runId,data,guard=()=>{}){
  const id=this.user(user),lookup=()=>this.get('SELECT * FROM runs WHERE id=? AND user_id=? AND session_hash=?',runId,id??'','node:'+row.id),run=lookup();requireAuth(run,404,'unknown_run');
  const digest=hash(JSON.stringify(Object.fromEntries(Object.keys(data).sort().map(k=>[k,data[k]]))));
  if(run.finish_digest){requireAuth(run.finish_digest===digest,409,'run_already_finished');return JSON.parse(run.result);}
  requireAuth(run.expires>=this.clock()/1000,410,'run_expired');
  const settings=JSON.parse(run.result);requireAuth(settings.version===VERSION,400,'replay_required');
  const replay=await replayRun(settings,data),now=this.clock()/1000;
  requireAuth(run.expires>=now&&data.duration_ms<=(now-run.started)*1000+1500,400,'inconsistent_elapsed_time');
  return this.tx(()=>{
   guard();
   const current=lookup();requireAuth(current&&current.expires>=this.clock()/1000,410,'run_expired');
   if(current.finish_digest){requireAuth(current.finish_digest===digest,409,'run_already_finished');return JSON.parse(current.result);}
   const result={score:replay.score,wave:replay.wave,kills:replay.kills,saved:true,verified:true};
   this.run('INSERT INTO scores VALUES(?,?,?,?,?,?,?)',runId,id,replay.score,replay.wave,replay.kills,replay.duration_ms,now);
   this.run('UPDATE runs SET finish_digest=?,result=? WHERE id=?',digest,JSON.stringify(result),runId);return result;
  });
 }
}
export function scoreHandler(ctx,scores){const ensCache=new Map();const resolveEns=async address=>{
  if(!ctx.resolveEns)return null;
  const cached=ensCache.get(address),now=Date.now();if(cached&&cached.until>now)return cached.name;
  const name=await ctx.resolveEns(address);ensCache.set(address,{name,until:now+(name?300000:60000)});return name;
 };return async({req,res,url,row})=>{
 const path=url.pathname,finish=/^\/api\/runs\/([a-zA-Z0-9_-]{43})\/finish$/.exec(path);
 if(req.method==='GET'&&path==='/api/leaderboard'){ctx.json(res,200,await scores.board(resolveEns));return true;}
 if(!(req.method==='GET'&&path==='/api/me/scores')&&!(req.method==='POST'&&(path==='/api/runs/start'||finish)))return false;
 requireAuth(ctx.store.valid(row)&&row.user,401,'login_required');
 const user=JSON.parse(row.user);
 if(user.provider==='ethereum'){requireAuth(ctx.checkWalletSession,401,'wallet_verification_unavailable');await ctx.checkWalletSession(row,{fresh:req.method==='POST'});requireAuth(ctx.store.valid(ctx.store.get('SELECT * FROM sessions WHERE id=?',row.id)),401,'login_required');}
 if(req.method==='GET'){ctx.json(res,200,scores.mine(user));return true;}
 ctx.csrf(req,row);const data=await ctx.body(req,finish?1048576:16384);requireAuth(ctx.store.valid(ctx.store.get('SELECT * FROM sessions WHERE id=?',row.id)),401,'login_required');ctx.store.rate('score:'+row.id,path==='/api/runs/start'?10:60);
 ctx.json(res,path==='/api/runs/start'?201:200,path==='/api/runs/start'?scores.start(row,user,data):await scores.finish(row,user,finish[1],data,()=>{
  const fresh=ctx.store.get('SELECT * FROM sessions WHERE id=?',row.id);
  requireAuth(ctx.store.valid(fresh)&&fresh.user===row.user,401,'login_required');
 }));return true;
};}
