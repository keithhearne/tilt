// Checks that the plate follows real gravity at any angle, as a real tray
// would, whichever sign convention the phone reports in.
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

function startAt(beta, gamma, opts) {
  const t = new Tilt();
  for (let i = 0; i < 10; i++) { feed(t, beta, gamma, opts); t.sample(); }
  assert.ok(t.start());
  return t;
}

const force = (t) => { t.smooth = null; return { ...t.force(1, 0.001) }; };
const near = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;

for (const [name, opts] of [
  ['spec signs', {}],
  ['iPhone-style flipped motion signs', { flipMotion: true }],
]) {
  test(`flat means no push and full weight (${name})`, () => {
    const t = startAt(0, 0, opts);
    feed(t, 0, 0, opts);
    const f = force(t);
    assert.ok(near(f.gx, 0) && near(f.gy, 0) && near(f.gz, G), JSON.stringify(f));
  });

  test(`started at 30 degrees, the balls roll toward the lower edge straight away (${name})`, () => {
    // Top edge raised 30 degrees: downhill is toward the bottom of the screen (-y)
    const t = startAt(30, 0, opts);
    feed(t, 30, 0, opts);
    const f = force(t);
    assert.ok(near(f.gy, -G * Math.sin(deg(30))) && near(f.gx, 0) && near(f.gz, G * Math.cos(deg(30))), JSON.stringify(f));
    // Bringing it back to flat stops the push, wherever the round started
    feed(t, 0, 0, opts);
    const f0 = force(t);
    assert.ok(near(f0.gx, 0) && near(f0.gy, 0), JSON.stringify(f0));
  });

  test(`right edge down rolls the balls right (${name})`, () => {
    const t = startAt(0, 0, opts);
    feed(t, 0, 5, opts);
    const f = force(t);
    assert.ok(near(f.gx, G * Math.sin(deg(5))) && near(f.gy, 0), JSON.stringify(f));
  });
}

test('flat with flipped signs and no orientation data still works', () => {
  const t = startAt(0, 0, { flipMotion: true, orientation: false });
  assert.equal(t.sign, -1);
  feed(t, 0, 3, { flipMotion: true, orientation: false });
  const f = force(t);
  assert.ok(f.gx > 0.4 && Math.abs(f.gy) < 0.01, JSON.stringify(f));
});

test('the sign check works when started steeply tilted', () => {
  // At 70 degrees the screen barely faces up, so the check must use the
  // orientation angles rather than assume the screen is up
  const t = startAt(70, 0, { flipMotion: true });
  assert.equal(t.sign, -1);
  feed(t, 70, 0, { flipMotion: true });
  assert.ok(force(t).gy < -9, 'balls still roll downhill');
});
