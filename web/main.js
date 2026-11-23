// Shardlight: screens, turns, input and sound. Rules and the AI are Rust (engine.js); the 3D world
// and its animations are scene.js.
import { loadEngine, createAi, LAYOUTS, LEVELS } from './engine.js';
import { createScene } from './scene.js';

const $ = (s) => document.querySelector(s);
const MOBILE = matchMedia('(pointer: coarse)').matches;

// ---------------------------------------------------------------- saved settings and record
const KEY = 'shardlight.v1';
const save = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })();
save.cfg ||= { mode: 'ai', level: 1, side: 0, layout: 0 };
save.sound ??= true;
save.record ||= {}; // per difficulty: { w, l, d }
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* private mode */ } };

// ---------------------------------------------------------------- sound (tiny synth, no files)
const sfx = (() => {
  let ac = null;
  const ctx = () => (ac ||= new (window.AudioContext || window.webkitAudioContext)());
  function tone(freq, dur, { type = 'sine', vol = 0.16, slide = 0, delay = 0, vib = 0 } = {}) {
    if (!save.sound) return;
    const a = ctx(), t = a.currentTime + delay;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    if (vib) { const l = a.createOscillator(), lg = a.createGain(); l.frequency.value = vib; lg.gain.value = freq * 0.06; l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + dur); }
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  const SCALE = [523, 587, 659, 784, 880, 1047, 1175, 1319, 1568];
  // a glassy bell: a pure tone plus a quieter, slightly sharp overtone, with a long fade
  const chime = (f, delay = 0, vol = 0.1) => { tone(f, 0.9, { vol, delay }); tone(f * 2.76, 0.5, { vol: vol * 0.35, delay }); };
  return {
    unlock() { if (save.sound) ctx().resume?.(); },
    tap() { chime(1320, 0, 0.05); },
    nope() { tone(150, 0.1, { type: 'square', vol: 0.035 }); },
    fly(side, split) { tone(side ? 520 : 440, split ? 0.3 : 0.45, { type: 'triangle', vol: 0.05, slide: split ? 300 : 500 }); },
    land() { chime(880, 0, 0.09); tone(140, 0.15, { vol: 0.12, slide: -60 }); },
    flip(side, k) { chime(SCALE[Math.min(k, 8)] * (side ? 1.5 : 1), 0, 0.08); },
    fill(k) { chime(1047 + (k % 8) * 90, 0, 0.03); },
    win() { [0, 2, 4, 7, 8].forEach((n, k) => chime(SCALE[n], k * 0.12, 0.1)); },
    lose() { tone(330, 0.3, { type: 'triangle', vol: 0.1, slide: -100 }); tone(247, 0.45, { type: 'triangle', vol: 0.1, slide: -80, delay: 0.22 }); },
  };
})();
const vibrate = (ms) => {
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try { navigator.vibrate?.(ms); } catch { /* not supported */ }
};

// ---------------------------------------------------------------- boot
const E = await loadEngine();
const AI = createAi(E);
const view = createScene($('#view'), { mobile: MOBILE });

// ---------------------------------------------------------------- game state
let G = null; // { layout, mode, level, human, demo, busy, selected, targets, token }
let screen = 'title';

const pieces = () => Array.from({ length: G.n }, (_, i) => E.piece(i));
const isHuman = (side) => G.mode === 'local' || side === G.human;
const SIDE_NAME = ['Rubies', 'Sapphires'];

function newGame({ layout, mode, level, human, demo = false }) {
  const cells = E.newGame(layout);
  G = { layout, mode, level, human, demo, n: cells.length, busy: false, selected: -1, targets: [], token: (G?.token || 0) + 1, hint: null };
  view.setBoard(cells, pieces());
  view.resetView(true);
  view.setThinking(-1);
  view.setHint(null);
  updateHud();
  nextTurn();
}

function updateHud() {
  if (!G) return;
  $('#n-bee').textContent = E.count(0);
  $('#n-wasp').textContent = E.count(1);
  const turn = E.turn;
  $('#pill-bee').classList.toggle('on', E.winner < 0 && turn === 0);
  $('#pill-wasp').classList.toggle('on', E.winner < 0 && turn === 1);
  if (G.mode === 'ai') {
    $('#name-bee').textContent = G.human === 0 ? 'You' : `Rubies · ${LEVELS[G.level]}`;
    $('#name-wasp').textContent = G.human === 1 ? 'You' : `Sapphires · ${LEVELS[G.level]}`;
  } else { $('#name-bee').textContent = 'Rubies'; $('#name-wasp').textContent = 'Sapphires'; }
  let status = '';
  if (E.winner >= 0) status = '';
  else if (G.mode === 'local') status = `${SIDE_NAME[turn]} to move`;
  else status = isHuman(turn) ? 'Your move' : `${SIDE_NAME[turn]} are thinking…`;
  $('#status').textContent = status;
  $('#status').style.opacity = status ? 1 : 0;
  $('#btn-undo').disabled = G.busy || E.movesMade === 0 || (G.mode === 'ai' && E.movesMade < (G.human === 0 ? 1 : 2));
  $('#btn-hint').disabled = G.busy || E.winner >= 0 || !isHuman(turn);
}

async function nextTurn() {
  if (!G) return;
  updateHud();
  if (E.winner >= 0) return gameOver();
  const turn = E.turn;
  if (G.demo || !isHuman(turn)) {
    const token = G.token;
    view.setThinking(turn);
    const started = performance.now();
    const m = await AI.think(G.layout, G.demo ? 1 : G.level);
    // keep the pace readable: never answer instantly
    const minWait = G.demo ? 700 : 450;
    const left = minWait - (performance.now() - started);
    if (left > 0) await new Promise((r) => setTimeout(r, left));
    if (!G || token !== G.token) return; // the game changed while it was thinking
    view.setThinking(-1);
    if (m) await play(m.from, m.to);
  }
}

async function play(from, to) {
  const token = G.token;
  const side = E.turn;
  const res = E.play(from, to);
  if (!res) return;
  G.busy = true; G.selected = -1; G.targets = []; G.hint = null;
  view.clearSelect(); view.setHint(null);
  view.speed = 1;
  updateHud();
  if (!G.demo) vibrate(10);
  await view.playMove(res, side, G.demo ? {} : sfx);
  if (!G || token !== G.token) return;
  view.speed = 1;
  G.busy = false;
  updateHud();
  nextTurn();
}

function gameOver() {
  const w = E.winner;
  const [b, wa] = [E.count(0), E.count(1)];
  view.setThinking(-1);
  view.celebrate(w === 2 ? 0 : w);
  if (G.demo) { setTimeout(() => { if (G?.demo) startDemo(); }, 3500); return; }
  let title, text;
  if (G.mode === 'local') { title = w === 2 ? 'A draw!' : `${SIDE_NAME[w]} win!`; text = w === 2 ? 'Perfectly balanced.' : `${SIDE_NAME[w]} hold ${Math.max(b, wa)} of ${b + wa} cells.`; sfx.win(); }
  else {
    const rec = (save.record[G.level] ||= { w: 0, l: 0, d: 0 });
    if (w === 2) { title = 'A draw!'; rec.d++; sfx.win(); }
    else if (w === G.human) { title = 'You win!'; rec.w++; sfx.win(); vibrate([20, 40, 20]); }
    else { title = `The ${SIDE_NAME[w].toLowerCase()} win`; rec.l++; sfx.lose(); }
    persist();
    text = `${LEVELS[G.level]} · ${LAYOUTS[G.layout]} board · your record here: ${rec.w}–${rec.l}${rec.d ? '–' + rec.d : ''}`;
  }
  $('#result-title').textContent = title;
  $('#r-bee').textContent = b; $('#r-wasp').textContent = wa;
  $('#result-text').textContent = text;
  setTimeout(() => $('#result').classList.remove('hidden'), 1400);
}

// ---------------------------------------------------------------- input
// Dragging turns the board (scene.js handles that); only clean taps reach the game.
const canvas = $('#view');
canvas.addEventListener('pointerdown', () => sfx.unlock());
view.onTap((x, y) => {
  if (screen !== 'game' || !G) return;
  if (G.busy) { view.speed = 4; return; } // tap during a move: fast-forward
  if (E.winner >= 0 || !isHuman(E.turn)) return;
  const c = view.pick(x, y);
  if (c < 0) { deselect(); return; }
  if (G.selected >= 0 && G.targets.some((t) => t.to === c)) return void play(G.selected, c);
  if (E.piece(c) === E.turn + 1) return select(c);
  deselect();
});
// a "recentre" button appears once you've turned or zoomed the board
view.onViewChange((away) => $('#btn-view').classList.toggle('hidden', !away));
$('#btn-view').onclick = () => { sfx.tap(); view.resetView(); };
function select(i) {
  G.selected = i;
  G.targets = E.targets(i);
  view.select(i, G.targets);
  if (G.hint && G.hint.from !== i) { G.hint = null; view.setHint(null); }
  sfx.tap(); vibrate(6);
  if (!G.targets.length) { sfx.nope(); toast('That piece is boxed in'); }
}
function deselect() { if (G.selected >= 0) { G.selected = -1; G.targets = []; view.clearSelect(); } }

let toastTimer = 0;
function toast(msg, ms = 1500) {
  const t = $('#toast'); t.textContent = msg; t.style.opacity = 1;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.style.opacity = 0), ms);
}

// ---------------------------------------------------------------- tools
$('#btn-undo').onclick = () => {
  if (!G || G.busy) return;
  G.token++; // cancel an AI that's thinking
  view.setThinking(-1);
  // in a computer game, step back to your own turn
  do { if (!E.undo()) break; } while (G.mode === 'ai' && E.turn !== G.human);
  deselect(); G.hint = null; view.setHint(null);
  view.sync(pieces());
  $('#result').classList.add('hidden');
  sfx.tap();
  updateHud();
  nextTurn();
};
$('#btn-hint').onclick = async () => {
  if (!G || G.busy || E.winner >= 0 || !isHuman(E.turn)) return;
  sfx.tap();
  const token = G.token, moves = E.movesMade;
  $('#btn-hint').disabled = true;
  const m = await AI.think(G.layout, 2);
  if (!G || token !== G.token || moves !== E.movesMade) return;
  updateHud();
  if (!m) return;
  G.hint = m;
  view.setHint(m);
  select(m.from);
};
const syncSound = () => { $('#snd-wave').style.display = save.sound ? '' : 'none'; $('#snd-label').textContent = save.sound ? 'Sound' : 'Muted'; };
$('#btn-sound').onclick = () => { save.sound = !save.sound; persist(); syncSound(); sfx.tap(); };
syncSound();

// ---------------------------------------------------------------- screens
function hudPads() {
  // keep the board clear of the bars at the top and bottom
  const top = $('#hud > div:first-child').getBoundingClientRect().bottom + 6;
  const bottom = innerHeight - $('#tools').getBoundingClientRect().top + 6;
  return { top, bottom };
}
function show(name) {
  screen = name;
  $('#title').classList.toggle('hidden', name !== 'title');
  $('#hud').classList.toggle('hidden', name !== 'game');
  if (name === 'game') setTimeout(() => view.setView('play', hudPads()), 0);
  else view.setView('title');
}
addEventListener('resize', () => { if (screen === 'game') view.setView('play', hudPads()); });

function startDemo() {
  newGame({ layout: (Math.random() * 4) | 0, mode: 'ai', level: 1, human: -1, demo: true });
}

function recordLine() {
  const r = Object.values(save.record).reduce((a, x) => ({ w: a.w + x.w, l: a.l + x.l }), { w: 0, l: 0 });
  $('#record').textContent = r.w + r.l ? `Your record: ${r.w} won · ${r.l} lost` : '';
}

// setup sheet
const cfg = { ...save.cfg };
function renderSetup() {
  document.querySelectorAll('#setup .seg').forEach((seg) => {
    const k = seg.dataset.key;
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', String(cfg[k]) === b.dataset.v));
  });
  $('#ai-opts').classList.toggle('hidden', cfg.mode !== 'ai');
}
document.querySelectorAll('#setup .seg').forEach((seg) => seg.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const k = seg.dataset.key;
  cfg[k] = k === 'mode' ? b.dataset.v : +b.dataset.v;
  sfx.tap(); renderSetup();
}));
function openSetup() { renderSetup(); $('#setup').classList.remove('hidden'); }
$('#btn-play').onclick = () => {
  sfx.unlock(); sfx.tap();
  try { globalThis.DeviceOrientationEvent?.requestPermission?.().catch(() => {}); } catch { /* only iOS asks */ }
  openSetup();
};
$('#setup-cancel').onclick = () => { sfx.tap(); $('#setup').classList.add('hidden'); };
$('#setup-go').onclick = () => {
  sfx.tap();
  save.cfg = { ...cfg }; persist();
  $('#setup').classList.add('hidden');
  show('game');
  newGame({ layout: cfg.layout, mode: cfg.mode, level: cfg.level, human: cfg.mode === 'ai' ? cfg.side : -1 });
};
$('#btn-howto').onclick = () => { sfx.tap(); $('#howto').classList.remove('hidden'); };
$('#howto-ok').onclick = () => { sfx.tap(); $('#howto').classList.add('hidden'); };
$('#btn-menu').onclick = () => { sfx.tap(); $('#pause').classList.remove('hidden'); };
$('#pause-resume').onclick = () => { sfx.tap(); $('#pause').classList.add('hidden'); };
$('#pause-new').onclick = () => { $('#pause').classList.add('hidden'); openSetup(); };
$('#pause-howto').onclick = () => { $('#pause').classList.add('hidden'); $('#howto').classList.remove('hidden'); };
$('#pause-quit').onclick = () => { $('#pause').classList.add('hidden'); goTitle(); };
$('#result-again').onclick = () => {
  sfx.tap(); $('#result').classList.add('hidden');
  newGame({ layout: G.layout, mode: G.mode, level: G.level, human: G.human });
};
$('#result-menu').onclick = () => { sfx.tap(); $('#result').classList.add('hidden'); goTitle(); };
function goTitle() { show('title'); recordLine(); startDemo(); }

// Android back button / browser back: close sheets, then leave the game
history.replaceState({ s: 'root' }, '');
history.pushState({ s: 'app' }, '');
addEventListener('popstate', () => {
  const open = [...document.querySelectorAll('.sheet:not(.hidden)')];
  if (open.length) open.forEach((s) => s.classList.add('hidden'));
  else if (screen === 'game') goTitle();
  history.pushState({ s: 'app' }, '');
});

goTitle();
if ('serviceWorker' in navigator && location.hostname !== 'localhost') navigator.serviceWorker.register('./sw.js').catch(() => {});
window.shardlight = { E, view, get G() { return G; }, newGame, play, AI }; // for testing in the console
