// Difficulty settings and the level layout they produce.
// Hole and rolling values come from research/results.txt, sections 10-12.

import { createWorld, addBall } from './physics.js';

const deg = (x) => (x * Math.PI) / 180;

export const OPTIONS = {
  balls: { label: 'Balls', values: [1, 3, 5, 7] },
  ballSize: { label: 'Ball size', values: ['small', 'medium', 'large'], names: { small: 'Small', medium: 'Medium', large: 'Large' } },
  hole: {
    label: 'Holes',
    values: ['pocket', 'deep', 'shallow'],
    names: { pocket: 'Pocket', deep: 'Deep cup', shallow: 'Shallow cup' },
  },
  cupSize: { label: 'Cup size', values: ['large', 'medium', 'small'], names: { large: 'Large', medium: 'Medium', small: 'Small' }, cupsOnly: true },
  rolling: { label: 'Rolling', values: ['tuned', 'real'], names: { tuned: 'Tuned', real: 'Real steel' } },
  speed: { label: 'Plate speed', values: ['slow', 'normal', 'fast'], names: { slow: 'Slow', normal: 'Normal', fast: 'Fast' } },
  obstacles: {
    label: 'Obstacles',
    values: ['none', 'posts', 'guards', 'both'],
    names: { none: 'None', posts: 'Posts', guards: 'Guards', both: 'Both' },
  },
  edge: { label: 'Plate edge', values: ['wall', 'open'], names: { wall: 'Walled', open: 'Open' } },
};

export const PRESETS = {
  easy: { balls: 3, ballSize: 'medium', hole: 'pocket', cupSize: 'large', rolling: 'tuned', speed: 'normal', obstacles: 'none', edge: 'wall' },
  medium: { balls: 5, ballSize: 'medium', hole: 'deep', cupSize: 'large', rolling: 'tuned', speed: 'normal', obstacles: 'none', edge: 'wall' },
  hard: { balls: 5, ballSize: 'medium', hole: 'shallow', cupSize: 'large', rolling: 'tuned', speed: 'normal', obstacles: 'posts', edge: 'wall' },
  expert: { balls: 7, ballSize: 'medium', hole: 'shallow', cupSize: 'large', rolling: 'real', speed: 'normal', obstacles: 'posts', edge: 'wall' },
};

// Pocket: a seated ball sits 0.3R proud, so others bounce off it like a post.
// Deeper pockets leave a dip round the seated ball that traps passing balls.
// Cups: depth sets the slow escape tilt (30 or 15 degrees); radius sets how
// wide a target they are and how hard a quick flick has to be to empty them.
const HOLES = {
  pocket: (R) => ({ a: 1.1 * R, d: 1.7 * R }),
  deep: (R, a) => ({ a: a * R, d: R * (1 - Math.cos(deg(30))) }),
  shallow: (R, a) => ({ a: a * R, d: R * (1 - Math.cos(deg(15))) }),
};
// Cup radius as a multiple of the ball radius: 32, 24 and 16 mm across for a 20 mm ball
const CUP_RADIUS = { large: 1.6, medium: 1.2, small: 0.8 };
const ROLLING = { tuned: 0.01, real: 0.002 };
// How fast the physics runs against real time. Slow plays like a tray twice
// the size, fast like one half the size; the timer always counts real seconds.
const SPEED = { slow: 0.7, normal: 1, fast: 1.3 };
const PLATE_RADIUS = 0.15;
// Radius of the circle the holes sit on, in metres.
// Five holes sit in close, about a ball's width apart; one hole is central.
const HOLE_RING = { 1: 0, 3: 0.07, 5: 0.045, 7: 0.07 };
// Ball diameter 16, 20 or 25 mm. Holes are sized to the ball,
// so a bigger ball means bigger holes, a more crowded plate and a more
// forgiving catch; the tilt needed to roll a ball does not change with size.
const BALL_SCALE = { small: 0.8, medium: 1, large: 1.25 };

export function settingsKey(s) {
  // Settings added later only appear when changed from their original value,
  // so best times saved before they existed keep their keys. Speed sits where
  // the old plate size was; both were "normal" by default.
  const size = s.hole !== 'pocket' && s.cupSize && s.cupSize !== 'large' ? `-${s.cupSize}` : '';
  const ball = s.ballSize && s.ballSize !== 'medium' ? `-ball-${s.ballSize}` : '';
  const edge = s.edge === 'open' ? '-open' : '';
  return `${s.balls}-${s.hole}-${s.rolling}-${s.speed ?? 'normal'}-${s.obstacles}${size}${ball}${edge}`;
}

export function presetOf(s) {
  for (const [name, p] of Object.entries(PRESETS)) if (settingsKey(p) === settingsKey(s)) return name;
  return null;
}

// Every gap between obstacles, and between the guards and the plate edge,
// must be at least this many ball diameters.
const MIN_GAP = 1.4;

export function buildWorld(s, rand = Math.random) {
  const R = 0.01 * BALL_SCALE[s.ballSize ?? 'medium'], plateR = PLATE_RADIUS;
  const n = s.balls;
  const shape = HOLES[s.hole](R, CUP_RADIUS[s.cupSize ?? 'large']);
  // Start from the usual ring (pushed out if big holes would sit less than a
  // ball's width apart), then widen it until every gap fits a ball comfortably.
  // If even that runs out of room (7 large balls with guards),
  // the guards are shortened to just cover their holes, then moved in closer.
  const firstRing = n > 1 ? Math.max(HOLE_RING[n], (2 * shape.a + 2 * R + 0.0005) / (2 * Math.sin(Math.PI / n))) : 0;
  let ringR, layout;
  for (const guard of [{ overhang: R, slack: 0.003 }, { overhang: 0.3 * R, slack: 0.003 }, { overhang: 0.3 * R, slack: 0.001 }]) {
    ringR = firstRing;
    layout = lay(s, R, plateR, ringR, shape, guard);
    while (n > 1 && narrowest(layout, R, plateR) < MIN_GAP * 2 * R && ringR < 0.6 * plateR) {
      ringR += 0.001;
      layout = lay(s, R, plateR, ringR, shape, guard);
    }
    if (narrowest(layout, R, plateR) >= MIN_GAP * 2 * R) break;
  }
  const open = s.edge === 'open';
  const W = createWorld({ R, c: ROLLING[s.rolling], plateR, holes: layout.holes, obstacles: layout.obstacles, open });
  W.timeScale = SPEED[s.speed ?? 'normal'];
  // Balls start spread along the rim. With an open edge they start a little
  // further in, so a slightly-off level at Go doesn't tip one straight off;
  // obstacles keep at least 2.8R clear of the edge, so this never overlaps one.
  const start = rand() * 2 * Math.PI;
  for (let i = 0; i < n; i++) {
    const ang = start + (i / n) * 2 * Math.PI;
    const r = open ? plateR - 1.5 * R : plateR - R - 0.001;
    addBall(W, r * Math.cos(ang), r * Math.sin(ang));
  }
  return W;
}

function lay(s, R, plateR, ringR, shape, guard) {
  const n = s.balls;
  const holes = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * 2 * Math.PI + Math.PI / 2;
    holes.push({ x: ringR * Math.cos(ang), y: ringR * Math.sin(ang), ux: Math.cos(ang), uy: Math.sin(ang), ...shape });
  }
  const obstacles = [];
  if (s.obstacles === 'posts' || s.obstacles === 'both') {
    // With guards too, the posts are staggered onto the hole ring, one between
    // each pair of holes. At the outer radius they line up with the guard ends
    // and close off every way in.
    const guarded = s.obstacles === 'both';
    const m = guarded && n > 1 ? n : Math.max(5, n);
    // Otherwise half way out to the rim, but never so far out that a ball can't pass behind
    const outer = Math.min(n === 1 ? 0.6 * plateR : (ringR + plateR) / 2, plateR - (MIN_GAP + 0.05) * 2 * R - 0.005);
    const r = guarded && n > 1 ? ringR : outer;
    for (let i = 0; i < m; i++) {
      const ang = ((i + 0.5) / m) * 2 * Math.PI + Math.PI / 2;
      obstacles.push({ x1: r * Math.cos(ang), y1: r * Math.sin(ang), x2: r * Math.cos(ang), y2: r * Math.sin(ang), r: 0.005, kind: 'post' });
    }
  }
  if (s.obstacles === 'guards' || s.obstacles === 'both') {
    // A short wall on the rim side of each hole, so it has to be entered from the centre side
    for (const h of holes) {
      // Sized for the largest cup whatever the hole, so smaller holes never pull
      // the guards in towards the posts
      const ga = Math.max(h.a, CUP_RADIUS.large * R);
      const off = ga + R + guard.slack, half = ga + guard.overhang;
      const cx = h.x + off * h.ux, cy = h.y + off * h.uy;
      obstacles.push({ x1: cx - half * h.uy, y1: cy + half * h.ux, x2: cx + half * h.uy, y2: cy - half * h.ux, r: 0.002, kind: 'guard' });
    }
  }
  return { holes, obstacles };
}

// Smallest clear gap between obstacles, or between an obstacle and the plate edge
function narrowest({ obstacles }, R, plateR) {
  let min = Infinity;
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    for (let j = i + 1; j < obstacles.length; j++) min = Math.min(min, segGap(o, obstacles[j]));
    min = Math.min(min, plateR - Math.max(Math.hypot(o.x1, o.y1), Math.hypot(o.x2, o.y2)) - o.r);
  }
  return min;
}

function segGap(o, p) {
  const d = Math.min(ptSeg(o.x1, o.y1, p), ptSeg(o.x2, o.y2, p), ptSeg(p.x1, p.y1, o), ptSeg(p.x2, p.y2, o));
  return d - o.r - p.r; // obstacles never cross, so end-point distances are enough
}

function ptSeg(x, y, o) {
  const ex = o.x2 - o.x1, ey = o.y2 - o.y1, L2 = ex * ex + ey * ey;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - o.x1) * ex + (y - o.y1) * ey) / L2)) : 0;
  return Math.hypot(x - (o.x1 + t * ex), y - (o.y1 + t * ey));
}
