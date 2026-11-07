// Phone tilt as the effective gravity a ball on the plate would feel.
//
// Main source: devicemotion accelerationIncludingGravity. It is the phone's
// proper acceleration, so tilts and hand jerks both come through, as they
// would for a real tray. Fallback: deviceorientation beta/gamma turned into a
// gravity direction. Both are in the device's own frame, which does not turn
// when the screen rotates.

const G = 9.81;
const LEVEL_SECONDS = 0.5; // the angle is averaged over this long before Go

export class Tilt {
  constructor() {
    this.motion = null; // latest [x, y, z] proper acceleration, device frame
    this.motionAt = 0;
    this.orient = null; // the same, derived from orientation angles
    this.orientAt = 0;
    this.samples = [];
    this.source = null;
    this.sign = 1;
    this.basis = null; // calibrated plate axes in device frame
    this.smooth = null;
    this.onMotion = (e) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x == null || a.y == null || a.z == null) return;
      this.motion = [a.x, a.y, a.z];
      this.motionAt = performance.now();
    };
    this.onOrient = (e) => {
      if (e.beta == null || e.gamma == null) return;
      const b = (e.beta * Math.PI) / 180, g = (e.gamma * Math.PI) / 180;
      // Upward unit vector in device frame for the spec's Z-X'-Y'' angles, times g
      this.orient = [-Math.cos(b) * Math.sin(g) * G, Math.sin(b) * G, Math.cos(b) * Math.cos(g) * G];
      this.orientAt = performance.now();
    };
  }

  // Must be called straight from a tap handler, before any await, for iOS.
  request() {
    const asks = [];
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      asks.push(DeviceMotionEvent.requestPermission());
    }
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      asks.push(DeviceOrientationEvent.requestPermission());
    }
    return Promise.allSettled(asks).then((res) => {
      const granted = res.some((r) => r.status === 'fulfilled' && r.value === 'granted');
      const asked = res.length > 0;
      if (asked && !granted) return 'denied';
      window.addEventListener('devicemotion', this.onMotion);
      window.addEventListener('deviceorientation', this.onOrient);
      return 'granted';
    });
  }

  stop() {
    window.removeEventListener('devicemotion', this.onMotion);
    window.removeEventListener('deviceorientation', this.onOrient);
  }

  hasData() {
    return this.motion !== null || this.orient !== null;
  }

  reading() {
    const now = performance.now();
    if (this.motion && now - this.motionAt < 500) return { src: 'motion', v: this.motion };
    if (this.orient && now - this.orientAt < 500) return { src: 'orient', v: this.orient };
    return null;
  }

  // Call every frame of the countdown; whatever angle the phone is held at
  // just before Go becomes level.
  sampleLevel() {
    const r = this.reading();
    if (!r) return;
    const now = performance.now();
    this.samples.push({ t: now, src: r.src, v: r.v.slice() });
    this.samples = this.samples.filter((s) => now - s.t <= LEVEL_SECONDS * 1000 && s.src === r.src);
  }

  // Fix "level" at Go. Returns false if there was no reading to use.
  setLevel() {
    const r = this.reading();
    const samples = this.samples.length ? this.samples : r ? [{ src: r.src, v: r.v }] : [];
    if (!samples.length) return false;
    const src = samples[samples.length - 1].src;
    const mean = [0, 1, 2].map((i) => samples.reduce((a, s) => a + s.v[i], 0) / samples.length);
    this.source = src;
    // The spec reports +g along "up". Some iPhones have reported the opposite
    // sign, so check the motion reading against the orientation angles when we
    // have both, which works at any angle; otherwise assume the screen faces up.
    if (src === 'motion') {
      const o = this.orient && performance.now() - this.orientAt < 500 ? this.orient : null;
      this.sign = (o ? dot(mean, o) : mean[2]) < 0 ? -1 : 1;
    } else {
      this.sign = 1;
    }
    const up = norm(mean.map((v) => v * this.sign));
    // Plate axes follow the device's own x (or y when x points almost straight up)
    const ref = Math.abs(up[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    let px = norm(sub(ref, scale(up, dot(ref, up))));
    let py = cross(up, px);
    if (ref[1] === 1) { const t = px; px = scale(py, -1); py = t; }
    this.basis = { px, py, up };
    this.smooth = null;
    this.samples = [];
    return true;
  }

  // Effective gravity on the plate: { gx, gy } in-plane, gz pressing into it.
  // tau is the heavy-plate lag in seconds.
  force(dt, tau) {
    const r = this.reading();
    if (!r || !this.basis) return this.smooth ?? { gx: 0, gy: 0, gz: G };
    const a = (r.src === 'motion' ? r.v.map((v) => v * this.sign) : r.v);
    const { px, py, up } = this.basis;
    // A ball feels the opposite of the plate's proper acceleration
    const raw = { gx: -dot(a, px), gy: -dot(a, py), gz: Math.max(0, dot(a, up)) };
    if (!this.smooth) this.smooth = raw;
    const k = 1 - Math.exp(-dt / tau);
    for (const key of ['gx', 'gy', 'gz']) this.smooth[key] += (raw[key] - this.smooth[key]) * k;
    return this.smooth;
  }
}

// Screen rotation in degrees, counter-clockwise, so drawing can stay fixed to the device.
export function screenAngle() {
  if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
  if (typeof window.orientation === 'number') return window.orientation;
  return 0;
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => scale(a, 1 / Math.hypot(...a));
