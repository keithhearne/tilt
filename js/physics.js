// Rigid steel balls on a tilting plate, in the plate's frame, SI units.
// Ported from research/sim.mjs: velocity impulses with restitution, Coulomb
// friction and a rolling-resistance torque, at a fixed 1 kHz step.

export const G = 9.81;

// open: no wall round the plate, so balls can roll off the edge
export function createWorld({ R, c, e = 0.65, mu = 0.3, plateR, holes, obstacles = [], open = false, dt = 1 / 1000 }) {
  return { R, c, e, mu, plateR, holes, obstacles, open, dt, vRest: Math.max(0.004, 2 * G * dt), passes: 3, balls: [] };
}

export function addBall(W, x, y) {
  const b = { x, y, z: W.R, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, fallen: false };
  W.balls.push(b);
  return b;
}

function contact(W, b, nx, ny, nz, gap) {
  const R = W.R;
  if (gap < 0) { b.x -= nx * gap; b.y -= ny * gap; b.z -= nz * gap; }
  const vn = b.vx * nx + b.vy * ny + b.vz * nz;
  if (vn >= 0) return;
  const er = -vn > W.vRest ? W.e : 0;
  const J = -(1 + er) * vn;
  b.vx += nx * J; b.vy += ny * J; b.vz += nz * J;
  // Position already moved with the pre-friction velocity this step; the
  // tangential change below is applied to it too, so a held ball stays put.
  const v0x = b.vx, v0y = b.vy, v0z = b.vz;
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
  // Rolling resistance c*N*R as a rolling-consistent impulse: it removes
  // 5/7 c J of rolling speed (and the matching spin), and can hold a ball at
  // rest exactly up to tan(tilt) = c. A spin-only torque lets a resting ball
  // creep at a 1 ms step.
  const vn2 = b.vx * nx + b.vy * ny + b.vz * nz;
  const vx = b.vx - vn2 * nx, vy = b.vy - vn2 * ny, vz = b.vz - vn2 * nz;
  const sv = Math.hypot(vx, vy, vz);
  const dv = Math.min(sv, (5 / 7) * W.c * J);
  if (sv > 1e-12 && dv > 0) {
    const k = dv / sv;
    const ddx = -vx * k, ddy = -vy * k, ddz = -vz * k;
    b.vx += ddx; b.vy += ddy; b.vz += ddz;
    // Matching spin change for rolling: omega = (n x v) / R
    b.wx += (ny * ddz - nz * ddy) / R;
    b.wy += (nz * ddx - nx * ddz) / R;
    b.wz += (nx * ddy - ny * ddx) / R;
  }
  b.x += (b.vx - v0x) * W.dt; b.y += (b.vy - v0y) * W.dt; b.z += (b.vz - v0z) * W.dt;
}

function solveBall(W, b) {
  const R = W.R;
  const rw = Math.hypot(b.x, b.y);
  if (W.open && rw >= W.plateR) {
    // Past an open edge the ball pivots on the plate's rim and drops away
    const ex = b.x - (W.plateR * b.x) / rw, ey = b.y - (W.plateR * b.y) / rw, ez = b.z;
    const dist = Math.hypot(ex, ey, ez);
    if (dist < R) contact(W, b, ex / dist, ey / dist, ez / dist, dist - R);
    if (b.z < -R || rw > W.plateR + 3 * R) b.fallen = true;
    return;
  }
  let h = null, r = Infinity;
  for (const hole of W.holes) {
    const d = Math.hypot(b.x - hole.x, b.y - hole.y);
    if (d < r) { r = d; h = hole; }
  }
  if (!h || r >= h.a) {
    const gap = b.z - R;
    if (gap < 0) contact(W, b, 0, 0, 1, gap);
  } else {
    const ux = r > 1e-12 ? (b.x - h.x) / r : 1, uy = r > 1e-12 ? (b.y - h.y) / r : 0;
    // Nearest point on the rim circle
    const dx = b.x - (h.x + h.a * ux), dy = b.y - (h.y + h.a * uy), dz = b.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < R) contact(W, b, dx / dist, dy / dist, dz / dist, dist - R);
    const fg = b.z + h.d - R;
    if (fg < 0) contact(W, b, 0, 0, 1, fg);
    if (b.z < 0) {
      const wg = h.a - r - R;
      if (wg < 0) contact(W, b, -ux, -uy, 0, wg);
    }
  }
  const wg = W.plateR - rw - R;
  if (!W.open && wg < 0) contact(W, b, -b.x / rw, -b.y / rw, 0, wg);
  // Obstacles are vertical capsules: posts have zero length, guards are short walls
  for (const o of W.obstacles) {
    const ex = o.x2 - o.x1, ey = o.y2 - o.y1, L2 = ex * ex + ey * ey;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((b.x - o.x1) * ex + (b.y - o.y1) * ey) / L2)) : 0;
    const dx = b.x - (o.x1 + t * ex), dy = b.y - (o.y1 + t * ey);
    const d = Math.hypot(dx, dy);
    const og = d - R - o.r;
    if (og < 0 && d > 1e-12) contact(W, b, dx / d, dy / d, 0, og);
  }
}

function solvePair(W, A, B) {
  const R = W.R;
  let dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z;
  const d = Math.hypot(dx, dy, dz);
  const gap = d - 2 * R;
  if (gap >= 0 || d < 1e-12) return;
  dx /= d; dy /= d; dz /= d;
  A.x += (dx * gap) / 2; A.y += (dy * gap) / 2; A.z += (dz * gap) / 2;
  B.x -= (dx * gap) / 2; B.y -= (dy * gap) / 2; B.z -= (dz * gap) / 2;
  const vn = (B.vx - A.vx) * dx + (B.vy - A.vy) * dy + (B.vz - A.vz) * dz;
  if (vn >= 0) return;
  const er = -vn > W.vRest ? W.e : 0;
  const J = (-(1 + er) * vn) / 2;
  A.vx -= dx * J; A.vy -= dy * J; A.vz -= dz * J;
  B.vx += dx * J; B.vy += dy * J; B.vz += dz * J;
  // Coulomb friction at the shared contact point
  const ax = R * dx, ay = R * dy, az = R * dz;
  let ux = (A.vx + A.wy * az - A.wz * ay) - (B.vx - B.wy * az + B.wz * ay);
  let uy = (A.vy + A.wz * ax - A.wx * az) - (B.vy - B.wz * ax + B.wx * az);
  let uz = (A.vz + A.wx * ay - A.wy * ax) - (B.vz - B.wx * ay + B.wy * ax);
  const un = ux * dx + uy * dy + uz * dz;
  ux -= un * dx; uy -= un * dy; uz -= un * dz;
  const s = Math.hypot(ux, uy, uz);
  if (s < 1e-12) return;
  const jt = Math.min(s / 7, W.mu * J);
  const fx = (-ux / s) * jt, fy = (-uy / s) * jt, fz = (-uz / s) * jt;
  const I = 0.4 * R * R;
  A.vx += fx; A.vy += fy; A.vz += fz;
  A.wx += (ay * fz - az * fy) / I; A.wy += (az * fx - ax * fz) / I; A.wz += (ax * fy - ay * fx) / I;
  B.vx -= fx; B.vy -= fy; B.vz -= fz;
  B.wx += (ay * fz - az * fy) / I; B.wy += (az * fx - ax * fz) / I; B.wz += (ax * fy - ay * fx) / I;
}

// gx, gy: in-plane effective gravity (m/s^2). gz: its component pressing into the plate.
// A ball that has fallen off is left where it went over and takes no further part.
export function step(W, gx, gy, gz) {
  const dt = W.dt, balls = W.balls.filter((b) => !b.fallen);
  for (const b of balls) {
    b.vx += gx * dt; b.vy += gy * dt; b.vz -= gz * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  }
  for (let p = 0; p < W.passes; p++) {
    for (const b of balls) if (!b.fallen) solveBall(W, b);
    for (let i = 0; i < balls.length; i++) for (let j = i + 1; j < balls.length; j++) {
      if (!balls[i].fallen && !balls[j].fallen) solvePair(W, balls[i], balls[j]);
    }
  }
}

export function fallenBalls(W) {
  return W.balls.filter((b) => b.fallen).length;
}

// The hole a ball has properly sunk into, or null while it is only passing over.
export function seatedHole(W, b) {
  for (const h of W.holes) {
    if (Math.hypot(b.x - h.x, b.y - h.y) < h.a && b.z < W.R - 0.5 * h.d) return h;
  }
  return null;
}

// How many holes have at least one ball in them. Two balls sharing a big cup
// fill only one hole, so a win needs this to equal the number of holes.
export function filledHoles(W) {
  const filled = new Set();
  for (const b of W.balls) {
    const h = seatedHole(W, b);
    if (h) filled.add(h);
  }
  return filled.size;
}
