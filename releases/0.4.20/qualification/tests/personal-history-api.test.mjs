import test from 'node:test';
import assert from 'node:assert/strict';
import {historyFixture} from './personal-history-fixture.mjs';

test('history binds to the current cookie and returns only that account’s newest verified finishes', async t => {
  const {origin,a,b,c,owner,other,seed,cookie,signIn} = await historyFixture(t);
  const request = (session, token = session?.row.csrf, query = '') => fetch(`${origin}/api/me/score-history${query}`, {
    headers: {...(session ? {cookie:cookie(session)} : {}), ...(token ? {'X-CSRF-Token':token} : {})},
  });
  const created = 1700000000;
  for (let i = 0; i < 11; i++) seed(owner, `a-${String(i).padStart(2,'0')}`, i, created + i);
  seed(owner, 'tie', 20, created + 2);
  seed(owner, 'legacy', 500, created + 20, 'legacy');
  seed(owner, 'unfinished', 500, created + 21, 'unfinished');
  seed(other, 'b-01', 99, created + 23);
  const response = await request(a);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const {scores} = await response.json();
  assert.deepEqual(scores.map(row => row.score), [10,9,8,7,6,5,4,3,20,2]);
  assert.deepEqual(scores[0], {score:10, level:2, finishedAt:(created + 10)*1000});
  assert.deepEqual(scores.slice(-2).map(row=>row.finishedAt), [(created+2)*1000,(created+2)*1000]);
  assert.equal((await request(a,a.row.csrf,'?cursor=ignored')).status,400);
  assert.deepEqual((await (await request(b)).json()).scores.map(row => row.score), [99]);
  assert.deepEqual(await (await request(c)).json(), {scores:[]});
  assert.equal((await request()).status, 401);
  assert.equal((await request(b,a.row.csrf)).status, 403);
  assert.equal((await request(a,'')).status, 403);
  assert.equal((await request(a,a.row.csrf,'?user=other')).status, 400);
  const logout = await fetch(`${origin}/auth/logout`, {method:'POST', body:'{}', headers:{
    cookie:cookie(a), origin, 'content-type':'application/json', 'X-CSRF-Token':a.row.csrf,
  }});
  assert.equal(logout.status, 200);
  assert.equal((await request(a)).status, 401);
  const next = signIn(owner);
  assert.deepEqual((await (await request(next)).json()).scores, scores);
  const board = await (await fetch(`${origin}/api/leaderboard`)).json();
  assert.deepEqual(board.board.map(row => [row.name,row.score]), [['Synthetic B',99],['Synthetic A',20]]);
});
