// Authority is always the same-origin server; wallet connection alone is not login.
export class AuthSession {
  constructor({fetcher = globalThis.fetch.bind(globalThis), changed = () => {}} = {}) {
    this.fetcher = fetcher; this.changed = changed; this.epoch = 0; this.tail = Promise.resolve();
    this.state = {session:null, status:'loading', error:null, revoking:false};
    this.connection = {status:'disconnected'}; this.seen = false; this.blocked = false;
  }
  emit(update) { this.state = {...this.state,...update}; this.changed(this.state); }
  enqueue(job) { const result = this.tail.then(job); this.tail = result.catch(() => {}); return result; }
  settled() { return this.tail; }
  reconcile() {
    ++this.epoch; this.attempt = null;
    this.emit({session:null,status:'loading'});
    return this.refresh();
  }
  async request(path, body, text = false) {
    const options = {credentials:'same-origin', cache:'no-store', redirect:'error', signal:AbortSignal.timeout(12000)};
    if (body !== undefined) {
      if (!this.csrf) throw Error('Session unavailable. Retry account status.');
      Object.assign(options,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':this.csrf},body:JSON.stringify(body)});
    }
    const response = await this.fetcher(path, options);
    if (!response.ok) throw Error('Account service refused the request. Retry or continue as guest.');
    const data = await (text ? response.text() : response.json());
    if (!text && data.csrf) this.csrf = data.csrf;
    return data;
  }
  validate(data) {
    if (typeof data?.authenticated !== 'boolean' || typeof data.csrf !== 'string' || !data.providers || !data.wallet ||
        (data.authenticated && (!data.user || !['urbit','remilianet','ethereum'].includes(data.user.provider) || typeof data.user.id !== 'string' || typeof data.user.displayName !== 'string'))) {
      throw Error('Account service response is unavailable or incompatible.');
    }
    return data;
  }
  async refresh() {
    const epoch = this.epoch;
    return this.enqueue(async () => {
      try {
        const data = this.validate(await this.request('/api/session'));
        if (epoch !== this.epoch || this.blocked) return null;
        if (data.authenticated && data.user.provider === 'ethereum' && this.connection.status === 'connected' && !this.matches(data.user)) {
          this.invalidate(); return null;
        }
        this.emit({session:data,status:data.authenticated?'authenticated':'unauthenticated',error:null}); return data;
      } catch (_) {
        if (epoch === this.epoch) this.emit({session:null,status:'unauthenticated',error:'Account service unavailable. Guest flight and device-local best still work.'});
        return null;
      }
    });
  }
  matches(user) { return this.connection.status === 'connected' && user.chainId === this.connection.chainId && user.address?.toLowerCase() === this.connection.address?.toLowerCase(); }
  observe(connection) {
    const old = this.lastConnected; this.connection = connection;
    if (connection.status === 'reconnecting' || connection.status === 'connecting') return;
    if (connection.status === 'connected') {
      const changed = this.seen && (old?.address?.toLowerCase() !== connection.address?.toLowerCase() || old?.chainId !== connection.chainId);
      this.seen = true; this.lastConnected = connection;
      const user = this.state.session?.user;
      if (changed || (user?.provider === 'ethereum' && !this.matches(user))) this.invalidate();
    } else if (this.seen) { this.seen = false; this.invalidate(); }
  }
  invalidate() { this.logout().catch(() => {}); }
  logout() {
    ++this.epoch; this.attempt = null; this.blocked = true;
    this.emit({session:null,status:'unauthenticated',revoking:true,error:null});
    return this.enqueue(async () => {
      try {
        if (!this.csrf) await this.request('/api/session');
        await this.request('/auth/logout',{});
        const data = this.validate(await this.request('/api/session'));
        if (data.authenticated) throw Error('still authenticated');
        this.blocked = false;
        this.invalidated?.();
        // Keep identity cleared even though the anonymous CSRF/config is refreshed.
        this.config = data; this.emit({session:null,revoking:false,error:null});
      } catch (_) {
        this.emit({session:null,revoking:false,error:'Sign out not confirmed. Retry sign out when online; wallet login is blocked until revocation succeeds.'});
        throw Error('Sign out not confirmed');
      }
    });
  }
  guard(attempt) {
    if (this.blocked || !attempt || attempt.epoch !== this.epoch || !this.matches(attempt) || attempt.chainId !== 1) throw Error('Wallet changed or login was cancelled. Start again.');
  }
  async getNonce() {
    if (this.blocked || this.state.revoking || this.connection.status !== 'connected' || this.connection.chainId !== 1 || !(this.state.session || this.config)?.providers.wallet) throw Error('Wallet login unavailable. Connect on Ethereum mainnet or continue as guest.');
    const attempt = {epoch:this.epoch,address:this.connection.address,chainId:this.connection.chainId}; this.attempt = attempt;
    return this.enqueue(async () => { this.guard(attempt); const data = await this.request('/api/wallet/nonce',{}); this.guard(attempt); attempt.nonce = data.nonce; return data.nonce; });
  }
  createMessage({nonce,address,chainId}) {
    const attempt = this.attempt;
    return this.enqueue(async () => {
      this.guard(attempt);
      if (nonce !== attempt.nonce || chainId !== attempt.chainId || address.toLowerCase() !== attempt.address.toLowerCase()) throw Error('Wallet challenge mismatch');
      const message = await this.request('/api/wallet/message',{nonce,address,chainId},true); this.guard(attempt); attempt.message = message; return message;
    });
  }
  verify({message,signature}) {
    const attempt = this.attempt;
    return this.enqueue(async () => {
      try {
        this.guard(attempt); if (message !== attempt.message) throw Error('Message mismatch');
        await this.request('/api/wallet/verify',{message,signature}); this.guard(attempt);
        const data = this.validate(await this.request('/api/session')); this.guard(attempt);
        if (!data.authenticated || data.user.provider !== 'ethereum' || !this.matches(data.user)) throw Error('Session mismatch');
        this.attempt = null; this.emit({session:data,status:'authenticated',error:null}); return true;
      } catch (_) {
        // Serial revoke follows any possibly committed verification, including timeout.
        if (attempt?.epoch === this.epoch) this.invalidate();
        return false;
      }
    });
  }
}
