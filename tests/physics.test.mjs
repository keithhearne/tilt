// Checks that the game's physics matches the research simulation and closed forms.
// Run: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { G, createWorld, addBall, step, seatedHole, filledHoles } from '../js/physics.js';
import { buildWorld, PRESETS, OPTIONS, settingsKey } from '../js/levels.js';

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
  for (const balls of OPTIONS.balls.values) for (const obstacles of OPTIONS.obstacles.values) for (const plate of OPTIONS.plate.values) for (const cupSize of OPTIONS.cupSize.values) for (const hole of OPTIONS.hole.values) for (const ballSize of OPTIONS.ballSize.values) {
    const W = buildWorld({ balls, ballSize, hole, cupSize, rolling: 'tuned', plate, obstacles }, () => 0.3);
    for (let i = 0; i < W.obstacles.length; i++) for (let j = i + 1; j < W.obstacles.length; j++) {
      const g = obstacleGap(W.obstacles[i], W.obstacles[j]);
      assert.ok(g >= 1.4 * 2 * W.R, `${balls} balls, ${obstacles}, ${plate}, ${hole}, ${cupSize} cups, ${ballSize} balls: ${W.obstacles[i].kind}-${W.obstacles[j].kind} gap ${(g * 1000).toFixed(1)}mm`);
    }
    for (const o of W.obstacles) {
      const out = Math.max(Math.hypot(o.x1, o.y1), Math.hypot(o.x2, o.y2)) + o.r;
      assert.ok(W.plateR - out >= 1.4 * 2 * W.R, `${balls} balls, ${obstacles}, ${plate}, ${hole}, ${ballSize} balls: ${o.kind} too near the plate edge`);
    }
  }
});

test('smaller cups hold harder against a quick flick', () => {
  // Ramp to the tilt over 0.1 s and hold: smaller cups leave less room for a run-up
  const flickOut = (a) => {
    const h = { x: 0, y: 0, a, d: R * (1 - Math.cos(deg(30))) };
    for (let th = 1; th <= 35; th += 1) {
      const { W, b } = settled(h);
      for (let i = 0; i < 1.1 / W.dt; i++) {
        const [gx, gz] = tilt(Math.min(1, (i * W.dt) / 0.1) * th);
        step(W, gx, 0, gz);
        if (!seatedHole(W, b) && b.z >= R - 1e-5) return th;
      }
    }
    return Infinity;
  };
  const large = flickOut(0.016), medium = flickOut(0.012), small = flickOut(0.008);
  assert.ok(large < medium && medium < small, `large ${large}, medium ${medium}, small ${small}`);
});

test('the old best-time keys still work for large cups and pockets', () => {
  assert.equal(settingsKey({ ...PRESETS.medium, cupSize: 'large' }), '5-deep-tuned-normal-none');
  assert.equal(settingsKey({ ...PRESETS.easy, cupSize: 'small' }), '3-pocket-tuned-normal-none');
  assert.equal(settingsKey({ ...PRESETS.medium, cupSize: 'small' }), '5-deep-tuned-normal-none-small');
});

test('holes never crowd each other or an obstacle', () => {
  for (const balls of OPTIONS.balls.values) for (const obstacles of OPTIONS.obstacles.values) for (const cupSize of OPTIONS.cupSize.values) for (const hole of OPTIONS.hole.values) for (const ballSize of OPTIONS.ballSize.values) {
    const W = buildWorld({ balls, ballSize, hole, cupSize, rolling: 'tuned', plate: 'normal', obstacles }, () => 0.3);
    const where = `${balls} balls, ${ballSize}, ${hole}, ${cupSize}, ${obstacles}`;
    for (let i = 0; i < W.holes.length; i++) for (let j = i + 1; j < W.holes.length; j++) {
      const a = W.holes[i], b = W.holes[j];
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) - a.a - b.a >= 2 * W.R, `${where}: holes closer than a ball width`);
    }
    for (const o of W.obstacles) for (const h of W.holes) {
      assert.ok(obstacleGap(o, { x1: h.x, y1: h.y, x2: h.x, y2: h.y, r: h.a }) > 0.005, `${where}: ${o.kind} touches a hole`);
    }
  }
});

test('five holes sit close to the centre', () => {
  const W = buildWorld({ ...PRESETS.medium }, () => 0.3);
  for (const h of W.holes) assert.ok(Math.abs(Math.hypot(h.x, h.y) - 0.045) < 1e-9);
});

test('ball size scales the ball and its holes together', () => {
  const sizes = OPTIONS.ballSize.values.map((ballSize) => buildWorld({ ...PRESETS.medium, ballSize }, () => 0.3));
  const [small, medium, large] = sizes;
  assert.ok(small.R < medium.R && medium.R < large.R);
  for (const W of sizes) assert.ok(Math.abs(W.holes[0].a / W.R - 1.6) < 1e-9, 'large cups stay 1.6 ball radii');
  assert.equal(medium.R, 0.01);
});

test('two balls sharing one big cup fill only one hole', () => {
  // Large balls in large deep cups: the cup is 40 mm across, room for two 25 mm balls
  const W = buildWorld({ ...PRESETS.medium, balls: 3, ballSize: 'large' }, () => 0.3);
  const [h1, h2] = W.holes;
  const [a, b, c] = W.balls;
  // Two balls side by side in the first cup, the third in the second cup
  for (const [ball, x, y] of [[a, h1.x - 0.6 * W.R * h1.uy, h1.y + 0.6 * W.R * h1.ux], [b, h1.x + 1.5 * W.R * h1.uy, h1.y - 1.5 * W.R * h1.ux], [c, h2.x, h2.y]]) {
    ball.x = x; ball.y = y; ball.z = W.R - h1.d + 1e-6;
  }
  run(W, 0.5, 0, 0, G);
  assert.ok(W.balls.every((ball) => seatedHole(W, ball)), 'all three balls should be seated');
  assert.equal(seatedHole(W, a), seatedHole(W, b), 'two balls share the first cup');
  assert.equal(filledHoles(W), 2, 'only two of three holes are filled');
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
