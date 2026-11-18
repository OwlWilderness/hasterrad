import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {createApp} from '../../hasterrad-game/source/api/server/app.mjs';
import {Scores} from '../../hasterrad-game/source/api/server/scores.mjs';

export async function historyFixture(t, {walletOwner} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'hasterrad-personal-'));
  let app;
  t.after(async () => { try { await app?.close(); } finally { rmSync(root, {recursive:true, force:true}); } });
  const probe = createServer();
  await new Promise((resolve, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolve));
  const {port} = probe.address();
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  const origin = `http://127.0.0.1:${port}`;
  const dbPath = join(root, 'auth.sqlite'), scoreDbPath = join(root, 'scores.sqlite');
  const staticDir = fileURLToPath(new URL('../../hasterrad-game/source/api/public/', import.meta.url));
  app = await createApp({origin, dev:true, dbPath, scoreDbPath, staticDir});
  const owner = walletOwner ?? {provider:'urbit', id:'~zod', displayName:'Synthetic A'};
  const other = {provider:'urbit', id:'~nec', displayName:'Synthetic B'};
  const empty = {provider:'urbit', id:'~bud', displayName:'Synthetic C'};
  function signIn(user, first = app.store.bootstrap()) {
    const issued = app.store.issue('fixture', first.row);
    return app.store.finish(app.store.claim(issued.secret, 'fixture', first.row), user);
  }
  const a = signIn(owner), b = signIn(other), c = signIn(empty);
  function seed(user, run, score, created, state = 'verified') {
    const db = new Scores(scoreDbPath, dbPath, Date.now);
    try {
      const id = db.user(user, true);
      db.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?)', run, id, 'fixture', created - 10, created + 60,
        state === 'unfinished' ? null : 'synthetic', state === 'verified' ? '{"verified":true}' : '{}');
      db.run('INSERT INTO scores VALUES(?,?,?,?,?,?,?)', run, id, score, 2, 1, 1000, created);
    } finally { db.close(); }
  }
  const cookie = session => `hasterrad_dev_session=${session.token}`;
  await app.listen(port);
  return {app, origin, root, a, b, c, owner, other, empty, signIn, seed, cookie};
}
