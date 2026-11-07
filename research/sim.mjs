// THROWAWAY feasibility simulation. Not game code. No dependencies.
// Usage: node sim.mjs [validate|capture|dislodge|rate|impacts|cross|loop|pick|game|dtcheck|levels|levelGames|plates|hard|counts|sizes|obstacles|all]
//
// Rigid sphere on a plate, working in the plate's frame with SI units.
// Contacts use velocity impulses with restitution, Coulomb friction and a
// rolling-resistance torque, stepped at a very small dt. That is fine offline;
// a phone build would use a cheaper model calibrated against these numbers.
//
// Hole types, both with their centre at the origin:
//   seat: through-hole with radius a < R. Ball rests on the rim ring.
//   cup:  flat-bottomed recess with radius a > R and depth d < R.

const G = 9.81;
const deg = (x) => (x * Math.PI) / 180;
const rad2deg = (x) => (x * 180) / Math.PI;
const fmt = (x, n = 3) => (x === null || x === undefined ? '-' : Number(x).toFixed(n));

function ball(x, y, z, vx = 0, vy = 0, R = 0.005) {
  // Starts rolling without slipping: omega = z_hat x v / R
  return { x, y, z, vx, vy, vz: 0, wx: -vy / R, wy: vx / R, wz: 0 };
}

function world(o) {
  return {
    R: 0.005, e: 0.65, mu: 0.3, c: 0.002, hole: null, wallR: null, dt: 5e-6,
    vRest: 0.004, passes: 3, ...o,
  };
}

function contact(W, b, nx, ny, nz, gap) {
  const R = W.R;
  if (gap < 0) { b.x -= nx * gap; b.y -= ny * gap; b.z -= nz * gap; }
  const vn = b.vx * nx + b.vy * ny + b.vz * nz;
  if (vn >= 0) return;
  const er = -vn > W.vRest ? W.e : 0;
  const J = -(1 + er) * vn;
  b.vx += nx * J; b.vy += ny * J; b.vz += nz * J;
  // Contact point velocity: v + omega x r, with r = -R n
  const rx = -R * nx, ry = -R * ny, rz = -R * nz;
  let ux = b.vx + b.wy * rz - b.wz * ry;
  let uy = b.vy + b.wz * rx - b.wx * rz;
  let uz = b.vz + b.wx * ry - b.wy * rx;
  const un = ux * nx + uy * ny + uz * nz;
  ux -= un * nx; uy -= un * ny; uz -= un * nz;
  const s = Math.hypot(ux, uy, uz);
  const I = 0.4 * R * R;
  if (s > 1e-12) {
    const jt = Math.min((s * 2) / 7, W.mu * J);
    const fx = (-ux / s) * jt, fy = (-uy / s) * jt, fz = (-uz / s) * jt;
    b.vx += fx; b.vy += fy; b.vz += fz;
    b.wx += (ry * fz - rz * fy) / I;
    b.wy += (rz * fx - rx * fz) / I;
    b.wz += (rx * fy - ry * fx) / I;
  }
  // Rolling resistance torque c*N*R, clamped so it cannot reverse the spin
  const wn = b.wx * nx + b.wy * ny + b.wz * nz;
  const tx = b.wx - wn * nx, ty = b.wy - wn * ny, tz = b.wz - wn * nz;
  const m = Math.hypot(tx, ty, tz);
  if (m > 1e-12) {
    const k = Math.min(1, ((W.c * R * J) / I) / m);
    b.wx -= tx * k; b.wy -= ty * k; b.wz -= tz * k;
  }
}

function rimPoint(W, b, qx, qy) {
  const dx = b.x - qx, dy = b.y - qy, dz = b.z;
  const dist = Math.hypot(dx, dy, dz);
  const gap = dist - W.R;
  if (gap < 0) contact(W, b, dx / dist, dy / dist, dz / dist, gap);
}

function solveBall(W, b) {
  const R = W.R;
  const h = W.hole;
  const r = Math.hypot(b.x, b.y);
  if (!h || r >= h.a) {
    const gap = b.z - R;
    if (gap < 0) contact(W, b, 0, 0, 1, gap);
  } else {
    const ux = r > 1e-12 ? b.x / r : 1, uy = r > 1e-12 ? b.y / r : 0;
    const a = h.a;
    // Nearest rim point plus three others around the ring, so a seated ball
    // is supported by the ring and not by a single chattering point.
    rimPoint(W, b, a * ux, a * uy);
    if (h.type === 'seat') {
      rimPoint(W, b, -a * ux, -a * uy);
      rimPoint(W, b, -a * uy, a * ux);
      rimPoint(W, b, a * uy, -a * ux);
    } else {
      const gap = b.z + h.d - R;
      if (gap < 0) contact(W, b, 0, 0, 1, gap);
      if (b.z < 0) {
        const wg = a - r - R;
        if (wg < 0) contact(W, b, -ux, -uy, 0, wg);
      }
    }
  }
  if (W.wallR) {
    const rw = Math.hypot(b.x, b.y);
    const gap = W.wallR - rw - R;
    if (gap < 0) contact(W, b, -b.x / rw, -b.y / rw, 0, gap);
  }
}

function solvePair(W, A, B) {
  const R = W.R;
  let dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z;
  const d = Math.hypot(dx, dy, dz);
  const gap = d - 2 * R;
  if (gap >= 0) return;
  dx /= d; dy /= d; dz /= d;
  A.x += dx * gap / 2; A.y += dy * gap / 2; A.z += dz * gap / 2;
  B.x -= dx * gap / 2; B.y -= dy * gap / 2; B.z -= dz * gap / 2;
  const vn = (B.vx - A.vx) * dx + (B.vy - A.vy) * dy + (B.vz - A.vz) * dz;
  if (vn >= 0) return;
  const er = -vn > W.vRest ? W.e : 0;
  const J = (-(1 + er) * vn) / 2;
  A.vx -= dx * J; A.vy -= dy * J; A.vz -= dz * J;
  B.vx += dx * J; B.vy += dy * J; B.vz += dz * J;
  // Coulomb friction at the shared contact point
  const ax = R * dx, ay = R * dy, az = R * dz; // from A to contact; B uses -ax...
  let ux = (A.vx + A.wy * az - A.wz * ay) - (B.vx - B.wy * az + B.wz * ay);
  let uy = (A.vy + A.wz * ax - A.wx * az) - (B.vy - B.wz * ax + B.wx * az);
  let uz = (A.vz + A.wx * ay - A.wy * ax) - (B.vz - B.wx * ay + B.wy * ax);
  const un = ux * dx + uy * dy + uz * dz;
  ux -= un * dx; uy -= un * dy; uz -= un * dz;
  const s = Math.hypot(ux, uy, uz);
  if (s < 1e-12) return;
  const jt = Math.min(s / 7, (W.muBall ?? W.mu) * J);
  const fx = (-ux / s) * jt, fy = (-uy / s) * jt, fz = (-uz / s) * jt;
  const I = 0.4 * R * R;
  A.vx += fx; A.vy += fy; A.vz += fz;
  A.wx += (ay * fz - az * fy) / I; A.wy += (az * fx - ax * fz) / I; A.wz += (ax * fy - ay * fx) / I;
  B.vx -= fx; B.vy -= fy; B.vz -= fz;
  B.wx += (ay * fz - az * fy) / I; B.wy += (az * fx - ax * fz) / I; B.wz += (ax * fy - ay * fx) / I;
}

// Several holes: solve against the nearest one, shifting into its frame.
function solveMulti(W, b) {
  let best = W.holes[0], bd = Infinity;
  for (const h of W.holes) { const d = Math.hypot(b.x - h.cx, b.y - h.cy); if (d < bd) { bd = d; best = h; } }
  W.hole = best; W.wallR = null;
  b.x -= best.cx; b.y -= best.cy;
  solveBall(W, b);
  b.x += best.cx; b.y += best.cy;
  const rw = Math.hypot(b.x, b.y);
  const gap = W.plateR - rw - W.R;
  if (gap < 0) contact(W, b, -b.x / rw, -b.y / rw, 0, gap);
  for (const o of W.obstacles ?? []) {
    const ex = o.x2 - o.x1, ey = o.y2 - o.y1, L2 = ex * ex + ey * ey;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((b.x - o.x1) * ex + (b.y - o.y1) * ey) / L2)) : 0;
    const dx = b.x - (o.x1 + t * ex), dy = b.y - (o.y1 + t * ey);
    const d = Math.hypot(dx, dy);
    const og = d - W.R - o.r;
    if (og < 0 && d > 1e-12) contact(W, b, dx / d, dy / d, 0, og);
  }
}

// gx, gy: in-plane effective gravity (m/s^2). gz is the magnitude along -z.
function step(W, balls, gx, gy, gz) {
  const dt = W.dt;
  for (const b of balls) {
    b.vx += gx * dt; b.vy += gy * dt; b.vz -= gz * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  }
  for (let p = 0; p < W.passes; p++) {
    for (const b of balls) (W.holes ? solveMulti : solveBall)(W, b);
    if (balls.length > 1) for (let i = 0; i < balls.length; i++) for (let j = i + 1; j < balls.length; j++) solvePair(W, balls[i], balls[j]);
  }
}

const tiltG = (thetaDeg) => [G * Math.sin(deg(thetaDeg)), G * Math.cos(deg(thetaDeg))];

// --- closed forms -----------------------------------------------------------
// Height the ball centre sits below its on-plate height.
const sinkOf = (R, h) => (h.type === 'seat' ? R - Math.sqrt(R * R - h.a * h.a) : h.d);
// Tilt at which the line of gravity passes through the downhill rim point.
const thetaEscape = (R, h) => rad2deg(Math.acos(1 - sinkOf(R, h) / R));
// Rolling KE needed to lift the centre out, no impact losses: 7/10 v^2 = g h.
const vEnergy = (R, h) => Math.sqrt((10 / 7) * G * sinkOf(R, h));

// Settle a ball in the hole, so tests start from true rest.
function seated(W) {
  const h = W.hole;
  const b = ball(0, 0, W.R - sinkOf(W.R, h) + 1e-6, 0, 0, W.R);
  for (let i = 0; i < 0.05 / W.dt; i++) step(W, [b], 0, 0, G);
  return b;
}

// --- 1. validation ----------------------------------------------------------
function validate() {
  console.log('\n## 1. Validation: rolling acceleration vs a = 5/7 g (sin t - c cos t)');
  console.log('tilt(deg) c       analytic  sim      slipFrac');
  for (const [t, c] of [[0.5, 0.002], [1, 0.002], [5, 0.002], [10, 0.002], [30, 0.002], [1, 0]]) {
    const W = world({ c, dt: 2e-6 });
    const [gx, gz] = tiltG(t);
    const b = ball(0, 0, W.R);
    const T = 0.3;
    for (let i = 0; i < T / W.dt; i++) step(W, [b], gx, 0, gz);
    const an = (5 / 7) * G * (Math.sin(deg(t)) - c * Math.cos(deg(t)));
    const slip = Math.abs(b.vx - b.wy * W.R) / Math.max(b.vx, 1e-9);
    console.log(`${String(t).padEnd(9)} ${String(c).padEnd(7)} ${fmt(an)}     ${fmt(b.vx / T)}    ${slip.toExponential(1)}`);
  }
  console.log('\nBreakaway from rest, c=0.002 (predicted atan(c)=0.115 deg), c=0.01 (0.573 deg)');
  for (const c of [0.002, 0.01]) {
    let line = `c=${c}: `;
    for (const t of [0.05, 0.1, 0.11, 0.12, 0.15, 0.5, 0.55, 0.6]) {
      const W = world({ c, dt: 1e-5 });
      const [gx, gz] = tiltG(t);
      const b = ball(0, 0, W.R);
      for (let i = 0; i < 1 / W.dt; i++) step(W, [b], gx, 0, gz);
      line += `${t}deg:${b.x > 1e-5 ? 'moves' : 'still'} `;
    }
    console.log(line);
  }
}

// --- 2. capture speed -------------------------------------------------------
function captureRun(W, v, bOff) {
  const h = W.hole, R = W.R;
  const y = bOff * h.a;
  const x0 = -Math.sqrt(h.a * h.a - y * y) - 0.0005;
  const b = ball(x0, y, R, v, 0, R);
  const steps = 2.0 / W.dt;
  for (let i = 0; i < steps; i++) {
    step(W, [b], 0, 0, G);
    const r = Math.hypot(b.x, b.y);
    if (r > h.a + 0.0012 && b.x * b.vx + b.y * b.vy > 0 && b.z >= R - 1e-6) return false;
    if (i % 2000 === 0 && r < h.a && Math.hypot(b.vx, b.vy, b.vz) < 0.002) return true;
  }
  return Math.hypot(b.x, b.y) < h.a;
}

function capture() {
  console.log('\n## 2. Capture speed. Ball rolls straight at the hole on a flat plate. mu=0.3, c=0.002');
  console.log('b/a = lateral offset as a fraction of hole radius. Speeds in cm/s.');
  console.log('"sure" = fastest speed with every slower test speed captured. "any" = fastest captured at all.');
  const speeds = [];
  for (let v = 0.01; v < 1.3; v *= 1.15) speeds.push(v);
  const offsets = [0, 0.25, 0.5, 0.75, 0.9];
  const R5 = 0.005, R10 = 0.01;
  const mk = (R, escDeg, type) => {
    const sink = R * (1 - Math.cos(deg(escDeg)));
    return type === 'seat'
      ? { type, a: R * Math.sin(deg(escDeg)) }
      : { type, a: 1.6 * R, d: sink };
  };
  const cfgs = [];
  for (const type of ['seat', 'cup']) for (const R of [R5, R10]) for (const esc of [10, 15, 30]) cfgs.push({ R, esc, h: mk(R, esc, type) });
  console.log('type R(mm) a(mm) sink(mm) escape(deg) e    vEnergy | sure/any at b/a=0, .25, .5, .75, .9');
  for (const c of cfgs) for (const e of [0.65, 0.95]) {
    const W = world({ R: c.R, e, hole: c.h, dt: 1e-5 });
    const cols = [];
    for (const bo of offsets) {
      let sure = 0, any = 0, broken = false;
      for (const v of speeds) {
        const cap = captureRun(W, v, bo);
        if (cap) { any = v; if (!broken) sure = v; } else broken = true;
      }
      cols.push(`${fmt(sure * 100, 1)}/${fmt(any * 100, 1)}`);
    }
    console.log(`${c.h.type.padEnd(4)} ${String(c.R * 1000).padEnd(5)} ${fmt(c.h.a * 1000, 2).padEnd(5)} ${fmt(sinkOf(c.R, c.h) * 1000, 3).padEnd(8)} ${fmt(thetaEscape(c.R, c.h), 1).padEnd(11)} ${String(e).padEnd(4)} ${fmt(vEnergy(c.R, c.h) * 100, 1).padEnd(7)} | ${cols.join('  ')}`);
  }
}

// --- 3. dislodge ------------------------------------------------------------
function escaped(W, b) { return Math.hypot(b.x, b.y) > W.hole.a + 0.1 * W.R && b.z >= W.R - 1e-5; }

function pulseOut(W, thetaDeg, T) {
  const b = seated(W);
  const [gx, gz] = tiltG(thetaDeg);
  const steps = T / W.dt, after = 0.8 / W.dt;
  for (let i = 0; i < steps; i++) { step(W, [b], gx, 0, gz); if (escaped(W, b)) return true; }
  for (let i = 0; i < after; i++) { step(W, [b], 0, 0, G); if (escaped(W, b)) return true; }
  return false;
}

function dislodge() {
  console.log('\n## 3. Dislodging a seated ball');
  console.log('Slow ramp from flat at 1 deg/s. Closed form: cos(t) = 1 - sink/R (seat: sin(t) = a/R).');
  console.log('type R(mm) a(mm) sink(mm) predicted(deg) sim(deg)');
  const cases = [
    { R: 0.005, h: { type: 'seat', a: 0.005 * Math.sin(deg(15)) } },
    { R: 0.005, h: { type: 'seat', a: 0.0025 } },
    { R: 0.01, h: { type: 'seat', a: 0.01 * Math.sin(deg(15)) } },
    { R: 0.005, h: { type: 'cup', a: 0.008, d: 0.005 * (1 - Math.cos(deg(15))) } },
    { R: 0.01, h: { type: 'cup', a: 0.016, d: 0.01 * (1 - Math.cos(deg(30))) } },
  ];
  for (const c of cases) {
    const W = world({ R: c.R, hole: c.h, dt: 1e-5 });
    const pred = thetaEscape(c.R, c.h);
    const b = seated(W);
    let found = null;
    const start = 0, rate = 1;
    const n = ((pred * 1.3) / rate) / W.dt;
    for (let i = 0; i < n; i++) {
      const th = start + rate * i * W.dt;
      const [gx, gz] = tiltG(th);
      step(W, [b], gx, 0, gz);
      // Leaving the rest position: cup rolls freely so test when it clears the rim
      if (escaped(W, b)) { found = th; break; }
    }
    console.log(`${c.h.type.padEnd(4)} ${String(c.R * 1000).padEnd(5)} ${fmt(c.h.a * 1000, 2).padEnd(5)} ${fmt(sinkOf(c.R, c.h) * 1000, 3).padEnd(8)} ${fmt(pred, 2).padEnd(14)} ${fmt(found, 2)}`);
  }

  console.log('\nSpeed of the tilt alone: 0 to 90% of escape angle, then held, seat R=5 escape=15deg');
  for (const rampT of [0.02, 0.2, 2]) {
    const W = world({ hole: { type: 'seat', a: 0.005 * Math.sin(deg(15)) }, dt: 1e-5 });
    const b = seated(W);
    const target = 13.5;
    let out = false;
    for (let i = 0; i < (rampT + 1) / W.dt; i++) {
      const t = i * W.dt;
      const [gx, gz] = tiltG(Math.min(1, t / rampT) * target);
      step(W, [b], gx, 0, gz);
      if (escaped(W, b)) { out = true; break; }
    }
    console.log(`ramp over ${rampT}s: ${out ? 'DISLODGED' : 'stays'}`);
  }

  console.log('\nShortest pulse that dislodges. Pulse = effective gravity tilted by theta, for T ms.');
  console.log('A hand jerk of horizontal acceleration A acts the same with tan(theta) = A/g.');
  console.log('hole          theta(deg) equivA(g) minT(ms)');
  const holes = [
    ['seat R5 15', 0.005, { type: 'seat', a: 0.005 * Math.sin(deg(15)) }],
    ['seat R10 15', 0.01, { type: 'seat', a: 0.01 * Math.sin(deg(15)) }],
    ['seat R5 30', 0.005, { type: 'seat', a: 0.0025 }],
    ['cup R5 15', 0.005, { type: 'cup', a: 0.008, d: 0.005 * (1 - Math.cos(deg(15))) }],
    ['cup R10 15', 0.01, { type: 'cup', a: 0.016, d: 0.01 * (1 - Math.cos(deg(15))) }],
  ];
  for (const [name, R, h] of holes) {
    const W = world({ R, hole: h, dt: 1e-5 });
    const esc = thetaEscape(R, h);
    for (const m of [1.2, 1.5, 2, 3, 4]) {
      const th = esc * m;
      if (th >= 80) continue;
      let lo = 0.001, hi = 1.5;
      if (!pulseOut(W, th, hi)) { console.log(`${name.padEnd(13)} ${fmt(th, 1).padEnd(10)} ${fmt(Math.tan(deg(th)), 2).padEnd(9)} >1500`); continue; }
      for (let k = 0; k < 9; k++) { const mid = Math.sqrt(lo * hi); if (pulseOut(W, th, mid)) hi = mid; else lo = mid; }
      console.log(`${name.padEnd(13)} ${fmt(th, 1).padEnd(10)} ${fmt(Math.tan(deg(th)), 2).padEnd(9)} ${fmt(hi * 1000, 0)}`);
    }
  }
}

// Does the speed of a tilt matter? Lowest final tilt that dislodges for a given ramp time.
function rate() {
  console.log('\n## 3b. Rate dependence: ramp from flat to theta over T, hold 1s. Lowest theta that dislodges (deg).');
  const T = [0.02, 0.05, 0.1, 0.2, 0.5, 1, 3];
  console.log('hole                       static | ' + T.map((t) => `${t}s`.padEnd(6)).join(' '));
  const cases = [
    ['seat R5 15', 0.005, { type: 'seat', a: 0.005 * Math.sin(deg(15)) }],
    ['seat R10 30', 0.01, { type: 'seat', a: 0.005 }],
    ['cup R10 15 a=1.2R', 0.01, { type: 'cup', a: 0.012, d: 0.01 * (1 - Math.cos(deg(15))) }],
    ['cup R10 15 a=1.6R', 0.01, { type: 'cup', a: 0.016, d: 0.01 * (1 - Math.cos(deg(15))) }],
    ['cup R10 30 a=1.2R', 0.01, { type: 'cup', a: 0.012, d: 0.01 * (1 - Math.cos(deg(30))) }],
    ['cup R10 30 a=1.6R', 0.01, { type: 'cup', a: 0.016, d: 0.01 * (1 - Math.cos(deg(30))) }],
    ['cup R10 30 a=2.5R', 0.01, { type: 'cup', a: 0.025, d: 0.01 * (1 - Math.cos(deg(30))) }],
  ];
  for (const [name, R, h] of cases) {
    const W = world({ R, hole: h, dt: 1e-5 });
    const esc = thetaEscape(R, h);
    const row = T.map((rampT) => {
      for (let th = 1; th <= esc + 3; th += 0.5) {
        const b = seated(W);
        for (let i = 0; i < (rampT + 1) / W.dt; i++) {
          const [gx, gz] = tiltG(Math.min(1, (i * W.dt) / rampT) * th);
          step(W, [b], gx, 0, gz);
          if (escaped(W, b)) return th;
        }
      }
      return null;
    });
    console.log(`${name.padEnd(26)} ${fmt(esc, 1).padEnd(6)} | ${row.map((x) => fmt(x, 1).padEnd(6)).join(' ')}`);
  }
}

// --- 4. impacts -------------------------------------------------------------
function impacts() {
  console.log('\n## 4. Wall and ball impacts. mu=0.3, c=0.002, R=5mm, flat plate');
  console.log('Wall: rolling ball hits vertical wall. Formula with a frictionless wall: v_final = v(2-5e)/7.');
  console.log('e     v(m/s) formula  sim settled  hop(mm)');
  for (const e of [0.65, 0.95]) for (const v of [0.1, 0.3, 0.6]) {
    const W = world({ e, wallR: 0.15, dt: 5e-6 });
    const b = ball(0.15 - W.R - 0.002, 0, W.R, v, 0, W.R);
    let hop = 0;
    for (let i = 0; i < 0.6 / W.dt; i++) { step(W, [b], 0, 0, G); hop = Math.max(hop, b.z - W.R); }
    console.log(`${String(e).padEnd(5)} ${String(v).padEnd(6)} ${fmt((v * (2 - 5 * e)) / 7).padEnd(8)} ${fmt(b.vx).padEnd(12)} ${fmt(hop * 1000, 2)}`);
  }

  console.log('\nBall hits stationary ball head-on. Formula (no ball-ball friction):');
  console.log('target = 5/7 * v(1+e)/2, striker = (v(1-e)/2 + 0.4v)/1.4');
  console.log('e     muBall v(m/s) target:formula/sim  striker:formula/sim');
  for (const e of [0.65, 0.95]) for (const muBall of [0, 0.3]) {
    const v = 0.3;
    const W = world({ e, muBall, dt: 5e-6 });
    const A = ball(-0.012, 0, W.R, v, 0, W.R), B = ball(0, 0, W.R, 0, 0, W.R);
    for (let i = 0; i < 0.6 / W.dt; i++) step(W, [A, B], 0, 0, G);
    console.log(`${String(e).padEnd(5)} ${String(muBall).padEnd(6)} ${String(v).padEnd(6)} ${fmt((5 / 7) * (v * (1 + e)) / 2)}/${fmt(B.vx).padEnd(14)} ${fmt(((v * (1 - e)) / 2 + 0.4 * v) / 1.4)}/${fmt(A.vx)}`);
  }

  console.log('\nRolling ball strikes a seated ball head-on. Minimum strike speed that knocks it out:');
  console.log('hole          e     minStrike(cm/s)');
  for (const [name, R, h] of [
    ['seat R5 15', 0.005, { type: 'seat', a: 0.005 * Math.sin(deg(15)) }],
    ['seat R5 30', 0.005, { type: 'seat', a: 0.0025 }],
    ['cup R5 15', 0.005, { type: 'cup', a: 0.008, d: 0.005 * (1 - Math.cos(deg(15))) }],
  ]) for (const e of [0.65, 0.95]) {
    const W = world({ R, e, hole: h, dt: 5e-6 });
    let min = null;
    for (let v = 0.02; v < 1.5; v *= 1.12) {
      const T = seated(W);
      const S = ball(-2.2 * R - h.a, 0, R, v, 0, R);
      let out = false;
      for (let i = 0; i < 1 / W.dt; i++) {
        step(W, [S, T], 0, 0, G);
        if (escaped(W, T)) { out = true; break; }
      }
      if (out) { min = v; break; }
    }
    console.log(`${name.padEnd(13)} ${String(e).padEnd(5)} ${min ? fmt(min * 100, 1) : '>150'}`);
  }
}

// --- 5. crossing times ------------------------------------------------------
function cross() {
  console.log('\n## 5. Crossing time from rest (closed form, validated in section 1). c=0.002');
  console.log('tilt(deg) a(cm/s2) | t,v for 65mm     | t,v for 150mm    | t,v for 300mm');
  for (const t of [0.25, 0.58, 1, 2, 3, 5, 10, 15]) {
    const a = (5 / 7) * G * (Math.sin(deg(t)) - 0.002 * Math.cos(deg(t)));
    const col = (L) => `${fmt(Math.sqrt((2 * L) / a), 2)}s ${fmt(Math.sqrt(2 * L * a) * 100, 0)}cm/s`;
    console.log(`${String(t).padEnd(9)} ${fmt(a * 100, 1).padEnd(8)} | ${col(0.065).padEnd(16)} | ${col(0.15).padEnd(16)} | ${col(0.3)}`);
  }
}

// --- 6. closed loop ---------------------------------------------------------
// A crude stand-in player: visual delay, tremor, wander and a calibration error
// going through a sensor model. Compare configs against each other, do not read
// the absolute times as human performance.
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function playRun(cfg, seed, Kv) {
  const rand = rng(seed);
  const W = world({ R: cfg.R, c: cfg.c, e: 0.65, hole: cfg.hole, wallR: cfg.plateR, dt: 1e-5 });
  const ang = rand() * Math.PI * 2;
  const r0 = 0.7 * cfg.plateR;
  const b = ball(r0 * Math.cos(ang), r0 * Math.sin(ang), W.R, 0, 0, W.R);
  const delay = 0.2;
  const vApproach = cfg.vTarget;
  const bufN = Math.round(delay / 0.01);
  const buf = [];
  let cmdx = 0, cmdy = 0;
  let plateX = 0, plateY = 0, sensX = 0, sensY = 0;
  const p = () => rand() * Math.PI * 2;
  const ph = [p(), p(), p(), p()];
  const bias = [cfg.bias * Math.cos(ang * 3), cfg.bias * Math.sin(ang * 3)];
  const substeps = Math.round(0.01 / W.dt);
  const q = cfg.quant; // degrees, input resolution
  let seatedFor = 0;
  for (let n = 0; n < cfg.limit / 0.01; n++) {
    const t = n * 0.01;
    buf.push([b.x, b.y, b.vx, b.vy]);
    const [ox, oy, ovx, ovy] = buf.length > bufN ? buf[buf.length - 1 - bufN] : [b.x, b.y, 0, 0];
    const d = Math.hypot(ox, oy);
    const sp = Math.min(vApproach, 3 * d);
    const dvx = d > 1e-6 ? (-ox / d) * sp : 0, dvy = d > 1e-6 ? (-oy / d) * sp : 0;
    const clamp = (x) => Math.max(-cfg.maxTilt, Math.min(cfg.maxTilt, x));
    const wantx = clamp(Kv * (dvx - ovx)), wanty = clamp(Kv * (dvy - ovy));
    // Wrist: 8 Hz low pass on commanded tilt
    cmdx += (wantx - cmdx) * 0.4; cmdy += (wanty - cmdy) * 0.4;
    const hx = cmdx + cfg.tremor * Math.sin(2 * Math.PI * 10 * t + ph[0]) + cfg.wander * Math.sin(2 * Math.PI * 0.5 * t + ph[1]) + bias[0];
    const hy = cmdy + cfg.tremor * Math.sin(2 * Math.PI * 9 * t + ph[2]) + cfg.wander * Math.sin(2 * Math.PI * 0.4 * t + ph[3]) + bias[1];
    // Sensor resolution then the heavy-plate low pass
    const qx = q ? Math.round(hx / q) * q : hx, qy = q ? Math.round(hy / q) * q : hy;
    const al = 1 - Math.exp(-0.01 / cfg.tau);
    sensX += (qx - sensX) * al; sensY += (qy - sensY) * al;
    plateX = Math.abs(sensX) < cfg.dead ? 0 : sensX; plateY = Math.abs(sensY) < cfg.dead ? 0 : sensY;
    const gx = G * Math.sin(deg(plateX)), gy = G * Math.sin(deg(plateY));
    for (let i = 0; i < substeps; i++) step(W, [b], gx, gy, G);
    if (Math.hypot(b.x, b.y) < cfg.hole.a) seatedFor += 0.01; else seatedFor = 0;
    if (seatedFor > 1) return t - 1;
  }
  return null;
}

function median(a) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }

function loop() {
  console.log('\n## 6. Closed-loop stand-in player. One ball, 150mm-radius plate unless noted, 8 random starts, 15s limit.');
  console.log('Assumed: 200ms visual delay, 10Hz tremor, 0.5Hz wander. Success = stayed in the hole for 1s. Best player gain and approach speed shown.');
  console.log('config                                         captured  median(s)');
  const seat15 = (R) => ({ type: 'seat', a: R * Math.sin(deg(15)) });
  const cup15 = (R) => ({ type: 'cup', a: 1.6 * R, d: R * (1 - Math.cos(deg(15))) });
  const cup30 = (R) => ({ type: 'cup', a: 1.6 * R, d: R * (1 - Math.cos(deg(30))) });
  const base = { R: 0.01, c: 0.002, plateR: 0.15, maxTilt: 6, limit: 15, tremor: 0.2, wander: 0.3, bias: 0.3, quant: 0.1, tau: 0.08, dead: 0 };
  const cfgs = [
    ['A real c, 0.1deg orientation input, cup 15', { hole: cup15(0.01), vTarget: 0.12 }],
    ['B same but 0.58deg accel quantisation', { hole: cup15(0.01), vTarget: 0.12, quant: 0.58 }],
    ['C same as A, seat 15 instead of cup', { hole: seat15(0.01), vTarget: 0.05 }],
    ['D same as A, no tremor/wander/bias (ideal)', { hole: cup15(0.01), vTarget: 0.12, tremor: 0, wander: 0, bias: 0 }],
    ['E same as A, deep cup 30', { hole: cup30(0.01), vTarget: 0.25 }],
    ['F A + rolling damping c=0.01', { hole: cup15(0.01), vTarget: 0.12, c: 0.01 }],
    ['G A + rolling damping c=0.03', { hole: cup15(0.01), vTarget: 0.12, c: 0.03 }],
    ['H E + c=0.01', { hole: cup30(0.01), vTarget: 0.25, c: 0.01 }],
    ['I E + c=0.01, 0.58deg quantisation', { hole: cup30(0.01), vTarget: 0.25, c: 0.01, quant: 0.58 }],
    ['J E + c=0.01, deadzone 0.3deg', { hole: cup30(0.01), vTarget: 0.25, c: 0.01, dead: 0.3 }],
    ['K H with worse hands (tremor .5, wander .6, bias .6)', { hole: cup30(0.01), vTarget: 0.25, c: 0.01, tremor: 0.5, wander: 0.6, bias: 0.6 }],
    ['L real-size small plate 65mm radius, R5, cup 15', { R: 0.005, plateR: 0.065, hole: cup15(0.005), vTarget: 0.08 }],
  ];
  for (const [name, o] of cfgs) {
    const cfg = { ...base, ...o };
    let best = null;
    for (const Kv of [15, 30]) for (const vs of [0.5, 1, 2]) {
      const res = [];
      const c2 = { ...cfg, vTarget: cfg.vTarget * vs };
      for (let s = 1; s <= 8; s++) res.push(playRun(c2, s * 97, Kv));
      const ok = res.filter((x) => x !== null);
      const score = ok.length * 100 - (ok.length ? median(ok) : 0);
      if (!best || score > best.score) best = { score, ok, Kv, v: c2.vTarget };
    }
    console.log(`${name.padEnd(52)} ${best.ok.length}/8      ${best.ok.length ? fmt(median(best.ok), 1) : '-'}   (gain ${best.Kv}, approach ${fmt(best.v * 100, 0)}cm/s)`);
  }
}

// --- 7. chosen configuration and convergence --------------------------------
function pick() {
  const R = 0.01, h = { type: 'cup', a: 0.016, d: R * (1 - Math.cos(deg(30))) };
  console.log('\n## 7. Candidate: 20mm ball, cup a=16mm, depth 1.34mm, mu=0.3, e=0.65');
  const T = [0.02, 0.1, 0.2, 0.5, 1, 3];
  console.log('Lowest final tilt that dislodges vs ramp time (deg)');
  console.log('c      | ' + T.map((t) => `${t}s`.padEnd(6)).join(' '));
  for (const c of [0.002, 0.01, 0.03]) {
    const W = world({ R, c, hole: h, dt: 1e-5 });
    const row = T.map((rampT) => {
      for (let th = 1; th <= 34; th += 0.5) {
        const b = seated(W);
        for (let i = 0; i < (rampT + 1) / W.dt; i++) {
          const [gx, gz] = tiltG(Math.min(1, (i * W.dt) / rampT) * th);
          step(W, [b], gx, 0, gz);
          if (escaped(W, b)) return th;
        }
      }
      return null;
    });
    console.log(`${String(c).padEnd(6)} | ${row.map((x) => fmt(x, 1).padEnd(6)).join(' ')}`);
  }
  console.log('\nCapture speed limit (cm/s) vs c and timestep, at b/a = 0, .5, .9');
  for (const [c, dt] of [[0.002, 1e-5], [0.002, 2.5e-6], [0.01, 1e-5], [0.01, 2.5e-6], [0.03, 1e-5]]) {
    const W = world({ R, c, hole: h, dt });
    const cols = [0, 0.5, 0.9].map((bo) => { let last = 0; for (let v = 0.04; v < 0.5; v *= 1.08) { if (captureRun(W, v, bo)) last = v; else break; } return fmt(last * 100, 1); });
    console.log(`c=${c} dt=${dt}: ${cols.join('  ')}`);
  }
  console.log('\nSeat R5 15deg static escape vs timestep');
  for (const dt of [1e-5, 2.5e-6]) {
    const W = world({ hole: { type: 'seat', a: 0.005 * Math.sin(deg(15)) }, dt });
    const b = seated(W); let f = null;
    for (let i = 0; i < 20 / dt; i++) { const th = i * dt; const [gx, gz] = tiltG(th); step(W, [b], gx, 0, gz); if (escaped(W, b)) { f = th; break; } }
    console.log(`dt=${dt}: ${fmt(f, 2)} deg`);
  }
}

// --- 8. the whole game with the stand-in player ----------------------------
// Tilt moves every free ball at once. The stand-in steers one ball at a time.
function fiveRun(cfg, seed) {
  const rand = rng(seed);
  const n = cfg.n ?? 5;
  const holes = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI + 0.3; holes.push({ ...cfg.hole, cx: cfg.ringR * Math.cos(a), cy: cfg.ringR * Math.sin(a) }); }
  const fdt = cfg.dt ?? 1e-5;
  const W = world({ R: cfg.R, c: cfg.c, e: cfg.e ?? 0.65, mu: cfg.mu ?? 0.3, hole: holes[0], holes, plateR: cfg.plateR, dt: fdt, vRest: Math.max(0.004, 2 * G * fdt) });
  W.obstacles = [];
  const k = cfg.R / 0.01;
  for (const h of holes) h.u = [h.cx / cfg.ringR, h.cy / cfg.ringR];
  if (cfg.pegs) {
    // Posts 10mm wide (at 20mm ball scale), half way between the hole ring and the rim, between holes
    for (let i = 0; i < cfg.pegs; i++) {
      const a = ((i + 0.5) / cfg.pegs) * 2 * Math.PI + 0.3, r = (cfg.ringR + cfg.plateR) / 2;
      W.obstacles.push({ x1: r * Math.cos(a), y1: r * Math.sin(a), x2: r * Math.cos(a), y2: r * Math.sin(a), r: 0.005 * k });
    }
  }
  if (cfg.guards) {
    // A short wall on the rim side of each hole, so it must be entered from the centre side
    for (const h of holes) {
      const [ux, uy] = h.u, off = cfg.ringR + h.a + cfg.R + 0.003 * k, half = h.a + cfg.R;
      W.obstacles.push({ x1: off * ux - half * uy, y1: off * uy + half * ux, x2: off * ux + half * uy, y2: off * uy - half * ux, r: 0.002 * k });
    }
  }
  const balls = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI + rand(); const r = cfg.startR ?? cfg.plateR - W.R - 0.002; balls.push(ball(r * Math.cos(a), r * Math.sin(a), W.R, 0, 0, W.R)); }
  const ph = [rand() * 6.28, rand() * 6.28, rand() * 6.28, rand() * 6.28];
  const bias = [cfg.bias * Math.cos(seed), cfg.bias * Math.sin(seed)];
  const hist = [];
  const bufN = 20;
  let cmdx = 0, cmdy = 0, sx = 0, sy = 0;
  let dislodged = 0;
  const inHole = balls.map(() => null), lastIn = balls.map(() => null);
  const sunkZ = W.R - 0.5 * sinkOf(W.R, cfg.hole);
  const holeOf = (b) => { for (const h of holes) if (Math.hypot(b.x - h.cx, b.y - h.cy) < h.a && b.z < sunkZ) return h; return null; };
  let heldFor = 0;
  const substeps = Math.round(0.01 / W.dt);
  for (let k = 0; k < cfg.limit / 0.01; k++) {
    const t = k * 0.01;
    hist.push(balls.map((b) => [b.x, b.y, b.vx, b.vy]));
    const snap = hist.length > bufN ? hist[hist.length - 1 - bufN] : hist[0];
    if (hist.length > bufN + 1) hist.shift();
    // Pick the free ball nearest an empty hole, as seen 200ms ago
    const filled = new Set(balls.map((b) => holeOf(b)).filter(Boolean));
    let bestD = Infinity, tgt = null;
    balls.forEach((b, i) => {
      if (holeOf(b)) return;
      const [x, y, vx, vy] = snap[i];
      for (const h of holes) { if (filled.has(h)) continue; const d = Math.hypot(x - h.cx, y - h.cy); if (d < bestD) { bestD = d; tgt = { x, y, vx, vy, h, d }; } }
    });
    let wx = 0, wy = 0;
    if (tgt) {
      let px = tgt.h.cx, py = tgt.h.cy;
      // Guarded hole: go round to the open side first
      if (cfg.guards && tgt.x * tgt.h.u[0] + tgt.y * tgt.h.u[1] > cfg.ringR - 0.3 * tgt.h.a) {
        const r = cfg.ringR - tgt.h.a - 1.5 * cfg.R;
        px = r * tgt.h.u[0]; py = r * tgt.h.u[1];
      }
      const d = Math.hypot(tgt.x - px, tgt.y - py);
      const sp = Math.min(cfg.vTarget, 3 * Math.max(d, tgt.d * 0));
      wx = cfg.Kv * ((-(tgt.x - px) / Math.max(d, 1e-6)) * sp - tgt.vx);
      wy = cfg.Kv * ((-(tgt.y - py) / Math.max(d, 1e-6)) * sp - tgt.vy);
      const m = Math.hypot(wx, wy);
      if (m > cfg.maxTilt) { wx *= cfg.maxTilt / m; wy *= cfg.maxTilt / m; }
    }
    cmdx += (wx - cmdx) * 0.4; cmdy += (wy - cmdy) * 0.4;
    const hx = cmdx + cfg.tremor * Math.sin(62.8 * t + ph[0]) + cfg.wander * Math.sin(3.14 * t + ph[1]) + bias[0];
    const hy = cmdy + cfg.tremor * Math.sin(56.5 * t + ph[2]) + cfg.wander * Math.sin(2.51 * t + ph[3]) + bias[1];
    const al = 1 - Math.exp(-0.01 / cfg.tau);
    sx += (hx - sx) * al; sy += (hy - sy) * al;
    const gx = G * Math.sin(deg(sx)), gy = G * Math.sin(deg(sy));
    for (let i = 0; i < substeps; i++) step(W, balls, gx, gy, G);
    balls.forEach((b, i) => {
      const h = holeOf(b);
      if (lastIn[i] && !h && b.z >= W.R - 1e-5) { dislodged++; lastIn[i] = null; }
      if (h) lastIn[i] = h;
    });
    if (balls.every((b) => holeOf(b))) heldFor += 0.01; else heldFor = 0;
    if (heldFor > 1) return { t: t - 1, dislodged, seated: n };
  }
  return { t: null, dislodged, seated: balls.filter((b) => holeOf(b)).length };
}

function game() {
  console.log('\n## 8. Full game, stand-in player, 90s limit, 6 seeds. 20mm balls, 150mm-radius plate, holes on a 70mm-radius ring.');
  console.log('Assumed: 200ms delay, tremor .2, wander .3, bias .3 deg, 80ms plate lag. Not human data.');
  console.log('config                         finished  median(s)  avg seated  avg dislodged');
  const cup = (a, deepDeg) => ({ type: 'cup', a, d: 0.01 * (1 - Math.cos(deg(deepDeg))) });
  const base = { R: 0.01, plateR: 0.15, ringR: 0.07, c: 0.01, hole: cup(0.016, 30), vTarget: 0.13, Kv: 15, maxTilt: 6, limit: 90, tremor: 0.2, wander: 0.3, bias: 0.3, tau: 0.08 };
  for (const [name, o] of [
    ['real c=.002, cup 30', { c: 0.002 }],
    ['c=.01, cup 30, 5 balls', {}],
    ['c=.03, cup 30, 5 balls', { c: 0.03, vTarget: 0.2 }],
    ['c=.01, cup 45, 5 balls', { hole: cup(0.016, 45), vTarget: 0.2 }],
    ['c=.01, cup 30, 3 balls', { n: 3 }],
  ]) {
    const cfg = { ...base, ...o };
    const res = [];
    for (let s = 1; s <= 6; s++) res.push(fiveRun(cfg, s * 131));
    const ok = res.filter((r) => r.t !== null).map((r) => r.t);
    const avg = (f) => res.reduce((a, r) => a + f(r), 0) / res.length;
    console.log(`${name.padEnd(30)} ${ok.length}/6       ${ok.length ? fmt(median(ok), 1) : '-'}`.padEnd(52) + ` ${fmt(avg((r) => r.seated), 1).padEnd(11)} ${fmt(avg((r) => r.dislodged), 1)}`);
  }
}

// --- 9. does it survive a timestep a phone could run? -----------------------
function dtcheck() {
  console.log('\n## 9. Candidate hole at real-time timesteps. c=0.01, 20mm ball, cup a=16mm depth 1.34mm');
  console.log('dt(ms)  capture cm/s at b/a=0,.5,.9   static escape(deg)  dislodge tilt at 0.1s/1s ramp');
  const R = 0.01, h = { type: 'cup', a: 0.016, d: R * (1 - Math.cos(deg(30))) };
  for (const dt of [1e-5, 2.5e-4, 5e-4, 1e-3, 1 / 240]) {
    const W = world({ R, c: 0.01, hole: h, dt, vRest: Math.max(0.004, 2 * G * dt) });
    const cols = [0, 0.5, 0.9].map((bo) => { let last = 0; for (let v = 0.04; v < 0.5; v *= 1.08) { if (captureRun(W, v, bo)) last = v; else break; } return fmt(last * 100, 1); });
    let b = seated(W), esc = null;
    for (let i = 0; i < 40 / dt; i++) { const th = i * dt; const [gx, gz] = tiltG(th); step(W, [b], gx, 0, gz); if (escaped(W, b)) { esc = th; break; } }
    const ramp = (T) => { for (let th = 1; th <= 34; th += 0.5) { const q = seated(W); for (let i = 0; i < (T + 1) / dt; i++) { const [gx, gz] = tiltG(Math.min(1, (i * dt) / T) * th); step(W, [q], gx, 0, gz); if (escaped(W, q)) return th; } } return null; };
    console.log(`${fmt(dt * 1000, 3).padEnd(7)} ${cols.join(' ').padEnd(29)} ${fmt(esc, 2).padEnd(19)} ${fmt(ramp(0.1), 1)} / ${fmt(ramp(1), 1)}`);
  }
}

// --- 10. difficulty levels and plate materials ------------------------------
function levelHoles(R) {
  return [
    ['Pocket, 2% wider than ball', { type: 'cup', a: 1.02 * R, d: 2 * R }],
    ['Pocket, 10% wider than ball', { type: 'cup', a: 1.1 * R, d: 2 * R }],
    ['Pocket, 25% wider than ball', { type: 'cup', a: 1.25 * R, d: 2 * R }],
    ['Cup, 32mm wide, 1.34mm deep', { type: 'cup', a: 1.6 * R, d: R * (1 - Math.cos(deg(30))) }],
    ['Seat, a=0.75R', { type: 'seat', a: 0.75 * R }],
    ['Seat, a=0.5R (half circumference)', { type: 'seat', a: 0.5 * R }],
    ['Seat, a=0.25R (small)', { type: 'seat', a: 0.25 * R }],
  ];
}

function levels() {
  const R = 0.01;
  const dt = 2.5e-4;
  const mk = (o) => world({ R, c: 0.01, dt, vRest: Math.max(0.004, 2 * G * dt), ...o });
  console.log('\n## 10a. Hole types. 20mm ball, c=0.01, e=0.65, mu=0.3, dt=0.25ms');
  console.log('Capture limit in cm/s at offset b/a = 0, .25, .5, .75, .9. Lowest dislodging tilt (deg, up to 60) over a 0.1s and 1s tilt, and slow.');
  console.log('hole                               sink(mm) | capture                      | 0.1s  1s    slow');
  for (const [name, h] of levelHoles(R)) {
    const W = mk({ hole: h });
    const caps = [0, 0.25, 0.5, 0.75, 0.9].map((bo) => { let last = 0; for (let v = 0.01; v < 2; v *= 1.1) { if (captureRun(W, v, bo)) last = v; else break; } return fmt(last * 100, 1).padEnd(5); });
    const ramp = (T) => { for (let th = 1; th <= 60; th += 0.5) { const q = seated(W); for (let i = 0; i < (T + 1) / dt; i++) { const [gx, gz] = tiltG(Math.min(1, (i * dt) / T) * th); step(W, [q], gx, 0, gz); if (escaped(W, q)) return th; } } return null; };
    console.log(`${name.padEnd(34)} ${fmt(sinkOf(R, h) * 1000, 2).padEnd(8)} | ${caps.join(' ')} | ${fmt(ramp(0.1), 1).padEnd(5)} ${fmt(ramp(1), 1).padEnd(5)} ${fmt(ramp(8), 1)}`);
  }
  console.log('\nTimestep check on capture at b/a = 0, .5 (cm/s)');
  for (const [name, h] of levelHoles(R).filter((_, i) => i === 1 || i === 5 || i === 6)) {
    for (const d of [1e-5, 2.5e-4]) {
      const W = world({ R, c: 0.01, dt: d, vRest: Math.max(0.004, 2 * G * d), hole: h });
      const caps = [0, 0.5].map((bo) => { let last = 0; for (let v = 0.01; v < 2; v *= 1.1) { if (captureRun(W, v, bo)) last = v; else break; } return fmt(last * 100, 1); });
      console.log(`${name.padEnd(34)} dt=${d}: ${caps.join('  ')}`);
    }
  }
}

function levelGames() {
  const R = 0.01;
  console.log('\n## 10b. Full 5-ball game per hole type. Stand-in player, 120s limit, 6 seeds, best approach speed. Compare only; not human times.');
  console.log('hole                               finished median(s) avg seated avg dislodged approach');
  const base = { R, plateR: 0.15, ringR: 0.07, c: 0.01, Kv: 15, maxTilt: 6, limit: 120, tremor: 0.2, wander: 0.3, bias: 0.3, tau: 0.08, dt: 2.5e-4 };
  for (const [name, hole] of levelHoles(R)) {
    let best = null;
    for (const vTarget of [0.04, 0.08, 0.13, 0.25]) {
      const res = [];
      for (let s = 1; s <= 6; s++) res.push(fiveRun({ ...base, hole, vTarget }, s * 131));
      const ok = res.filter((r) => r.t !== null).map((r) => r.t);
      const avg = (f) => res.reduce((a, r) => a + f(r), 0) / res.length;
      const row = { n: ok.length, med: ok.length ? median(ok) : null, seated: avg((r) => r.seated), dis: avg((r) => r.dislodged), vTarget };
      const score = row.n * 1000 + row.seated * 100 - (row.med ?? 0);
      if (!best || score > best.score) best = { ...row, score };
    }
    console.log(`${name.padEnd(34)} ${best.n}/6      ${fmt(best.med, 1).padEnd(9)} ${fmt(best.seated, 1).padEnd(10)} ${fmt(best.dis, 1).padEnd(13)} ${fmt(best.vTarget * 100, 0)}cm/s`);
  }
}

function plates() {
  const R = 0.01, hole = { type: 'cup', a: 1.6 * R, d: R * (1 - Math.cos(deg(30))) };
  const dt = 2.5e-4;
  console.log('\n## 10c. Plate surfaces, 32mm cup, 20mm steel ball. mu measured for steel/cast iron; c and e for iron are ASSUMED ranges, no measurement found.');
  console.log('First check: does the ball slip when rolling? Largest slip as % of speed, 0.5s rolling at each tilt.');
  for (const mu of [0.42, 0.23, 0.1]) {
    const line = [2, 6, 15, 30].map((t) => {
      const W = world({ R, mu, c: 0.002, dt: 2e-5 });
      const [gx, gz] = tiltG(t);
      const b = ball(0, 0, R, 0, 0, R);
      for (let i = 0; i < 0.3 / W.dt; i++) step(W, [b], gx, 0, gz);
      return `${t}deg:${fmt((Math.abs(b.vx - b.wy * R) / b.vx) * 100, 3)}%`;
    });
    console.log(`mu=${mu} (no-slip limit ${fmt(rad2deg(Math.atan(3.5 * mu)), 0)}deg): ${line.join('  ')}`);
  }
  console.log('\nplate                                c     e    mu   | break(deg) capture .0/.9 | 5-ball finished median avgDislodged');
  const base = { R, plateR: 0.15, ringR: 0.07, hole, Kv: 15, maxTilt: 6, limit: 120, tremor: 0.2, wander: 0.3, bias: 0.3, tau: 0.08, dt, vTarget: 0.13 };
  for (const [name, c, e, mu] of [
    ['Steel, machined', 0.002, 0.65, 0.3],
    ['Steel, hardened', 0.002, 0.95, 0.3],
    ['Cast iron, same rolling as steel', 0.002, 0.5, 0.23],
    ['Cast iron, rolling 2.5x steel', 0.005, 0.5, 0.23],
    ['Cast iron, rough, 5x steel', 0.01, 0.5, 0.23],
    ['Cloth-like, c as billiard cloth', 0.01, 0.3, 0.3],
    ['Steel look, tuned rolling (recommended)', 0.01, 0.65, 0.3],
  ]) {
    const W = world({ R, c, e, mu, hole, dt, vRest: Math.max(0.004, 2 * G * dt) });
    const caps = [0, 0.9].map((bo) => { let last = 0; for (let v = 0.01; v < 1; v *= 1.08) { if (captureRun(W, v, bo)) last = v; else break; } return fmt(last * 100, 1); });
    const res = [];
    for (let s = 1; s <= 6; s++) res.push(fiveRun({ ...base, c, e, mu }, s * 131));
    const ok = res.filter((r) => r.t !== null).map((r) => r.t);
    console.log(`${name.padEnd(36)} ${String(c).padEnd(5)} ${String(e).padEnd(4)} ${String(mu).padEnd(4)} | ${fmt(rad2deg(Math.atan(c)), 2).padEnd(10)} ${caps.join('/').padEnd(13)} | ${ok.length}/6 ${fmt(ok.length ? median(ok) : null, 1).padEnd(6)} ${fmt(res.reduce((a, r) => a + r.dislodged, 0) / 6, 1)}`);
  }
}

// --- 11. candidate hard levels ------------------------------------------------
function hard() {
  const R = 0.01, dt = 2.5e-4;
  console.log('\n## 11. Shallower cups as hard levels. 20mm ball, 32mm wide, e=0.65, mu=0.3. Stand-in, 5 balls, 120s, 6 seeds.');
  console.log('escape c     depth(mm) capture .0/.9 | dislodge 0.1s 1s slow | finished median avgSeated avgDislodged approach');
  const base = { R, plateR: 0.15, ringR: 0.07, Kv: 15, maxTilt: 6, limit: 120, tremor: 0.2, wander: 0.3, bias: 0.3, tau: 0.08, dt };
  for (const [esc, c] of [[30, 0.01], [22, 0.01], [18, 0.01], [15, 0.01], [12, 0.01], [30, 0.002], [22, 0.002], [15, 0.002]]) {
    const hole = { type: 'cup', a: 1.6 * R, d: R * (1 - Math.cos(deg(esc))) };
    const W = world({ R, c, hole, dt, vRest: Math.max(0.004, 2 * G * dt) });
    const caps = [0, 0.9].map((bo) => { let last = 0; for (let v = 0.01; v < 1; v *= 1.08) { if (captureRun(W, v, bo)) last = v; else break; } return fmt(last * 100, 1); });
    const ramp = (T) => { for (let th = 0.5; th <= esc + 3; th += 0.5) { const q = seated(W); for (let i = 0; i < (T + 1) / dt; i++) { const [gx, gz] = tiltG(Math.min(1, (i * dt) / T) * th); step(W, [q], gx, 0, gz); if (escaped(W, q)) return th; } } return null; };
    let best = null;
    for (const vTarget of [0.04, 0.08, 0.13]) {
      const res = [];
      for (let s = 1; s <= 6; s++) res.push(fiveRun({ ...base, c, hole, vTarget }, s * 131));
      const ok = res.filter((r) => r.t !== null).map((r) => r.t);
      const avg = (f) => res.reduce((a, r) => a + f(r), 0) / res.length;
      const row = { n: ok.length, med: ok.length ? median(ok) : null, seated: avg((r) => r.seated), dis: avg((r) => r.dislodged), vTarget };
      const score = row.n * 1000 + row.seated * 100 - (row.med ?? 0);
      if (!best || score > best.score) best = { ...row, score };
    }
    console.log(`${String(esc).padEnd(6)} ${String(c).padEnd(5)} ${fmt(hole.d * 1000, 2).padEnd(9)} ${caps.join('/').padEnd(13)} | ${fmt(ramp(0.1), 1).padEnd(4)} ${fmt(ramp(1), 1).padEnd(4)} ${fmt(ramp(8), 1).padEnd(9)} | ${best.n}/6 ${fmt(best.med, 1).padEnd(6)} ${fmt(best.seated, 1).padEnd(4)} ${fmt(best.dis, 1).padEnd(5)} ${fmt(best.vTarget * 100, 0)}cm/s`);
  }
}

// --- 12. configurable difficulty: ball count, plate size, obstacles ----------
const LEVELS = {
  easy: { hole: (R) => ({ type: 'cup', a: 1.1 * R, d: 2 * R }), c: 0.01 },
  medium: { hole: (R) => ({ type: 'cup', a: 1.6 * R, d: R * (1 - Math.cos(deg(30))) }), c: 0.01 },
  hard: { hole: (R) => ({ type: 'cup', a: 1.6 * R, d: R * (1 - Math.cos(deg(15))) }), c: 0.01 },
  expert: { hole: (R) => ({ type: 'cup', a: 1.6 * R, d: R * (1 - Math.cos(deg(15))) }), c: 0.002 },
};

function gameRow(cfg, seeds, speeds) {
  let best = null;
  for (const vTarget of speeds) {
    const res = [];
    for (let s = 1; s <= seeds; s++) res.push(fiveRun({ ...cfg, vTarget }, s * 131));
    const ok = res.filter((r) => r.t !== null).map((r) => r.t);
    const avg = (f) => res.reduce((a, r) => a + f(r), 0) / res.length;
    const row = { n: ok.length, med: ok.length ? median(ok) : null, worst: ok.length ? Math.max(...ok) : null, seated: avg((r) => r.seated), dis: avg((r) => r.dislodged), vTarget };
    const score = row.n * 1000 + row.seated * 100 - (row.med ?? 0);
    if (!best || score > best.score) best = { ...row, score };
  }
  return `${best.n}/${seeds}`.padEnd(6) + ` ${fmt(best.med, 1).padEnd(7)} ${fmt(best.worst, 1).padEnd(7)} ${fmt(best.seated, 1).padEnd(6)} ${fmt(best.dis, 1).padEnd(6)} ${fmt(best.vTarget * 100, 0)}cm/s`;
}

const gameBase = (R = 0.01) => ({ R, plateR: 15 * R, ringR: 7 * R, Kv: 15, maxTilt: 6, limit: 180, tremor: 0.2, wander: 0.3, bias: 0.3, tau: 0.08, dt: 2.5e-4 });
const HDR = 'finish median  slowest seated knocked approach';

function counts() {
  console.log('\n## 12a. Ball count per level. 20mm balls, 150mm plate radius, holes on a 70mm ring. Stand-in, 8 seeds, 180s.');
  console.log(`level   balls | ${HDR}`);
  for (const [lv, L] of Object.entries(LEVELS)) for (const n of [1, 3, 5, 7]) {
    console.log(`${lv.padEnd(7)} ${String(n).padEnd(5)} | ${gameRow({ ...gameBase(), n, hole: L.hole(0.01), c: L.c }, 8, [0.04, 0.08, 0.13])}`);
  }
}

function sizes() {
  console.log('\n## 12b. Plate size, everything scaled with it (ball, holes, ring). Shown at the same screen size, so on screen it only looks slower.');
  console.log('Scale-free physics predicts times grow with sqrt(size). The human delay and wobble do not scale.');
  console.log('plateR ball  level  capture(cm/s) sqrt(k) | ' + HDR);
  for (const k of [0.67, 1, 1.33, 1.67, 2]) for (const lv of ['medium', 'hard']) {
    const R = 0.01 * k, L = LEVELS[lv];
    const W = world({ R, c: L.c, hole: L.hole(R), dt: 2.5e-4, vRest: Math.max(0.004, 2 * G * 2.5e-4) });
    let cap = 0; for (let v = 0.01; v < 1; v *= 1.05) { if (captureRun(W, v, 0)) cap = v; else break; }
    const sp = [0.04, 0.08, 0.13].map((v) => v * Math.sqrt(k));
    console.log(`${fmt(150 * k, 0).padEnd(6)} ${fmt(20 * k, 0).padEnd(5)} ${lv.padEnd(6)} ${fmt(cap * 100, 1).padEnd(13)} ${fmt(Math.sqrt(k), 2).padEnd(7)} | ${gameRow({ ...gameBase(R), n: 5, hole: L.hole(R), c: L.c }, 6, sp)}`);
  }
  console.log('\nPlate size alone, ball and holes kept at 20mm/32mm (more room to roll, smaller ball on screen):');
  console.log('plateR ringR level  | ' + HDR);
  for (const pr of [0.1, 0.15, 0.2]) {
    const L = LEVELS.medium;
    console.log(`${fmt(pr * 1000, 0).padEnd(6)} ${fmt(pr * 467, 0).padEnd(5)} medium | ${gameRow({ ...gameBase(), plateR: pr, ringR: pr * 0.467, n: 5, hole: L.hole(0.01), c: L.c }, 6, [0.04, 0.08, 0.13])}`);
  }
}

function obstacles() {
  console.log('\n## 12c. Obstacles. 5 balls, 20mm, 150mm plate. Posts 10mm wide between holes; guards = 52mm wall on the rim side of each hole.');
  console.log('The stand-in only knows to go round a guard to its open side; it does not plan paths. A person will do better.');
  console.log('level   obstacles     | ' + HDR);
  for (const lv of ['easy', 'medium', 'hard']) for (const [name, o] of [['none', {}], ['5 posts', { pegs: 5 }], ['10 posts', { pegs: 10 }], ['guards', { guards: true }], ['guards+5posts', { guards: true, pegs: 5 }]]) {
    const L = LEVELS[lv];
    console.log(`${lv.padEnd(7)} ${name.padEnd(13)} | ${gameRow({ ...gameBase(), n: 5, hole: L.hole(0.01), c: L.c, ...o }, 6, [0.04, 0.08, 0.13])}`);
  }
}

const which = process.argv[2] || 'all';
const all = { validate, cross, dislodge, rate, impacts, capture, loop, pick, game, dtcheck, levels, levelGames, plates, hard, counts, sizes, obstacles };
for (const k of Object.keys(all)) if ((which === 'all' && !['levels', 'levelGames', 'plates', 'hard', 'counts', 'sizes', 'obstacles'].includes(k)) || which === k) { const t = Date.now(); all[k](); console.log(`[${k}: ${((Date.now() - t) / 1000).toFixed(1)}s]`); }
