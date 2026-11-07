// Checks that the game's physics matches the research simulation and closed forms.
// Run: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { G, createWorld, addBall, step, seatedHole } from '../js/physics.js';
import { buildWorld, PRESETS, OPTIONS } from '../js/levels.js';

const deg = (x) => (x * Math.PI) / 180;
const tilt = (t) => [G * Math.sin(deg(t)), G * Math.cos(deg(t))];
const R = 0.01;
const cup30 = { x: 0, y: 0, a: 0.016, d: R * (1 - Math.cos(deg(30))) };

function run(W, seconds, gx, gy, gz, until) {
  for (let i = 0; i < seconds / W.dt; i++) {
    step(W, gx, gy, gz);
    if (until && until()) return i * W.dt;
  }
  return null;
}

function settled(hole) {
  const W = createWorld({ R, c: 0.01, plateR: 0.15, holes: [hole] });
  const b = addBall(W, hole.x, hole.y);
  b.z = R - hole.d + 1e-6;
  run(W, 0.1, 0, 0, G);
  return { W, b };
}

test('rolling acceleration is 5/7 g (sin t - c cos t)', () => {
  for (const t of [1, 5, 10]) {
    const W = createWorld({ R, c: 0.01, plateR: 10, holes: [] });
    const b = addBall(W, 0, 0);
    const [gx, gz] = tilt(t);
    run(W, 0.3, gx, 0, gz);
    const expected = (5 / 7) * G * (Math.sin(deg(t)) - 0.01 * Math.cos(deg(t)));
    assert.ok(Math.abs(b.vx / 0.3 - expected) / expected < 0.01, `tilt ${t}: ${b.vx / 0.3} vs ${expected}`);
  }
});

test('ball stays put below the rolling-resistance breakaway tilt', () => {
  const W = createWorld({ R, c: 0.01, plateR: 10, holes: [] });
  const b = addBall(W, 0, 0);
  const [gx, gz] = tilt(0.5);
  run(W, 1, gx, 0, gz);
  assert.ok(Math.abs(b.x) < 1e-5);
});

test('deep cup holds against a slow tilt to 28 degrees and releases near 30', () => {
  const { W, b } = settled(cup30);
  const out = () => Math.hypot(b.x, b.y) > cup30.a + 0.001 && b.z >= R - 1e-5;
  // 1 degree per second, from flat
  let escapedAt = null;
  for (let i = 0; i < 35 / W.dt; i++) {
    const [gx, gz] = tilt(i * W.dt);
    step(W, gx, 0, gz);
    if (out()) { escapedAt = i * W.dt; break; }
  }
  assert.ok(escapedAt > 28 && escapedAt < 32, `escaped at ${escapedAt}`);
});

test('deep cup is knocked out by a quick 8 degree tilt', () => {
  const { W, b } = settled(cup30);
  const out = () => Math.hypot(b.x, b.y) > cup30.a + 0.001 && b.z >= R - 1e-5;
  const steps = 1.2 / W.dt;
  let escaped = false;
  for (let i = 0; i < steps && !escaped; i++) {
    const [gx, gz] = tilt(Math.min(1, (i * W.dt) / 0.1) * 8);
    step(W, gx, 0, gz);
    escaped = out();
  }
  assert.ok(escaped);
});

test('deep cup catches a slow ball and lets a fast one through', () => {
  for (const [v, caught] of [[0.08, true], [0.3, false]]) {
    const W = createWorld({ R, c: 0.01, plateR: 0.5, holes: [cup30] });
    const b = addBall(W, -0.017, 0);
    b.vx = v; b.wy = v / R;
    run(W, 2, 0, 0, G);
    assert.equal(seatedHole(W, b) !== null, caught, `speed ${v}`);
  }
});

test('a filled pocket deflects other balls and never traps them', () => {
  const pocket = { x: 0, y: 0, a: 0.011, d: 0.017 };
  for (const [off, v] of [[0, 0.1], [0.5, 0.1], [0.5, 0.25], [0, 0.25]]) {
    const W = createWorld({ R, c: 0.01, plateR: 0.5, holes: [pocket] });
    const first = addBall(W, 0, 0);
    first.z = R - pocket.d + 1e-6;
    run(W, 0.2, 0, 0, G);
    const second = addBall(W, -0.04, off * R);
    second.vx = v; second.wy = v / R;
    run(W, 1.5, 0, 0, G);
    // A gentle sideways tilt always rolls it clear
    const [gy, gz] = tilt(2);
    run(W, 2, 0, gy, gz);
    assert.ok(seatedHole(W, first), 'seated ball stays in');
    assert.ok(!seatedHole(W, second) && Math.hypot(second.x, second.y) > 0.025, `offset ${off} speed ${v}: second ball stuck`);
  }
});

// Narrowest clear gap between two capsule obstacles, by sampling along each
function obstacleGap(o, p) {
  let best = Infinity;
  for (let i = 0; i <= 40; i++) for (let j = 0; j <= 40; j++) {
    const ax = o.x1 + ((o.x2 - o.x1) * i) / 40, ay = o.y1 + ((o.y2 - o.y1) * i) / 40;
    const bx = p.x1 + ((p.x2 - p.x1) * j) / 40, by = p.y1 + ((p.y2 - p.y1) * j) / 40;
    best = Math.min(best, Math.hypot(ax - bx, ay - by) - o.r - p.r);
  }
  return best;
}

test('every obstacle layout leaves gaps a ball fits through comfortably', () => {
  for (const balls of OPTIONS.balls.values) for (const obstacles of OPTIONS.obstacles.values) for (const plate of OPTIONS.plate.values) {
    const W = buildWorld({ balls, hole: 'shallow', rolling: 'tuned', plate, obstacles }, () => 0.3);
    for (let i = 0; i < W.obstacles.length; i++) for (let j = i + 1; j < W.obstacles.length; j++) {
      const g = obstacleGap(W.obstacles[i], W.obstacles[j]);
      assert.ok(g >= 1.4 * 2 * W.R, `${balls} balls, ${obstacles}, ${plate}: ${W.obstacles[i].kind}-${W.obstacles[j].kind} gap ${(g * 1000).toFixed(1)}mm`);
    }
  }
});

test('every preset builds a world whose balls start on the plate and clear of obstacles', () => {
  for (const s of Object.values(PRESETS)) {
    const W = buildWorld(s, () => 0.3);
    assert.equal(W.balls.length, s.balls);
    assert.equal(W.holes.length, s.balls);
    for (const b of W.balls) assert.ok(Math.hypot(b.x, b.y) <= W.plateR - W.R + 1e-9);
    run(W, 0.5, 0, 0, G);
    for (const b of W.balls) assert.ok(Math.abs(b.z - W.R) < 1e-4, 'balls should rest flat on the plate');
  }
});
