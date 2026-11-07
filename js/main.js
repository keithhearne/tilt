import { buildWorld, OPTIONS, PRESETS, settingsKey, presetOf } from './levels.js';
import { step, seatedHole } from './physics.js';
import { Tilt, screenAngle } from './input.js';
import { draw } from './render.js';

const PLATE_LAG = 0.08; // seconds; stands in for the plate's weight
const HOLD_TO_WIN = 1; // all balls must stay seated this long
const MAX_STEPS_PER_FRAME = 60;

const $ = (id) => document.getElementById(id);
const menu = $('menu'), game = $('game'), canvas = $('board'), ctx = canvas.getContext('2d');
const hud = document.querySelector('.hud');
const overlay = $('overlay'), overlayText = $('overlay-text'), overlayButtons = $('overlay-buttons');

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: ignore */ }
  },
};

let settings = { ...PRESETS.medium, ...store.get('tilt-settings', {}) };
const tilt = new Tilt();
let W = null;
let mode = 'menu'; // menu | waiting | calibrate | play | paused | won
let started = 0, pausedAt = 0, pausedTotal = 0, allSeatedSince = null, finalTime = 0;
let lastFrame = 0, acc = 0, lastForce = null, seatedBefore = 0;
let wakeLock = null;

// --- menu -------------------------------------------------------------------
function buildMenu() {
  const presetBox = $('presets');
  for (const name of Object.keys(PRESETS)) {
    const b = document.createElement('button');
    b.className = 'preset';
    b.dataset.preset = name;
    b.textContent = name[0].toUpperCase() + name.slice(1);
    b.addEventListener('click', () => { settings = { ...PRESETS[name] }; saveSettings(); });
    presetBox.appendChild(b);
  }
  const box = $('options');
  for (const [key, opt] of Object.entries(OPTIONS)) {
    const row = document.createElement('div');
    row.className = 'option';
    row.dataset.key = key;
    const label = document.createElement('span');
    label.textContent = opt.label;
    row.appendChild(label);
    const seg = document.createElement('div');
    seg.className = 'seg';
    for (const v of opt.values) {
      const b = document.createElement('button');
      b.dataset.key = key;
      b.dataset.value = String(v);
      b.textContent = opt.names ? opt.names[v] : String(v);
      b.addEventListener('click', () => { settings = { ...settings, [key]: v }; saveSettings(); });
      seg.appendChild(b);
    }
    row.appendChild(seg);
    box.appendChild(row);
  }
  refreshMenu();
}

function saveSettings() {
  store.set('tilt-settings', settings);
  refreshMenu();
}

function refreshMenu() {
  const p = presetOf(settings);
  for (const b of document.querySelectorAll('.preset')) b.classList.toggle('on', b.dataset.preset === p);
  for (const b of document.querySelectorAll('.seg button')) b.classList.toggle('on', String(settings[b.dataset.key]) === b.dataset.value);
  // Cup size does nothing for pockets
  for (const [key, opt] of Object.entries(OPTIONS)) {
    if (!opt.cupsOnly) continue;
    const off = settings.hole === 'pocket';
    const row = document.querySelector(`.option[data-key="${key}"]`);
    row.classList.toggle('off', off);
    for (const b of row.querySelectorAll('button')) b.disabled = off;
  }
  const best = store.get('tilt-best', {})[settingsKey(settings)];
  $('best').textContent = best ? `Best: ${fmtTime(best)}` : 'No best time yet';
  $('custom-label').textContent = p ? `Settings (${p})` : 'Settings (custom)';
}

function showMessage(text) {
  $('msg').textContent = text;
  $('msg').hidden = !text;
}

// --- flow -------------------------------------------------------------------
$('play').addEventListener('click', () => {
  showMessage('');
  // Ask for motion access first thing in the tap, as iOS requires
  tilt.request().then((r) => {
    if (r === 'denied') {
      // Browsers without sensors can answer "denied" without asking anyone
      const phone = window.matchMedia('(pointer: coarse)').matches;
      showMessage(phone
        ? 'Motion access was not allowed. Reload the page and tap Play to be asked again.'
        : 'No tilt sensor here. Open this page on your phone to play.');
      return;
    }
    enterGame();
    mode = 'waiting';
    setOverlay('Starting sensors…');
    const askedAt = performance.now();
    const wait = () => {
      if (mode !== 'waiting') return;
      if (tilt.hasData()) { beginCalibration(); return; }
      if (performance.now() - askedAt > 2000) {
        tilt.stop();
        toMenu();
        showMessage('No tilt sensor found. Open this page on your phone to play.');
        return;
      }
      setTimeout(wait, 100);
    };
    wait();
  });
});

$('back').addEventListener('click', () => toMenu());
$('restart').addEventListener('click', () => beginCalibration());

function enterGame() {
  menu.hidden = true;
  game.hidden = false;
  resize();
  requestWakeLock();
}

function toMenu() {
  mode = 'menu';
  W = null;
  game.hidden = true;
  menu.hidden = false;
  releaseWakeLock();
  refreshMenu();
}

function beginCalibration() {
  W = buildWorld(settings);
  mode = 'calibrate';
  allSeatedSince = null;
  seatedBefore = 0;
  lastForce = null;
  $('timer').textContent = fmtTime(0);
  $('count').textContent = `0/${W.balls.length}`;
  setOverlay('Hold your phone flat and still…');
}

function setOverlay(text, buttons = []) {
  overlay.hidden = !text;
  overlayText.innerHTML = text;
  overlayButtons.replaceChildren(...buttons.map(([label, fn, primary]) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (primary) b.className = 'primary';
    b.addEventListener('click', fn);
    return b;
  }));
}

function win() {
  mode = 'won';
  finalTime = allSeatedSince;
  const key = settingsKey(settings);
  const bests = store.get('tilt-best', {});
  const isBest = !bests[key] || finalTime < bests[key];
  if (isBest) { bests[key] = finalTime; store.set('tilt-best', bests); }
  $('timer').textContent = fmtTime(finalTime);
  if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
  setOverlay(`<strong>${fmtTime(finalTime)}</strong><br>${isBest ? 'New best time!' : `Best: ${fmtTime(bests[key])}`}`, [
    ['Play again', () => beginCalibration(), true],
    ['Menu', () => toMenu()],
  ]);
}

function pause() {
  if (mode !== 'play') return;
  mode = 'paused';
  pausedAt = performance.now();
  setOverlay('Paused', [['Continue', resume, true], ['Menu', () => toMenu()]]);
}

function resume() {
  if (mode !== 'paused') return;
  pausedTotal += performance.now() - pausedAt;
  acc = 0;
  lastFrame = performance.now();
  mode = 'play';
  setOverlay('');
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
  else if (!game.hidden) requestWakeLock();
});

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { /* not supported or refused: the game still works */ }
}

function releaseWakeLock() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}

// --- frame loop -----------------------------------------------------------
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000);
  lastFrame = now;
  if (game.hidden || !W) return;

  if (mode === 'calibrate') {
    const c = tilt.calibrate();
    if (c.state === 'done') {
      mode = 'play';
      started = now;
      pausedTotal = 0;
      acc = 0;
      setOverlay('');
    } else {
      const pct = Math.round(c.progress * 100);
      const msg = {
        wait: 'Waiting for the sensors…',
        tilted: 'Lay your phone flat, screen up.',
        shaky: 'Hold it still…',
        ok: `Hold flat… ${pct}%`,
      }[c.state];
      setOverlay(msg);
    }
  }

  if (mode === 'play') {
    const f = tilt.force(dt, PLATE_LAG);
    lastForce = f;
    acc += dt;
    let n = 0;
    while (acc >= W.dt && n < MAX_STEPS_PER_FRAME) { step(W, f.gx, f.gy, f.gz); acc -= W.dt; n++; }
    if (n === MAX_STEPS_PER_FRAME) acc = 0; // device too slow: run in slow motion instead of stalling
    const elapsed = (now - started - pausedTotal) / 1000;
    const seated = W.balls.filter((b) => seatedHole(W, b)).length;
    if (seated > seatedBefore && navigator.vibrate) navigator.vibrate(15);
    seatedBefore = seated;
    $('count').textContent = `${seated}/${W.balls.length}`;
    $('timer').textContent = fmtTime(elapsed);
    if (seated === W.balls.length) {
      if (allSeatedSince === null) allSeatedSince = elapsed;
      if (elapsed - allSeatedSince >= HOLD_TO_WIN) win();
    } else {
      allSeatedSince = null;
    }
  }

  draw(ctx, W, view(), mode === 'play' || mode === 'calibrate' ? (mode === 'play' ? lastForce : null) : null);
}

function view() {
  return { w: canvas.clientWidth, h: canvas.clientHeight, dpr: window.devicePixelRatio || 1, angle: screenAngle(), top: hud.offsetHeight };
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
}
window.addEventListener('resize', resize);
if (screen.orientation) screen.orientation.addEventListener?.('change', resize);

function fmtTime(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

// Open with ?debug to inspect the running world from the console
if (new URLSearchParams(location.search).has('debug')) {
  window.tiltDebug = { get world() { return W; }, get mode() { return mode; }, tilt };
}

buildMenu();
requestAnimationFrame(frame);
