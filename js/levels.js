// Difficulty settings and the level layout they produce.
// Hole and rolling values come from research/results.txt, sections 10-12.

import { createWorld, addBall } from './physics.js';

const deg = (x) => (x * Math.PI) / 180;

export const OPTIONS = {
  balls: { label: 'Balls', values: [1, 3, 5, 7] },
  hole: {
    label: 'Holes',
    values: ['pocket', 'deep', 'shallow'],
    names: { pocket: 'Pocket', deep: 'Deep cup', shallow: 'Shallow cup' },
  },
  rolling: { label: 'Rolling', values: ['tuned', 'real'], names: { tuned: 'Tuned', real: 'Real steel' } },
  plate: { label: 'Plate', values: ['small', 'normal', 'large'], names: { small: 'Small', normal: 'Normal', large: 'Large' } },
  obstacles: {
    label: 'Obstacles',
    values: ['none', 'posts', 'guards', 'both'],
    names: { none: 'None', posts: 'Posts', guards: 'Guards', both: 'Both' },
  },
};

export const PRESETS = {
  easy: { balls: 3, hole: 'pocket', rolling: 'tuned', plate: 'normal', obstacles: 'none' },
  medium: { balls: 5, hole: 'deep', rolling: 'tuned', plate: 'normal', obstacles: 'none' },
  hard: { balls: 5, hole: 'shallow', rolling: 'tuned', plate: 'normal', obstacles: 'posts' },
  expert: { balls: 7, hole: 'shallow', rolling: 'real', plate: 'normal', obstacles: 'posts' },
};

// Pocket: a seated ball sits 0.3R proud, so others bounce off it like a post.
// Deeper pockets leave a dip round the seated ball that traps passing balls.
// Cups: 1.6R wide; depth sets the slow escape tilt (30 or 15 degrees).
const HOLES = {
  pocket: (R) => ({ a: 1.1 * R, d: 1.7 * R }),
  deep: (R) => ({ a: 1.6 * R, d: R * (1 - Math.cos(deg(30))) }),
  shallow: (R) => ({ a: 1.6 * R, d: R * (1 - Math.cos(deg(15))) }),
};
const ROLLING = { tuned: 0.01, real: 0.002 };
// Everything scales with the plate, so a bigger plate looks the same but plays slower.
const PLATE_SCALE = { small: 0.67, normal: 1, large: 1.33 };

export function settingsKey(s) {
  return `${s.balls}-${s.hole}-${s.rolling}-${s.plate}-${s.obstacles}`;
}

export function presetOf(s) {
  for (const [name, p] of Object.entries(PRESETS)) if (settingsKey(p) === settingsKey(s)) return name;
  return null;
}

export function buildWorld(s, rand = Math.random) {
  const k = PLATE_SCALE[s.plate];
  const R = 0.01 * k, plateR = 0.15 * k, ringR = 0.07 * k;
  const n = s.balls;
  const holes = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * 2 * Math.PI + Math.PI / 2;
    const r = n === 1 ? 0 : ringR;
    holes.push({ x: r * Math.cos(ang), y: r * Math.sin(ang), ux: Math.cos(ang), uy: Math.sin(ang), ...HOLES[s.hole](R) });
  }
  const obstacles = [];
  if (s.obstacles === 'posts' || s.obstacles === 'both') {
    // With guards too, the posts are staggered onto the hole ring, one between
    // each pair of holes. At the outer radius they line up with the guard ends
    // and close off every way in.
    const guarded = s.obstacles === 'both';
    const m = guarded && n > 1 ? n : Math.max(5, n);
    const r = n === 1 ? 0.6 * plateR : guarded ? ringR : (ringR + plateR) / 2;
    for (let i = 0; i < m; i++) {
      const ang = ((i + 0.5) / m) * 2 * Math.PI + Math.PI / 2;
      obstacles.push({ x1: r * Math.cos(ang), y1: r * Math.sin(ang), x2: r * Math.cos(ang), y2: r * Math.sin(ang), r: 0.005 * k, kind: 'post' });
    }
  }
  if (s.obstacles === 'guards' || s.obstacles === 'both') {
    // A short wall on the rim side of each hole, so it has to be entered from the centre side
    for (const h of holes) {
      const off = h.a + R + 0.003 * k, half = h.a + R;
      const cx = h.x + off * h.ux, cy = h.y + off * h.uy;
      obstacles.push({ x1: cx - half * h.uy, y1: cy + half * h.ux, x2: cx + half * h.uy, y2: cy - half * h.ux, r: 0.002 * k, kind: 'guard' });
    }
  }
  const W = createWorld({ R, c: ROLLING[s.rolling], plateR, holes, obstacles });
  // Balls start spread along the rim
  const start = rand() * 2 * Math.PI;
  for (let i = 0; i < n; i++) {
    const ang = start + (i / n) * 2 * Math.PI;
    const r = plateR - R - 0.001 * k;
    addBall(W, r * Math.cos(ang), r * Math.sin(ang));
  }
  return W;
}
