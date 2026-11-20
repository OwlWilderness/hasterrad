import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../hasterrad-game/source/public/',import.meta.url));
test('both game routes show a compact top-five panel without the cheat disclaimer',()=>{
  for(const route of ['index.html','asteroids.html']){
    const html=readFileSync(`${root}/${route}`,'utf8');
    assert.match(html,/TOP 5 \/ CLASSIC/);
    assert.match(html,/<ol id="leaderboard-list" aria-label="Top five verified-account high scores"/);
    assert.match(html,/<p id="leaderboard-status"/);
    assert.match(html,/<script src="assets\/hasterrad-scores\.js" defer><\/script>/);
    assert.doesNotMatch(html,/cheat-proof|cheating|gameplay counters are not/i);
  }
  const css=readFileSync(`${root}/assets/asteroids.css`,'utf8');
  assert.match(css,/\.board-entry\s*\{[^}]*grid-template-columns:/);
  assert.match(css,/\.board-provider\s*\{[^}]*width:\s*14px/);
  assert.match(css,/\.board-level\s*\{/);
});
