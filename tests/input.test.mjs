// Checks that whatever angle the phone is held at Go becomes level, and that
// tilting from there rolls the balls the right way.
// Run: node --test tests/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tilt } from '../js/input.js';

const G = 9.81;
const deg = (x) => (x * Math.PI) / 180;

// World "up" in the device frame for a phone pitched by beta about its x axis
// (top edge raised) and then rolled by gamma about its y axis (right edge down).
function upInDevice(beta, gamma) {
  const b = deg(beta), g = deg(gamma);
  // up_dev = Ry(g)^T Rx(b)^T (0, 0, 1)
  const u = [0, Math.sin(b), Math.cos(b)];
  return [u[0] * Math.cos(g) - u[2] * Math.sin(g), u[1], u[0] * Math.sin(g) + u[2] * Math.cos(g)];
}

function feed(t, beta, gamma, { flipMotion = false, orientation = true } = {}) {
  const up = upInDevice(beta, gamma).map((v) => v * G);
  t.motion = up.map((v) => (flipMotion ? -v : v));
  t.motionAt = performance.now();
  if (orientation) { t.orient = up; t.orientAt = performance.now(); }
}

function levelAt(beta, gamma, opts) {
  const t = new Tilt();
  for (let i = 0; i < 10; i++) { feed(t, beta, gamma, opts); t.sampleLevel(); }
  assert.ok(t.setLevel());
  return t;
}

const force = (t) => { t.smooth = null; return { ...t.force(1, 0.001) }; };

for (const [name, opts] of [
  ['spec signs', {}],
  ['iPhone-style flipped motion signs', { flipMotion: true }],
]) {
  test(`held at 40 degrees counts as level (${name})`, () => {
    const t = levelAt(40, 0, opts);
    feed(t, 40, 0, opts);
    const f0 = force(t);
    assert.ok(Math.abs(f0.gx) < 1e-9 && Math.abs(f0.gy) < 1e-9, `level should give no push: ${JSON.stringify(f0)}`);
    assert.ok(Math.abs(f0.gz - G) < 1e-6);
    // Turning the phone 3 degrees about its own long axis, right edge down:
    // balls roll right (+x). At a 40 degree hold only cos(40) of that turn
    // tilts the plate; the rest is a spin about the vertical.
    feed(t, 40, 3, opts);
    const fr = force(t);
    assert.ok(Math.abs(fr.gx - G * Math.cos(deg(40)) * Math.sin(deg(3))) < 0.01 && Math.abs(fr.gy) < 0.01, `roll right: ${JSON.stringify(fr)}`);
    // Top edge raised 3 more degrees: balls roll towards the bottom (-y)
    feed(t, 43, 0, opts);
    const fb = force(t);
    assert.ok(Math.abs(fb.gy + G * Math.sin(deg(3))) < 0.01 && Math.abs(fb.gx) < 0.01, `roll down: ${JSON.stringify(fb)}`);
  });
}

test('flat with flipped signs and no orientation data still works', () => {
  const t = levelAt(0, 0, { flipMotion: true, orientation: false });
  assert.equal(t.sign, -1);
  feed(t, 0, 3, { flipMotion: true, orientation: false });
  const f = force(t);
  assert.ok(f.gx > 0.4 && Math.abs(f.gy) < 0.01, JSON.stringify(f));
});

test('held on its side (x axis pointing up) gives a usable level', () => {
  const t = levelAt(0, -88);
  feed(t, 0, -88);
  const f0 = force(t);
  assert.ok(Math.hypot(f0.gx, f0.gy) < 1e-6 && Math.abs(f0.gz - G) < 1e-6, JSON.stringify(f0));
  const { px, py, up } = t.basis;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  assert.ok(Math.abs(dot(px, py)) < 1e-9 && Math.abs(dot(px, up)) < 1e-9 && Math.abs(dot(py, up)) < 1e-9);
  // Tilting further still moves the balls
  feed(t, 0, -84);
  assert.ok(Math.hypot(...Object.values(force(t)).slice(0, 2)) > 0.5);
});
