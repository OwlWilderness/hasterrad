/* Original dependency-free vector arcade simulation. */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const wrap = (value, size) => ((value % size) + size) % size;
  function createGame(options = {}) {
    const random = options.random || Math.random;
    let fireHeld = false;
    const state = { width: 1200, height: 800, mode: 'ready', score: 0,
      highScore: Math.max(0, Number(options.highScore) || 0), lives: 3, wave: 0,
      ship: null, rocks: [], bullets: [], particles: [], saucer: null, saucerBullets: [],
      saucerTimer: 12, saucerVisits: 0, saucerKills: { large: 0, small: 0 },
      time: 0, waveDelay: 0, killsBySize: [0, 0, 0, 0] };
    function respawn() {
      state.ship = { x: state.width / 2, y: state.height / 2, vx: 0, vy: 0,
        angle: -Math.PI / 2, invulnerable: 3, cooldown: 0, hyperCooldown: 0, dead: 0 };
    }
    function rock(x, y, size) {
      const angle = random() * TAU;
      const speed = (42 + random() * 35 + state.wave * 5) * (1 + (3 - size) * 0.45);
      return { x, y, size, radius: [0, 14, 27, 49][size], vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed, angle: random() * TAU, spin: (random() - 0.5) * 0.8,
        vertices: Array.from({ length: 11 }, () => 0.72 + random() * 0.28) };
    }
    function nextWave() {
      state.wave++; state.waveDelay = 0;
      for (let i = 0; i < Math.min(3 + state.wave, 13); i++) {
        const a = TAU * (i / Math.min(3 + state.wave, 13)) + random() * 0.3;
        state.rocks.push(rock(wrap(state.width / 2 + Math.cos(a) * state.width * 0.41, state.width),
          wrap(state.height / 2 + Math.sin(a) * state.height * 0.41, state.height), 3));
      }
    }
    function start() {
      Object.assign(state, { mode: 'playing', score: 0, lives: 3, wave: 0,
        rocks: [], bullets: [], particles: [], saucer: null, saucerBullets: [],
        saucerTimer: 12, saucerVisits: 0, saucerKills: { large: 0, small: 0 },
        time: 0, waveDelay: 0, killsBySize: [0, 0, 0, 0] });
      fireHeld = false;
      respawn(); nextWave();
    }
    function pause() {
      if (state.mode === 'playing') state.mode = 'paused';
      else if (state.mode === 'paused') state.mode = 'playing';
    }
    function move(body, dt) {
      body.x = wrap(body.x + body.vx * dt, state.width);
      body.y = wrap(body.y + body.vy * dt, state.height);
    }
    function distance(a, b) {
      const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
      return Math.hypot(Math.min(dx, state.width - dx), Math.min(dy, state.height - dy));
    }
    function burst(x, y, count) {
      for (let i = 0; i < count; i++) {
        const a = random() * TAU, speed = 25 + random() * 150;
        state.particles.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
          life: 0.3 + random() * 0.6 });
      }
      state.particles = state.particles.slice(-220);
    }
    function step(dt, input = {}) {
      if (state.mode !== 'playing') return;
      dt = Math.min(Math.max(dt, 0), 0.04); state.time += dt;
      const ship = state.ship;
      if (Number.isFinite(input.targetAngle)) {
        const delta = Math.atan2(Math.sin(input.targetAngle - ship.angle),
          Math.cos(input.targetAngle - ship.angle));
        ship.angle += Math.max(-4.2 * dt, Math.min(4.2 * dt, delta));
      } else {
        ship.angle += ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * 4.2 * dt;
      }
      if (input.thrust) {
        ship.vx += Math.cos(ship.angle) * 290 * dt;
        ship.vy += Math.sin(ship.angle) * 290 * dt;
      }
      const speed = Math.hypot(ship.vx, ship.vy);
      if (speed > 440) { ship.vx *= 440 / speed; ship.vy *= 440 / speed; }
      ship.vx *= Math.pow(0.99, dt * 60); ship.vy *= Math.pow(0.99, dt * 60);
      move(ship, dt);
      ship.invulnerable = Math.max(0, ship.invulnerable - dt);
      ship.cooldown -= dt;
      // Consume edges even at the cap; a rejected tap is never queued for later.
      const firePressed = input.firePressed === undefined ? input.fire && !fireHeld : input.firePressed;
      fireHeld = Boolean(input.fire);
      const autoFire = state.wave >= 2;
      const fireCooldown = state.wave >= 5 ? 0.12 : 0.28;
      if ((firePressed || (autoFire && input.fire && ship.cooldown <= 0)) && state.bullets.length < 4) {
        state.bullets.push({ x: wrap(ship.x + Math.cos(ship.angle) * 20, state.width),
          y: wrap(ship.y + Math.sin(ship.angle) * 20, state.height),
          vx: ship.vx + Math.cos(ship.angle) * 700, vy: ship.vy + Math.sin(ship.angle) * 700,
          life: 0.95 });
        ship.cooldown = fireCooldown;
      }
      for (const bullet of state.bullets) { move(bullet, dt); bullet.life -= dt; }
      state.bullets = state.bullets.filter(bullet => bullet.life > 0);
      for (const asteroid of state.rocks) { move(asteroid, dt); asteroid.angle += asteroid.spin * dt; }
      if (!state.saucer) {
        state.saucerTimer -= dt;
        if (state.saucerTimer <= 0) {
          const direction = random() < 0.5 ? 1 : -1;
          const size = state.saucerVisits++ % 2 ? 'small' : 'large';
          state.saucer = { size, x: direction > 0 ? 0 : state.width, y: random() * state.height,
            vx: direction * (size === 'small' ? 150 : 110), vy: 0,
            radius: size === 'small' ? 13 : 23, cooldown: 1 };
        }
      } else {
        const saucer = state.saucer;
        saucer.x += saucer.vx * dt;
        saucer.y = wrap(saucer.y + saucer.vy * dt, state.height);
        saucer.cooldown -= dt;
        if (saucer.cooldown <= 0) {
          const dx = wrap(ship.x - saucer.x + state.width / 2, state.width) - state.width / 2;
          const dy = wrap(ship.y - saucer.y + state.height / 2, state.height) - state.height / 2;
          const spread = saucer.size === 'small' ? 0.12 : 0.9;
          const angle = Math.atan2(dy, dx) + (random() - 0.5) * spread;
          state.saucerBullets.push({ x: wrap(saucer.x, state.width), y: saucer.y,
            vx: Math.cos(angle) * 230, vy: Math.sin(angle) * 230, life: 2 });
          state.saucerBullets = state.saucerBullets.slice(-6);
          saucer.cooldown = saucer.size === 'small' ? 0.8 : 1.5;
        }
        if (saucer.x < -saucer.radius || saucer.x > state.width + saucer.radius) {
          state.saucer = null; state.saucerTimer = 12;
        }
      }
      for (const bullet of state.saucerBullets) { move(bullet, dt); bullet.life -= dt; }
      state.saucerBullets = state.saucerBullets.filter(b => b.life > 0);
      ship.hyperCooldown = Math.max(0, ship.hyperCooldown - dt);
      if (input.hyperspace && ship.hyperCooldown === 0) {
        burst(ship.x, ship.y, 18);
        // Pick the safest of several random destinations; shield covers the arrival.
        let best = null, clearance = -1;
        for (let i = 0; i < 12; i++) {
          const candidate = { x: random() * state.width, y: random() * state.height };
          const gap = Math.min(...state.rocks.map(r => distance(candidate, r) - r.radius), 1000);
          if (gap > clearance) { best = candidate; clearance = gap; }
        }
        Object.assign(ship, best, { vx: 0, vy: 0, invulnerable: 1.2, hyperCooldown: 5 });
      }
      // Environmental impacts destroy either enemy variant, once, without
      // attributing a player kill or splitting/scoring the surviving rock.
      if (state.saucer && state.rocks.some(r => distance(state.saucer, r) < state.saucer.radius + r.radius)) {
        burst(state.saucer.x, state.saucer.y, 16);
        state.saucer = null; state.saucerTimer = 12;
      }
      // A bullet can destroy only one rock; split children wait until the next tick.
      const children = [];
      for (const bullet of state.bullets) {
        if (bullet.life <= 0) continue;
        if (state.saucer && distance(bullet, state.saucer) < state.saucer.radius + 2) {
          const saucer = state.saucer;
          bullet.life = 0;
          state.saucer = null;
          state.saucerTimer = 12;
          state.saucerKills[saucer.size]++;
          state.score += saucer.size === 'small' ? 1000 : 200;
          state.highScore = Math.max(state.highScore, state.score);
          burst(saucer.x, saucer.y, 16);
          continue;
        }
        const index = state.rocks.findIndex(r => distance(bullet, r) < r.radius + 2);
        if (index < 0) continue;
        const asteroid = state.rocks.splice(index, 1)[0];
        bullet.life = 0; state.score += [0, 100, 50, 20][asteroid.size];
        state.killsBySize[asteroid.size]++;
        state.highScore = Math.max(state.highScore, state.score);
        burst(asteroid.x, asteroid.y, 12);
        if (asteroid.size > 1) {
          for (let i = 0; i < 2; i++) children.push(rock(asteroid.x, asteroid.y, asteroid.size - 1));
        }
      }
      state.rocks.push(...children);
      state.bullets = state.bullets.filter(b => b.life > 0);
      const hostileShot = state.saucerBullets.find(b => distance(ship, b) < 11);
      if (hostileShot) state.saucerBullets = state.saucerBullets.filter(b => b !== hostileShot);
      const saucerHit = state.saucer && distance(ship, state.saucer) < state.saucer.radius + 9;
      if (ship.invulnerable <= 0 && (state.rocks.some(r => distance(ship, r) < r.radius + 9) || saucerHit || hostileShot)) {
        if (saucerHit) { state.saucer = null; state.saucerTimer = 12; }
        burst(ship.x, ship.y, 35); state.lives--;
        if (state.lives === 0) state.mode = 'gameover';
        else respawn();
      }
      for (const particle of state.particles) { move(particle, dt); particle.life -= dt; }
      state.particles = state.particles.filter(p => p.life > 0);
      if (state.rocks.length === 0 && state.mode === 'playing') {
        state.waveDelay += dt;
        if (state.waveDelay >= 1.2) { nextWave(); state.ship.invulnerable = Math.max(2, state.ship.invulnerable); }
      }
    }
    return { state, start, pause, step };
  }
  const api = Object.freeze({ createGame });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AsteroidsCore = api;
})(typeof globalThis === 'object' ? globalThis : this);
