// Top-down drawing of the plate. Physics coordinates are fixed to the device;
// the drawing turns with the screen rotation so the board never spins.

export function draw(ctx, W, view, force) {
  const { w, h, dpr, angle, top = 0 } = view;
  const th = (angle * Math.PI) / 180, co = Math.cos(th), si = Math.sin(th);
  // Fit the plate below the top bar; centre it on the screen when there is room
  const room = Math.min(w, h - 2 * top) >= Math.min(w, h - top) * 0.9 ? h - 2 * top : h - top;
  const cx = w / 2, cy = room === h - 2 * top ? h / 2 : top + room / 2;
  const s = (Math.min(w, room) / 2 - 14) / W.plateR;
  const P = (x, y) => [cx + s * (x * co - y * si), cy - s * (x * si + y * co)];

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // Plate with a raised rim, or with an open edge only a thin bevel
  const pr = W.plateR * s;
  const rimW = W.open ? 2 : 9;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  ctx.beginPath();
  ctx.arc(cx, cy, pr + rimW + 1, 0, Math.PI * 2);
  ctx.fillStyle = '#3a4048';
  ctx.fill();
  ctx.restore();
  const rim = ctx.createLinearGradient(cx - pr, cy - pr, cx + pr, cy + pr);
  rim.addColorStop(0, '#d8dde3');
  rim.addColorStop(0.5, '#7d858f');
  rim.addColorStop(1, '#3d434b');
  ctx.beginPath();
  ctx.arc(cx, cy, pr + rimW, 0, Math.PI * 2);
  ctx.fillStyle = rim;
  ctx.fill();
  const face = ctx.createRadialGradient(cx - pr * 0.35, cy - pr * 0.4, pr * 0.05, cx, cy, pr);
  face.addColorStop(0, '#c9ced4');
  face.addColorStop(0.6, '#a2a9b1');
  face.addColorStop(1, '#868e97');
  ctx.beginPath();
  ctx.arc(cx, cy, pr, 0, Math.PI * 2);
  ctx.fillStyle = face;
  ctx.fill();
  // Faint machining rings
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let r = pr * 0.08; r < pr; r += pr * 0.045) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Holes; a filled one gets a soft green ring
  const filled = new Set();
  for (const b of W.balls) {
    for (const hole of W.holes) if (Math.hypot(b.x - hole.x, b.y - hole.y) < hole.a && b.z < W.R - 0.5 * hole.d) filled.add(hole);
  }
  for (const hole of W.holes) {
    const [x, y] = P(hole.x, hole.y);
    const r = hole.a * s;
    const deep = Math.min(1, hole.d / (2 * W.R));
    const g = ctx.createRadialGradient(x + r * 0.25, y + r * 0.3, r * 0.1, x, y, r);
    g.addColorStop(0, `rgba(${90 - 70 * deep},${96 - 72 * deep},${104 - 76 * deep},1)`);
    g.addColorStop(1, `rgba(${40 - 30 * deep},${44 - 32 * deep},${50 - 36 * deep},1)`);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = filled.has(hole) ? 'rgba(120,230,160,0.9)' : 'rgba(255,255,255,0.35)';
    ctx.stroke();
  }

  // Obstacles
  for (const o of W.obstacles) {
    const [x1, y1] = P(o.x1, o.y1), [x2, y2] = P(o.x2, o.y2);
    const r = o.r * s;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 3;
    if (o.kind === 'post') {
      const g = ctx.createRadialGradient(x1 - r * 0.4, y1 - r * 0.4, r * 0.1, x1, y1, r);
      g.addColorStop(0, '#e9edf1');
      g.addColorStop(1, '#4f565f');
      ctx.beginPath();
      ctx.arc(x1, y1, r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(3, r * 2);
      ctx.strokeStyle = '#5b636c';
      ctx.stroke();
    }
    ctx.restore();
  }

  // Balls, lowest first; sunk balls are darker and cast less shadow.
  // One dropping over an open edge shrinks as it falls away.
  const balls = W.balls.filter((b) => !b.fallen).sort((a, b) => a.z - b.z);
  for (const b of balls) {
    const [x, y] = P(b.x, b.y);
    const over = W.open && Math.hypot(b.x, b.y) > W.plateR;
    const R = W.R * s * (over ? Math.max(0.5, 1 + Math.min(0, b.z) / (2 * W.R)) : 1);
    const sink = over ? 0 : Math.max(0, Math.min(1, (W.R - b.z) / W.R));
    ctx.beginPath();
    ctx.ellipse(x + R * 0.28, y + R * 0.32, R * 0.95, R * 0.85, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0,0,0,${0.35 * (1 - sink * 0.8)})`;
    ctx.fill();
    const g = ctx.createRadialGradient(x - R * 0.38, y - R * 0.42, R * 0.05, x, y, R);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.18, '#e6eaee');
    g.addColorStop(0.55, '#9aa2ab');
    g.addColorStop(0.85, '#4a5159');
    g.addColorStop(1, '#2a2f35');
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    if (sink > 0.05) {
      ctx.fillStyle = `rgba(10,14,18,${0.45 * sink})`;
      ctx.fill();
    }
  }

  // Spirit level: the bubble drifts uphill, so it sits centred when flat
  if (force) {
    const lr = 22, lx = w - lr - 16, ly = h - lr - 16 - (view.bottomInset || 0);
    ctx.beginPath();
    ctx.arc(lx, ly, lr, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(lx, ly, lr * 0.3, 0, Math.PI * 2);
    ctx.stroke();
    // 10 degrees of tilt reaches the edge
    const k = Math.min(1, Math.hypot(force.gx, force.gy) / (9.81 * Math.sin(Math.PI / 18)));
    const m = Math.hypot(force.gx, force.gy) || 1;
    const dx = -force.gx / m, dy = -force.gy / m;
    const bx = lx + (dx * co - dy * si) * k * (lr - 6), by = ly - (dx * si + dy * co) * k * (lr - 6);
    ctx.beginPath();
    ctx.arc(bx, by, 6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(160,240,190,0.9)';
    ctx.fill();
  }
}
