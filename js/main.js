import { buildWorld, OPTIONS, PRESETS, settingsKey, presetOf } from './levels.js';
import { step, filledHoles, fallenBalls } from './physics.js';
import { Tilt, screenAngle } from './input.js';
import { draw } from './render.js';

const PLATE_LAG = 0.08; // seconds; stands in for the plate's weight
const HOLD_TO_WIN = 1; // every hole must stay filled this long
const MAX_STEPS_PER_FRAME = 60;
const COUNTDOWN = 3; // seconds of 3-2-1; balls stay still until Go

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
delete settings.plate; // replaced by speed
const tilt = new Tilt();
let W = null;
let mode = 'menu'; // menu | waiting | countdown | play | paused | won | lost
let started = 0, pausedAt = 0, pausedTotal = 0, allSeatedSince = null, finalTime = 0;
let lastFrame = 0, acc = 0, lastForce = null, seatedBefore = 0;
let countdownAt = 0, shownNumber = null, goUntil = 0, pausedFrom = null;
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
      if (tilt.hasData()) { beginRound(); return; }
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
$('restart').addEventListener('click', () => beginRound());

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

function beginRound() {
  W = buildWorld(settings);
  allSeatedSince = null;
  seatedBefore = 0;
  lastForce = null;
  goUntil = 0;
  $('timer').textContent = fmtTime(0);
  $('count').textContent = `0/${W.balls.length}`;
  startCountdown(performance.now());
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
    ['Play again', () => beginRound(), true],
    ['Menu', () => toMenu()],
  ]);
}

// Every hole needs a ball, so losing one over an open edge ends the round
function lose() {
  mode = 'lost';
  if (navigator.vibrate) navigator.vibrate(200);
  setOverlay('<strong>Off the edge</strong><br>A ball rolled off the plate.', [
    ['Try again', () => beginRound(), true],
    ['Menu', () => toMenu()],
  ]);
}

function pause() {
  if (mode !== 'play' && mode !== 'countdown') return;
  pausedFrom = mode;
  mode = 'paused';
  pausedAt = performance.now();
  setOverlay('Paused', [['Continue', resume, true], ['Menu', () => toMenu()]]);
}

function resume() {
  if (mode !== 'paused') return;
  if (pausedFrom === 'countdown') { startCountdown(performance.now()); return; }
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

function startCountdown(now) {
  mode = 'countdown';
  countdownAt = now;
  shownNumber = null;
}

// --- frame loop -----------------------------------------------------------
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000);
  lastFrame = now;
  if (game.hidden || !W) return;

  if (mode === 'countdown') {
    tilt.sample();
    const left = COUNTDOWN - (now - countdownAt) / 1000;
    if (left > 0) {
      const num = Math.ceil(left);
      if (num !== shownNumber) {
        shownNumber = num;
        setOverlay(`<span class="big">${num}</span><span class="hint">Hold the phone flat. At Go, the balls roll whichever way it tilts.</span>`);
        if (navigator.vibrate) navigator.vibrate(10);
      }
    } else {
      tilt.start();
      mode = 'play';
      started = now;
      pausedTotal = 0;
      acc = 0;
      goUntil = now + 600;
      setOverlay('<span class="big">Go!</span>');
      if (navigator.vibrate) navigator.vibrate(30);
    }
  }

  if (mode === 'play') {
    if (goUntil && now > goUntil) { goUntil = 0; setOverlay(''); }
    const f = tilt.force(dt, PLATE_LAG);
    lastForce = f;
    acc += dt * W.timeScale;
    let n = 0;
    while (acc >= W.dt && n < MAX_STEPS_PER_FRAME) { step(W, f.gx, f.gy, f.gz); acc -= W.dt; n++; }
    if (n === MAX_STEPS_PER_FRAME) acc = 0; // device too slow: run in slow motion instead of stalling
    if (fallenBalls(W) > 0) { lose(); draw(ctx, W, view(), null); return; }
    const elapsed = (now - started - pausedTotal) / 1000;
    // Count filled holes, not seated balls: two balls in one cup fill one hole
    const seated = filledHoles(W);
    if (seated > seatedBefore && navigator.vibrate) navigator.vibrate(15);
    seatedBefore = seated;
    $('count').textContent = `${seated}/${W.holes.length}`;
    $('timer').textContent = fmtTime(elapsed);
    if (seated === W.holes.length) {
      if (allSeatedSince === null) allSeatedSince = elapsed;
      if (elapsed - allSeatedSince >= HOLD_TO_WIN) win();
    } else {
      allSeatedSince = null;
    }
  }

  draw(ctx, W, view(), mode === 'play' ? lastForce : null);
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
