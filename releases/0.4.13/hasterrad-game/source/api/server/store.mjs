import {DatabaseSync} from 'node:sqlite';
import {randomBytes, createHash} from 'node:crypto';
import {mkdirSync, chmodSync} from 'node:fs';
import {dirname} from 'node:path';
export const random = () => randomBytes(32).toString('hex');
export const hash = value => createHash('sha256').update(value).digest('hex');
export class AuthError extends Error { constructor(status=401, code='authentication_failed') {super(code);this.status=status;this.code=code;} }
import {markDiagnostic} from './diagnostics.mjs';
export const requireAuth = (condition,status=401,code='authentication_failed',stage) => {if(!condition) throw markDiagnostic(new AuthError(status,code),stage);};
const DAY=86400000,IDLE=1800000;
export class Store {
  constructor(path, clock=()=>Date.now()) {
    this.clock=clock; mkdirSync(dirname(path),{recursive:true,mode:0o700});
    this.db=new DatabaseSync(path);chmodSync(path,0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS families(id TEXT PRIMARY KEY,generation INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,family TEXT NOT NULL,generation INTEGER NOT NULL,csrf TEXT NOT NULL,user TEXT,expires INTEGER NOT NULL,idle INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS flows(id TEXT PRIMARY KEY,kind TEXT NOT NULL,session TEXT NOT NULL,family TEXT NOT NULL,generation INTEGER NOT NULL,expires INTEGER NOT NULL,phase TEXT NOT NULL,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS flows_family ON flows(family);
      CREATE TABLE IF NOT EXISTS rates(id TEXT PRIMARY KEY,bucket INTEGER NOT NULL,n INTEGER NOT NULL);`);
    this.db.exec('CREATE TABLE IF NOT EXISTS wallet_proofs(session TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,proof TEXT NOT NULL,checked INTEGER NOT NULL)');
  }
  get(sql,...args){return this.db.prepare(sql).get(...args);}
  run(sql,...args){return this.db.prepare(sql).run(...args);}
  tx(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  familyCurrent(row){return row && this.get('SELECT generation FROM families WHERE id=?',row.family)?.generation===row.generation;}
  valid(row){return row&&!row.revoked&&row.expires>this.clock()&&row.idle>this.clock()&&this.familyCurrent(row);}
  lookup(token){return typeof token==='string'&&/^[a-f0-9]{64}$/.test(token)?this.get('SELECT * FROM sessions WHERE id=?',hash(token)):undefined;}
  create(family,generation,user=null,expires=this.clock()+DAY){
    const token=random(),csrf=random();const now=this.clock();
    this.run('INSERT INTO sessions(id,family,generation,csrf,user,expires,idle) VALUES(?,?,?,?,?,?,?)',hash(token),family,generation,csrf,user?JSON.stringify(user):null,expires,Math.min(expires,now+IDLE));
    return {token,row:this.lookup(token)};
  }
  bootstrap(token){
    return this.tx(()=>{
      const row=this.lookup(token);
      if(this.valid(row)){this.run('UPDATE sessions SET idle=? WHERE id=?',Math.min(row.expires,this.clock()+IDLE),row.id);return {row,token:null};}
      // A stale Set-Cookie/GET must not fork a known browser out of its logout family.
      if(row&&row.expires>this.clock()){
        const current=this.get('SELECT generation FROM families WHERE id=?',row.family);
        if(current)return this.create(row.family,current.generation);
      }
      const family=random();this.run('INSERT INTO families VALUES(?,0)',family);return this.create(family,0);
    });
  }
  rate(key,limit=20){
    this.tx(()=>{const id=hash(key),bucket=Math.floor(this.clock()/60000);this.run('INSERT INTO rates VALUES(?,?,1) ON CONFLICT(id) DO UPDATE SET n=CASE WHEN bucket=excluded.bucket THEN n+1 ELSE 1 END,bucket=excluded.bucket',id,bucket);requireAuth(this.get('SELECT n FROM rates WHERE id=?',id).n<=limit,429,'rate_limited');});
  }
  logout(row){return this.tx(()=>{
    const current=this.get('SELECT generation FROM families WHERE id=?',row.family);requireAuth(current,401);
    const generation=current.generation+1;
    this.run('UPDATE families SET generation=? WHERE id=?',generation,row.family);
    this.run('UPDATE sessions SET revoked=1 WHERE family=?',row.family);
    this.run("UPDATE flows SET phase='revoked' WHERE family=?",row.family);
    return this.create(row.family,generation);
  });}
  issue(kind,row,data={}){return this.tx(()=>{
    requireAuth(this.valid(this.get('SELECT * FROM sessions WHERE id=?',row.id)));
    this.run("UPDATE flows SET phase='replaced' WHERE session=? AND kind=? AND (phase IN ('pending','message') OR (kind='wallet' AND phase='checking'))",row.id,kind);
    const secret=random(),expires=this.clock()+300000;
    this.run('INSERT INTO flows VALUES(?,?,?,?,?,?,?,?)',hash(secret),kind,row.id,row.family,row.generation,expires,'pending',JSON.stringify(data));
    return {secret,expires};
  });}
  flow(secret,kind){requireAuth(typeof secret==='string'&&/^[a-f0-9]{64}$/.test(secret),401,'authentication_failed','flow_lookup');const flow=this.get('SELECT * FROM flows WHERE id=? AND kind=?',hash(secret),kind);requireAuth(flow,401,'authentication_failed','flow_lookup');requireAuth(flow.expires>this.clock(),401,'authentication_failed','flow_expiry');requireAuth(this.familyCurrent(flow),401,'authentication_failed','flow_family');flow.data=JSON.parse(flow.data);return flow;}
  bound(flow,row){requireAuth(row&&flow.session===row.id&&this.valid(row)&&flow.generation===row.generation,401,'authentication_failed','flow_binding');}
  claim(secret,kind,row){return this.tx(()=>{const flow=this.flow(secret,kind);if(row)this.bound(flow,row);requireAuth(['pending','message'].includes(flow.phase),401,'authentication_failed','flow_phase');this.run("UPDATE flows SET phase='checking' WHERE id=?",flow.id);return flow;});}
  message(secret,row,fields,build){return this.tx(()=>{const flow=this.flow(secret,'wallet');this.bound(flow,row);requireAuth(['pending','message'].includes(flow.phase));
    if(flow.data.message){requireAuth(flow.data.address===fields.address&&flow.data.chainId===fields.chainId,409,'new_nonce_required');return flow.data.message;}
    const message=build(flow);this.run("UPDATE flows SET phase='message',data=? WHERE id=?",JSON.stringify({...flow.data,...fields,message}),flow.id);return message;
  });}
  completion(flow,user){return this.tx(()=>{
    requireAuth(this.familyCurrent(flow)&&flow.expires>this.clock());
    requireAuth(this.get('SELECT phase FROM flows WHERE id=?',flow.id)?.phase==='checking');
    const secret=random();this.run("UPDATE flows SET id=?,phase='completion',data=? WHERE id=?",hash(secret),JSON.stringify({user}),flow.id);return secret;
  });}
  finish(flow,user,expires=this.clock()+DAY,proof=null){return this.tx(()=>{
    const current=this.get('SELECT * FROM flows WHERE id=?',flow.id);requireAuth(current&&['checking','completion'].includes(current.phase)&&current.expires>this.clock()&&this.familyCurrent(current),401,'authentication_failed','finish_guard');
    const original=this.get('SELECT * FROM sessions WHERE id=?',flow.session);requireAuth(this.valid(original),401,'authentication_failed','finish_guard');
    this.run("UPDATE flows SET phase='consumed',data='{}' WHERE id=?",flow.id);this.run('UPDATE sessions SET revoked=1 WHERE id=?',original.id);
    const session=this.create(flow.family,flow.generation,user,Math.min(expires,this.clock()+DAY));
    if(proof)this.run('INSERT INTO wallet_proofs VALUES(?,?,?)',session.row.id,JSON.stringify(proof),this.clock());
    return session;
  });}
  prune(){return this.tx(()=>{
    const now=this.clock();this.run('DELETE FROM flows WHERE expires<=?',now);this.run('DELETE FROM sessions WHERE expires<=?',now);
    this.run('DELETE FROM families WHERE NOT EXISTS(SELECT 1 FROM sessions WHERE family=families.id) AND NOT EXISTS(SELECT 1 FROM flows WHERE family=families.id)');
    this.run('DELETE FROM rates WHERE bucket<?',Math.floor(now/60000)-2);
  });}
  close(){this.db.close();}
}
