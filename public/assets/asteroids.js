/* Canvas controller. Optional account adapter preserves offline guest gameplay. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('space'), ctx = canvas.getContext('2d');
  if (!ctx) { $('subtitle').textContent = 'Canvas is unavailable in this browser.'; $('start').disabled = true; return; }
  const storageKey = 'quantumtekh.asteroids.best.v1';
  let best = 0;
  try { best = Math.min(999999999, Math.max(0, Number(localStorage.getItem(storageKey)) || 0)); }
  catch (_) { $('storage-note').textContent = 'this session'; }
  const game = window.AsteroidsCore.createGame({ highScore: best }), state = game.state;
  const keyboard = new Set(), pointers = new Map();
  const stick = $('flight-stick'), knob = $('stick-knob');
  let stickPointer = null, stickAnchor = null, stickInput = {};
  let firePresses = 0;
  let accountRun = null, starting = false;
  const actions = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'thrust', KeyW: 'thrust', Space: 'fire', KeyH: 'hyperspace', KeyS: 'hyperspace' };
  let width = 0, height = 0, scale = 1, dpr = 1, accumulator = 0, last = performance.now(), uiKey = '';
  const reducedMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
  const stars = Array.from({ length: 65 }, (_, i) => ({ x: ((i * 137.508) % 997) / 997,
    y: ((i * i * 31.13) % 991) / 991, alpha: 0.1 + (i % 4) * 0.055 }));
  function resize() {
    const box = canvas.getBoundingClientRect();
    const oldW = state.width, oldH = state.height;
    width = Math.max(1, box.width); height = Math.max(1, box.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2); scale = Math.min(1.2, width / 650);
    state.width = width / scale; state.height = height / scale;
    for (const body of [state.ship, state.saucer, ...state.rocks, ...state.bullets,
      ...state.saucerBullets, ...state.particles]) {
      if (body) { body.x *= state.width / oldW; body.y *= state.height / oldH; }
    }
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  }
  function input() {
    const current = { ...stickInput };
    for (const key of keyboard) if (actions[key]) current[actions[key]] = true;
    for (const action of pointers.values()) current[action] = true;
    return current;
  }
  function release() {
    keyboard.clear(); pointers.clear(); firePresses = 0; stickPointer = null; stickAnchor = null; stickInput = {};
    if (knob && knob.style) knob.style.transform = '';
    document.querySelectorAll('[data-action]').forEach(button => button.classList.remove('active'));
  }
  function sync() {
    const key = [state.mode, state.score, state.highScore, state.wave, state.lives,
      Math.ceil(state.ship ? state.ship.hyperCooldown : 0)].join('/');
    if (key === uiKey) return;
    uiKey = key;
    $('score').textContent = String(state.score).padStart(6, '0');
    $('best').textContent = String(state.highScore).padStart(6, '0');
    $('wave').textContent = String(Math.max(1, state.wave)).padStart(2, '0');
    $('lives').textContent = state.lives ? Array(state.lives).fill('△').join(' ') : '—';
    $('lives').setAttribute('aria-label', `${state.lives} ships remaining`);
    const autoFire = state.wave >= 2, rapidFire = state.wave >= 5;
    $('weapon-status').textContent = `${rapidFire ? 'RAPID AUTO FIRE' : autoFire ? 'AUTO FIRE' : 'TAP FIRE'} · ${autoFire ? 'HOLD TO FIRE · ' : ''}4 LIVE MAX`;
    $('weapon-unlocks').textContent = `AUTO @ Level 2: ${autoFire ? 'UNLOCKED' : 'LOCKED'} · FASTER @ Level 5: ${rapidFire ? 'UNLOCKED' : 'LOCKED'}`;
    $('overlay').hidden = state.mode === 'playing';
    if ($('touch-controls')) $('touch-controls').hidden = state.mode !== 'playing';
    $('pause').disabled = !['playing', 'paused'].includes(state.mode);
    $('pause').textContent = state.mode === 'paused' ? 'Resume [P]' : 'Pause [P]';
    $('flight-status').textContent = state.mode === 'playing'
      ? (state.ship.hyperCooldown > 0 ? `HYPERSPACE / ${Math.ceil(state.ship.hyperCooldown)}s` : 'HYPERSPACE / READY')
      : { ready: 'READY WHEN YOU ARE', paused: 'FLIGHT SUSPENDED', gameover: 'SIGNAL LOST' }[state.mode];
    if (state.mode === 'paused') {
      $('message').textContent = 'TAKE A BREATH'; $('game-title').textContent = 'PAUSED';
      $('subtitle').textContent = 'Space can wait.'; $('start').textContent = 'Resume flight ↗';
      $('enter-hint').textContent = 'or press P / Enter';
    } else if (state.mode === 'gameover') {
      $('message').textContent = 'END OF TRANSMISSION'; $('game-title').textContent = 'GAME OVER';
      $('subtitle').textContent = `${state.score.toLocaleString()} points · level ${state.wave}`;
      $('start').textContent = 'Fly again ↗'; $('enter-hint').textContent = 'or press Enter';
    }
    if (state.highScore > best) {
      best = state.highScore;
      try { localStorage.setItem(storageKey, String(best)); }
      catch (_) { $('storage-note').textContent = 'this session'; }
    }
  }
  function activate() {
    if (starting || state.mode === 'playing') return;
    release();
    const begin = run => {
      starting = false; $('start').disabled = false;
      if (state.mode === 'paused') game.pause(); else { accountRun = run; game.start(); }
      accumulator = 0; last = performance.now(); sync(); canvas.focus();
      $('announcement').textContent = `Level ${state.wave}. ${state.lives} ships.`;
    };
    if (state.mode !== 'paused' && window.HasterradScores) {
      starting = true; $('start').disabled = true;
      window.HasterradScores.start().then(begin, () => begin(null));
    } else begin(null);
  }
  function togglePause() {
    if (!['playing', 'paused'].includes(state.mode)) return;
    game.pause(); release(); sync();
    if (state.mode === 'paused') $('start').focus(); else canvas.focus();
    $('announcement').textContent = state.mode === 'paused' ? 'Paused.' : 'Flight resumed.';
  }
  $('start').addEventListener('click', activate);
  $('pause').addEventListener('click', togglePause);
  canvas.addEventListener('pointerdown', () => canvas.focus());
  window.addEventListener('keydown', event => {
    // P / Escape remain available when the Pause or Resume button owns focus.
    if (event.code === 'KeyP' || event.code === 'Escape') {
      event.preventDefault(); if (!event.repeat) togglePause(); return;
    }
    // Preserve normal Space / Enter activation of native controls.
    if (['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY'].includes(event.target.tagName)) return;
    if (event.code === 'Enter' && state.mode !== 'playing') { event.preventDefault(); activate(); return; }
    if (actions[event.code] && state.mode === 'playing') {
      event.preventDefault();
      if (event.repeat) return;
      if (event.code === 'Space' && !keyboard.has(event.code)) firePresses++;
      keyboard.add(event.code);
    }
  });
  window.addEventListener('keyup', event => keyboard.delete(event.code));
  const suspend = () => { release(); if (state.mode === 'playing') { game.pause(); sync(); } };
  window.addEventListener('blur', suspend);
  document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); });
  window.addEventListener('resize', resize);
  document.querySelectorAll('[data-action]').forEach(button => {
    button.addEventListener('pointerdown', event => {
      event.preventDefault(); if (state.mode !== 'playing') return;
      if (pointers.has(event.pointerId)) return;
      button.setPointerCapture(event.pointerId); pointers.set(event.pointerId, button.dataset.action);
      if (button.dataset.action === 'fire') firePresses++;
      button.classList.add('active');
    });
    const up = event => {
      event.preventDefault(); pointers.delete(event.pointerId);
      if (![...pointers.values()].includes(button.dataset.action)) button.classList.remove('active');
    };
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, up);
    button.addEventListener('contextmenu', event => event.preventDefault());
  });
  if (stick) {
    function positionStick(event) {
      const box = stick.getBoundingClientRect(), radius = box.width / 2;
      const baseline = box.bottom - 20;
      // The physical pad is a forward semicircle, centered on its flat base.
      if (event.clientY > baseline) { stickInput = {}; knob.style.transform = ''; return; }
      const x = Math.max(-1, Math.min(1, (event.clientX - box.left - radius) / radius));
      const y = Math.max(-1, Math.min(0, (event.clientY - baseline) / radius));
      const length = Math.hypot(x, y);
      if (length < 0.22) { stickInput = {}; knob.style.transform = ''; return; }
      const dx = x / Math.max(1, length), dy = y / Math.max(1, length);
      // Relative to heading when grabbed: holding right points at a bounded
      // quarter-turn, rather than requesting endless angular velocity.
      stickInput = { targetAngle: stickAnchor + Math.atan2(dx, -dy), thrust: dy < -0.22 };
      knob.style.transform = `translate(${dx * radius * 0.55}px, ${dy * radius * 0.55}px)`;
    }
    stick.addEventListener('pointerdown', event => {
      event.preventDefault();
      if (state.mode !== 'playing' || stickPointer !== null) return;
      stickPointer = event.pointerId; stickAnchor = state.ship.angle;
      stick.setPointerCapture(event.pointerId); positionStick(event);
    });
    stick.addEventListener('pointermove', event => {
      if (event.pointerId === stickPointer) { event.preventDefault(); positionStick(event); }
    });
    function stopStick(event) {
      if (event.pointerId !== stickPointer) return;
      event.preventDefault(); stickPointer = null; stickAnchor = null; stickInput = {}; knob.style.transform = '';
    }
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) stick.addEventListener(name, stopStick);
  }
  function line(points, close = false) {
    ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    if (close) ctx.closePath(); ctx.stroke();
  }
  // Draw edge copies so the visual field and toroidal collision geometry agree.
  function wrapped(body, radius, draw) {
    const xs = [0], ys = [0];
    if (body.x < radius) xs.push(state.width); if (body.x > state.width - radius) xs.push(-state.width);
    if (body.y < radius) ys.push(state.height); if (body.y > state.height - radius) ys.push(-state.height);
    for (const x of xs) for (const y of ys) { ctx.save(); ctx.translate(body.x + x, body.y + y); draw(); ctx.restore(); }
  }
  function draw(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    for (const star of stars) { ctx.fillStyle = `rgba(197,216,204,${star.alpha})`; ctx.fillRect(star.x * width, star.y * height, 1, 1); }
    ctx.scale(scale, scale); ctx.strokeStyle = '#c9d5cd'; ctx.fillStyle = '#ecf6ef';
    ctx.lineWidth = 1.25 / Math.sqrt(scale); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.shadowColor = '#d7f5e3'; ctx.shadowBlur = reducedMotion ? 0 : 6;
    const rocks = state.mode === 'ready' ? attractRocks : state.rocks;
    // SAN Sound product-inspired silhouettes; collision radii and physics stay unchanged.
    // The three breakable sizes read as a Quantum case, Hardwire Cortex, and earbud.
    for (const r of rocks) wrapped(r, r.radius, () => {
      ctx.rotate(r.angle);
      if (r.size === 3 || r.radius > 38) {
        // Broad triangular lid, recessed seam and separate side-docked shells.
        line([[-25,-14],[25,-14],[29,-9],[23,23],[0,37],[-23,23],[-29,-9]], true);
        line([[-25,-9],[25,-9],[18,17],[0,27],[-18,17]], true);
        line([[-31,-9],[-37,3],[-30,17],[-26,22],[-29,0]], true);
        line([[31,-9],[37,3],[30,17],[26,22],[29,0]], true);
        line([[-20,15],[0,19],[20,15]]);
        line([[-3,-17],[3,-17]]);
      } else if (r.size === 2 || r.radius > 20) {
        // HARDWIRE Audio Cortex: long chamfered inline body, face and cables.
        line([[-15,-8],[15,-8],[18,-4],[18,4],[15,8],[-15,8],[-18,4],[-18,-4]], true);
        line([[-11,-4],[10,-4],[14,0],[10,4],[-11,4]], true);
        line([[-23,0],[-18,0]]); line([[18,0],[23,0]]);
        line([[-6,-1],[-4,-1],[-4,1],[-6,1]], true);
        line([[5,-2],[2,1],[5,2],[8,-1]], true);
      } else {
        // Earbud, not a lozenge: polygonal faceplate, triangular ridge, nozzle.
        line([[-6,-6],[2,-6],[7,-1],[4,6],[-3,7],[-8,2]], true);
        line([[-6,-6],[1,0],[7,-1],[1,0],[-3,7]]);
        line([[-8,-1],[-11,-1],[-12,2],[-10,4],[-7,4]]);
      }
    });
    if (state.saucer) wrapped(state.saucer, state.saucer.radius, () => {
      const r = state.saucer.radius / 23;
      ctx.scale(r, r);
      ctx.strokeStyle = '#f3d5ac';
      // GAMETYPE charging-case face: flat brow, faceted sides, inverted chevron.
      line([[-23,-13],[23,-13],[25,-9],[19,17],[0,26],[-19,17],[-25,-9]], true);
      line([[-20,-9],[20,-9],[14,13],[0,19],[-14,13]], true);
      line([[-16,-3],[0,13],[16,-3]]);
      line([[-25,-7],[-29,2],[-23,13]]); line([[25,-7],[29,2],[23,13]]);
      line([[-4,-8],[-4,-2],[0,1],[4,-2],[4,-8]]);
      ctx.strokeStyle = '#c9d5cd';
    });
    for (const bullet of state.bullets) wrapped(bullet, 3, () => { ctx.beginPath(); ctx.arc(0, 0, 1.8, 0, Math.PI * 2); ctx.fill(); });
    for (const bullet of state.saucerBullets) wrapped(bullet, 3, () => {
      ctx.strokeStyle = '#f3d5ac'; ctx.beginPath(); ctx.arc(0, 0, 2.3, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#c9d5cd';
    });
    for (const particle of state.particles) {
      ctx.globalAlpha = Math.min(1, particle.life * 2);
      line([[particle.x, particle.y], [particle.x - particle.vx * 0.025, particle.y - particle.vy * 0.025]]);
    }
    ctx.globalAlpha = 1;
    const ship = state.ship;
    if (ship && state.mode !== 'gameover' && (!ship.invulnerable || reducedMotion || Math.floor(state.time * 9) % 2 === 0)) {
      wrapped(ship, 26, () => {
        ctx.rotate(ship.angle); ctx.strokeStyle = '#eff8f1';
        // Twin SANWEAR-inspired earbud shells and a swept headset band.
        // The open front (positive X) keeps the flight direction legible.
        line([[-18,0],[-18,-13],[-12,-17],[8,-17],[18,-10],[18,0]]);
        line([[-18,0],[-18,13],[-12,17],[8,17],[18,10],[18,0]]);
        line([[-13,-9],[-5,-9],[1,-14],[11,-11],[14,-6],[5,-5],[-5,-6]], true);
        line([[-13,9],[-5,9],[1,14],[11,11],[14,6],[5,5],[-5,6]], true);
        line([[-10,-7],[3,-12],[10,-8],[-10,-7],[2,-5],[3,-12]]);
        line([[-10,7],[3,12],[10,8],[-10,7],[2,5],[3,12]]);
        // Separate silicone tips point into the headset's open center.
        line([[-2,-5],[-2,-2],[5,-2],[5,-5]]);
        line([[-2,5],[-2,2],[5,2],[5,5]]);
        line([[-18,0],[18,0]]);
        line([[14,-6],[21,0],[14,6]]);
        if (input().thrust && state.mode === 'playing') {
          line([[-18,-4],[-24 - Math.sin(now * 0.06) * 4,0],[-18,4]]);
        }
        if (ship.invulnerable > 0 && reducedMotion) { ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc(0, 0, 24, 0, Math.PI * 2); ctx.stroke(); }
      });
    }
    ctx.globalAlpha = 1;
  }
  resize();
  const attractRocks = Array.from({ length: 8 }, (_, i) => ({
    x: state.width * ((i * 0.287 + 0.09) % 1), y: state.height * ((i * 0.361 + 0.16) % 1),
    radius: 25 + (i % 3) * 19, angle: i, vertices: Array.from({ length: 11 }, (__, j) => 0.72 + ((i * 7 + j * 3) % 9) / 32)
  }));
  function frame(now) {
    accumulator += Math.min(Math.max(0, (now - last) / 1000), 0.08); last = now;
    const oldMode = state.mode, oldWave = state.wave, oldLives = state.lives;
    const controls = input();
    while (accumulator >= 1 / 120) {
      // Keep even very short taps; consume each edge once, not each substep.
      controls.firePressed = firePresses > 0;
      if (firePresses > 0) firePresses--;
      game.step(1 / 120, controls); accumulator -= 1 / 120;
    }
    if (oldMode !== state.mode || oldWave !== state.wave || oldLives !== state.lives) {
      $('announcement').textContent = state.mode === 'gameover' ? `Game over. ${state.score} points.` : `Level ${state.wave}. ${state.lives} ships.`;
      if (state.mode === 'gameover') {
        release(); $('start').focus();
        if (window.HasterradScores) window.HasterradScores.finish(accountRun, {
          large: state.killsBySize[3], medium: state.killsBySize[2], small: state.killsBySize[1],
          saucerLarge: state.saucerKills.large, saucerSmall: state.saucerKills.small,
          wave: state.wave, duration_ms: Math.round(state.time * 1000)
        });
        accountRun = null;
      }
    }
    sync(); draw(now); requestAnimationFrame(frame);
  }
  // Detached snapshots only: no setters, stepping, spawning, or production cheats.
  Object.defineProperty(window, 'AsteroidsDebug', { value: Object.freeze({
    snapshot: () => ({ mode: state.mode, score: state.score, highScore: state.highScore,
      lives: state.lives, wave: state.wave, rocks: state.rocks.length, bullets: state.bullets.length,
      width: state.width, height: state.height, ship: state.ship ? { ...state.ship } : null })
  }), writable: false, configurable: false });
  sync(); requestAnimationFrame(frame);
})();
