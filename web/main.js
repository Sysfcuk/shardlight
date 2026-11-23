// Shardlight: screens, turns, input and sound. Rules and the AI are Rust (engine.js); the 3D world
// and its animations are scene.js.
//
// Polish notes (what each piece of feedback is for):
//  - capture previews: before you commit, every target shows what it would win ("+3"), the best in
//    gold, so the board explains itself (the clarity of tactics games like Into the Breach)
//  - combo callouts, hit-stop, shake and haptics scale with the size of a capture, so big plays
//    feel big and small ones stay quiet
//  - numbers count rather than jump; a territory bar shows who's ahead at a glance
//  - nothing pops: screens rise in, sheets slide away, the camera dollies between views
//  - sound sits in a space: a cave reverb on every chime and a low ambient drone underneath
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

// ---------------------------------------------------------------- sound (a tiny synth, no files)
// Everything goes through one bus: a compressor (so stacked chimes never clip), with a send to a
// cave reverb built from decaying noise. A soft two-oscillator drone breathes underneath.
const sfx = (() => {
  let ac = null, bus = null, verb = null, drone = null;
  function ctx() {
    if (ac) return ac;
    ac = new (window.AudioContext || window.webkitAudioContext)();
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4;
    comp.connect(ac.destination);
    bus = ac.createGain(); bus.gain.value = 0.9; bus.connect(comp);
    // reverb: 2.6 s of stereo noise with an exponential tail
    const len = Math.floor(ac.sampleRate * 2.6), ir = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    const conv = ac.createConvolver(); conv.buffer = ir;
    verb = ac.createGain(); verb.gain.value = 0.32;
    verb.connect(conv).connect(comp);
    return ac;
  }
  const out = (node, wet = 1) => { node.connect(bus); if (wet) { const s = ac.createGain(); s.gain.value = wet; node.connect(s).connect(verb); } };
  function tone(freq, dur, { type = 'sine', vol = 0.16, slide = 0, delay = 0, vib = 0, wet = 1 } = {}) {
    if (!save.sound) return;
    const a = ctx(), t = a.currentTime + delay;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    if (vib) { const l = a.createOscillator(), lg = a.createGain(); l.frequency.value = vib; lg.gain.value = freq * 0.06; l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + dur); }
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); out(g, wet); o.start(t); o.stop(t + dur + 0.02);
  }
  // filtered white noise: crackles, thumps and tinkles
  function noise(dur, freq, vol, { wet = 0.6, q = 0.8 } = {}) {
    if (!save.sound) return;
    const a = ctx(), t = a.currentTime, len = Math.ceil(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (Math.random() < 0.3 ? 1 : 0.3);
    const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    src.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g); out(g, wet); src.start(t);
  }
  const SCALE = [523, 587, 659, 784, 880, 1047, 1175, 1319, 1568, 1760];
  const detune = () => 1 + (Math.random() - 0.5) * 0.012; // a hair of variation, so repeats never sound copy-pasted
  // a glassy bell: a pure tone plus a quieter inharmonic overtone, with a long fade
  const chime = (f, delay = 0, vol = 0.1) => { f *= detune(); tone(f, 1.0, { vol, delay }); tone(f * 2.76, 0.55, { vol: vol * 0.3, delay }); tone(f * 5.4, 0.25, { vol: vol * 0.12, delay }); };
  function startDrone() {
    if (drone || !save.sound) return;
    const a = ctx(), g = a.createGain(); g.gain.value = 0;
    const o1 = a.createOscillator(), o2 = a.createOscillator(), lfo = a.createOscillator(), lg = a.createGain(), f = a.createBiquadFilter();
    o1.type = 'sine'; o1.frequency.value = 55; o2.type = 'triangle'; o2.frequency.value = 82.6;
    f.type = 'lowpass'; f.frequency.value = 320; lfo.frequency.value = 0.07; lg.gain.value = 140;
    lfo.connect(lg).connect(f.frequency);
    o1.connect(f); o2.connect(f); f.connect(g); out(g, 0.8);
    [o1, o2, lfo].forEach((o) => o.start());
    g.gain.linearRampToValueAtTime(0.045, a.currentTime + 3);
    drone = { g, stop() { g.gain.linearRampToValueAtTime(0, a.currentTime + 0.6); setTimeout(() => [o1, o2, lfo].forEach((o) => o.stop()), 700); } };
  }
  return {
    unlock() { if (!save.sound) return; ctx().resume?.(); startDrone(); },
    mute(on) { if (on) { drone?.stop(); drone = null; } else { this.unlock(); } },
    tap() { chime(1320, 0, 0.045); },
    select() { chime(988, 0, 0.06); tone(1976, 0.08, { vol: 0.03, wet: 0.3 }); },
    nope() { tone(150, 0.12, { type: 'square', vol: 0.03, wet: 0.2 }); },
    fly(side, split) { tone(side ? 520 : 440, split ? 0.3 : 0.45, { type: 'triangle', vol: 0.045, slide: split ? 300 : 500, wet: 0.5 }); noise(split ? 0.25 : 0.4, 1800, 0.025); },
    land() { chime(880, 0, 0.08); tone(120, 0.18, { vol: 0.13, slide: -50, wet: 0.3 }); noise(0.12, 300, 0.05, { wet: 0.3 }); },
    flip(side, k) { chime(SCALE[Math.min(k + 2, 9)] * (side ? 1.5 : 1), 0, 0.075); },
    fill(k) { chime(1047 + (k % 8) * 90, 0, 0.028); },
    effect(name) {
      if (name === 'zap') { noise(0.28, 2600, 0.17, { q: 0.6 }); tone(80, 0.3, { type: 'sawtooth', vol: 0.05, slide: -35, wet: 0.4 }); }
      else if (name === 'shatter') { noise(0.2, 5200, 0.1); [1568, 2093, 2637, 3136].forEach((f, k) => tone(f * detune(), 0.3, { vol: 0.028, delay: k * 0.025 })); }
      else if (name === 'splash') { tone(220, 0.24, { vol: 0.12, slide: -130 }); tone(330, 0.14, { vol: 0.06, slide: 220, delay: 0.05 }); noise(0.18, 700, 0.05); }
      else if (name === 'crystal') { [1319, 1760, 2349, 2794].forEach((f, k) => chime(f, k * 0.035, 0.045)); }
      else if (name === 'shockwave') { tone(62, 0.7, { vol: 0.16, slide: -25, wet: 0.5 }); noise(0.5, 500, 0.06); }
      else if (name === 'laser') { tone(1800, 0.22, { type: 'sawtooth', vol: 0.035, slide: -1400, wet: 0.5 }); tone(900, 0.18, { type: 'square', vol: 0.02, slide: -600 }); }
      else if (name === 'whoosh') { noise(0.42, 900, 0.07, { q: 0.4 }); tone(400, 0.42, { type: 'triangle', vol: 0.025, slide: -320 }); }
      else if (name === 'impact') { tone(55, 0.5, { vol: 0.2, slide: -20, wet: 0.6 }); noise(0.3, 260, 0.12, { wet: 0.5 }); }
      else if (name === 'freeze') { [2637, 3136, 3520].forEach((f, k) => tone(f * detune(), 0.4, { vol: 0.03, delay: k * 0.05 })); noise(0.35, 7000, 0.04); }
      else if (name === 'implode') { tone(900, 0.3, { vol: 0.07, slide: -820 }); tone(60, 0.35, { vol: 0.12, delay: 0.28, wet: 0.6 }); }
      else if (name === 'vortex') { tone(180, 0.5, { type: 'triangle', vol: 0.05, slide: 700, vib: 12 }); noise(0.5, 1400, 0.04); }
      else if (name === 'launch') { noise(0.45, 3000, 0.05, { q: 0.5 }); tone(300, 0.45, { type: 'triangle', vol: 0.03, slide: 900 }); }
      else if (name === 'pop') { noise(0.25, 2200, 0.12); [1568, 1976, 2349].forEach((f, k) => chime(f, 0.02 + k * 0.03, 0.04)); }
      else if (name === 'levitate') { tone(220, 0.7, { type: 'sine', vol: 0.06, slide: 440, vib: 6 }); }
      else if (name === 'prism') { [1047, 1319, 1568, 2093, 2637].forEach((f, k) => chime(f, k * 0.04, 0.045)); }
    },
    combo(n) { // a rising arpeggio for big captures
      const steps = Math.min(5, n - 1);
      for (let k = 0; k < steps; k++) chime(SCALE[4 + k], 0.12 + k * 0.06, 0.05);
    },
    win() { [0, 2, 4, 7, 9].forEach((n, k) => chime(SCALE[n], k * 0.12, 0.1)); tone(131, 1.6, { vol: 0.08, delay: 0.5 }); },
    lose() { tone(330, 0.4, { type: 'triangle', vol: 0.09, slide: -100 }); tone(247, 0.6, { type: 'triangle', vol: 0.09, slide: -80, delay: 0.24 }); },
    count(k) { chime(1568 + k * 40, 0, 0.022); },
  };
})();
const vibrate = (p) => {
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try { navigator.vibrate?.(p); } catch { /* not supported */ }
};

// ---------------------------------------------------------------- boot
const E = await loadEngine();
const E2 = await loadEngine(); // a scratch copy of the rules, for previewing moves
const AI = createAi(E);
const view = createScene($('#view'), { mobile: MOBILE });
// the badge portraits are the real 3D pieces, rendered once
try { const pics = view.portraits(); $('#ava-bee').src = pics.shards; $('#ava-wasp').src = pics.blobs; } catch { /* no WebGL for a second canvas: the ring still shows */ }
// slow-motion takedowns get cinematic letterbox bars
view.onCinematic((on) => $('#bars').classList.toggle('on', on && screen === 'game'));
// counts on the badges change when the piece lands, not when the move starts
view.onLand(() => { if (G) G.target = [E.count(0), E.count(1)]; updateHud(); });

// ---------------------------------------------------------------- game state
let G = null; // { layout, mode, level, human, demo, busy, selected, targets, token, stats }
let screen = 'title';

const pieces = () => Array.from({ length: G.n }, (_, i) => E.piece(i));
const isHuman = (side) => G.mode === 'local' || side === G.human;
const SIDE_NAME = ['Shards', 'Blobs'];

function newGame({ layout, mode, level, human, demo = false }) {
  const cells = E.newGame(layout);
  E2.newGame(layout);
  G = { layout, mode, level, human, demo, n: cells.length, busy: false, selected: -1, targets: [], token: (G?.token || 0) + 1, hint: null,
    stats: { caps: [0, 0], best: [0, 0], moves: [0, 0] }, target: [E.count(0), E.count(1)] };
  view.setBoard(cells, pieces());
  view.resetView(true);
  view.setThinking(-1);
  view.setHint(null);
  clearBadges();
  shown[0] = lastTarget[0] = E.count(0); shown[1] = lastTarget[1] = E.count(1);
  updateHud();
  nextTurn();
}

// ---------------------------------------------------------------- HUD: counters that count, a territory bar, a living status line
const shown = [3, 3]; // the numbers currently displayed (they chase the real counts)
function updateHud() {
  if (!G) return;
  const turn = E.turn;
  $('#pill-bee').classList.toggle('on', E.winner < 0 && turn === 0);
  $('#pill-wasp').classList.toggle('on', E.winner < 0 && turn === 1);
  // names and roles: "You / Shards" against "Blobs / Medium AI", or "Shards / Player 1"
  for (const side of [0, 1]) {
    const key = side ? 'wasp' : 'bee', human = G.mode === 'local' || G.human === side;
    $(`#name-${key}`).textContent = G.mode === 'ai' && human ? 'You' : SIDE_NAME[side];
    $(`#sub-${key}`).textContent = G.mode === 'local' ? `Player ${side + 1}` : human ? SIDE_NAME[side] : `${LEVELS[G.level]} AI`;
    $(`#pill-${key}`).classList.toggle('think', E.winner < 0 && E.turn === side && !G.demo && !human && G.busy === false);
  }
  // the ring round each portrait (and the bar below) show each side's share of the board
  const [a, b] = G.target || [E.count(0), E.count(1)], tot = Math.max(1, a + b);
  $('#pill-bee').style.setProperty('--p', ((a / tot) * 100).toFixed(1));
  $('#pill-wasp').style.setProperty('--p', ((b / tot) * 100).toFixed(1));
  $('#tug .a').style.width = `${(a / tot) * 100}%`;
  $('#tug .b').style.width = `${(b / tot) * 100}%`;
  let status = '';
  if (E.winner >= 0) status = '';
  else if (G.mode === 'local') status = `${SIDE_NAME[turn]} to move`;
  else status = isHuman(turn) ? 'Your move' : `${SIDE_NAME[turn]} are thinking<span class="dots"><i>.</i><i>.</i><i>.</i></span>`;
  const st = $('#status');
  if (st.dataset.s !== status) {
    st.dataset.s = status; st.innerHTML = status;
    st.classList.remove('swap'); void st.offsetWidth; st.classList.add('swap');
  }
  st.style.opacity = status ? 1 : 0;
  $('#btn-undo').disabled = G.busy || E.movesMade === 0 || (G.mode === 'ai' && E.movesMade < (G.human === 0 ? 1 : 2));
  $('#btn-hint').disabled = G.busy || E.winner >= 0 || !isHuman(turn);
}
const lastTarget = [3, 3];
function tickCounters() {
  if (G) for (const side of [0, 1]) {
    const real = (G.target || [E.count(0), E.count(1)])[side], el = side ? $('#n-wasp') : $('#n-bee');
    // a floating "+3" / "−2" each time a side's count changes
    if (real !== lastTarget[side]) {
      const d = real - lastTarget[side], dl = side ? $('#d-wasp') : $('#d-bee');
      lastTarget[side] = real;
      if (Math.abs(d) < 40 && !G.demo) { dl.textContent = d > 0 ? `+${d}` : `−${-d}`; dl.className = 'delta ' + (d > 0 ? 'up' : 'down'); void dl.offsetWidth; }
    }
    if (shown[side] !== real) {
      shown[side] += Math.sign(real - shown[side]);
      el.textContent = shown[side];
      el.classList.add('bump'); setTimeout(() => el.classList.remove('bump'), 120);
    }
  }
}
setInterval(tickCounters, 70);

// ---------------------------------------------------------------- capture previews (badges over targets)
let badges = [];
function clearBadges() { for (const b of badges) b.el.remove(); badges = []; }
function showBadges(from, targets) {
  clearBadges();
  const st = E.state();
  const gains = targets.map((t) => { E2.setState(st); const r = E2.play(from, t.to); return r ? r.flips.length + (t.fly ? 0 : 1) : 0; });
  const best = Math.max(...gains);
  targets.forEach((t, k) => {
    if (gains[k] <= 0) return; // a leap that wins nothing: no badge, less clutter
    const el = document.createElement('div');
    el.className = 'badge' + (gains[k] === best && best > 1 ? ' best' : '');
    el.textContent = `+${gains[k]}`;
    el.style.opacity = 0;
    $('#badges').appendChild(el);
    badges.push({ el, cell: t.to, at: performance.now() + 60 + k * 25 + (t.fly ? 80 : 0) });
  });
}
function placeBadges() {
  const now = performance.now();
  for (const b of badges) {
    const [x, y] = view.screenOf(b.cell);
    const u = Math.min(1, Math.max(0, (now - b.at) / 220));
    const pop = u < 1 ? Math.sin(u * Math.PI * 0.5) * (1 + 0.3 * Math.sin(u * Math.PI)) : 1;
    b.el.style.opacity = u > 0 ? 1 : 0;
    b.el.style.transform = `translate(${x}px, ${y - 22}px) translate(-50%, -100%) scale(${pop})`;
  }
  requestAnimationFrame(placeBadges);
}
requestAnimationFrame(placeBadges);

// ---------------------------------------------------------------- combo callouts
const WORDS = [[9, 'Shardstorm!', 'Gloopocalypse!'], [7, 'Brilliant!', 'Brilliant!'], [5, 'Great!', 'Great!'], [3, 'Nice!', 'Nice!']];
view.onCapture(({ count, cell, side }) => {
  if (!G || G.demo) return;
  G.stats.caps[side] += count;
  G.stats.best[side] = Math.max(G.stats.best[side], count);
  vibrate(count >= 5 ? [18, 40, 28] : count >= 3 ? [14, 30, 14] : 10);
  if (count < 2) return;
  sfx.combo(count);
  const [x, y] = view.screenOf(cell);
  const word = WORDS.find(([n]) => count >= n);
  const el = document.createElement('div');
  el.className = 'callout' + (count >= 7 ? ' huge' : count >= 5 ? ' big' : '');
  el.style.left = `${x}px`; el.style.top = `${y - 30}px`;
  el.style.color = side === 0 ? '#e7c9ff' : '#b6ffc8';
  el.innerHTML = `<b>+${count}</b>${word ? `<span>${word[side + 1]}</span>` : ''}`;
  $('#callouts').appendChild(el);
  setTimeout(() => el.remove(), 1400);
});

// ---------------------------------------------------------------- turns
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
  G.stats.moves[side]++;
  view.clearSelect(); view.setHint(null); clearBadges();
  view.speed = 1;
  updateHud();
  if (!G.demo) vibrate(8);
  await view.playMove(res, side, G.demo ? {} : sfx);
  if (!G || token !== G.token) return;
  view.speed = 1;
  G.busy = false;
  G.target = [E.count(0), E.count(1)];
  updateHud();
  nextTurn();
}

function gameOver() {
  const w = E.winner;
  const [b, wa] = [E.count(0), E.count(1)];
  view.setThinking(-1);
  view.celebrate(w === 2 ? 0 : w);
  if (G.demo) { setTimeout(() => { if (G?.demo) startDemo(); }, 3500); return; }
  let title, text, me = G.mode === 'ai' ? G.human : (w === 2 ? 0 : w);
  if (G.mode === 'local') { title = w === 2 ? 'A draw!' : `${SIDE_NAME[w]} win!`; text = w === 2 ? 'Perfectly balanced.' : `${SIDE_NAME[w]} hold ${Math.max(b, wa)} of ${b + wa} cells.`; sfx.win(); }
  else {
    const rec = (save.record[G.level] ||= { w: 0, l: 0, d: 0 });
    if (w === 2) { title = 'A draw!'; rec.d++; sfx.win(); }
    else if (w === G.human) { title = 'Victory!'; rec.w++; sfx.win(); vibrate([20, 40, 20, 40, 60]); }
    else { title = `The ${SIDE_NAME[w].toLowerCase()} win`; rec.l++; sfx.lose(); }
    persist();
    text = `${LEVELS[G.level]} · ${LAYOUTS[G.layout]} board · your record here: ${rec.w}–${rec.l}${rec.d ? '–' + rec.d : ''}`;
  }
  $('#result-title').textContent = title;
  $('#winner-icon').setAttribute('href', w === 1 ? '#i-wasp' : '#i-bee');
  $('#result-text').textContent = text;
  $('#st-caps-l').textContent = G.mode === 'ai' ? 'You captured' : 'Captures';
  const stats = G.mode === 'ai' ? [G.stats.caps[me], G.stats.best[me], G.stats.moves[me]] : [G.stats.caps[0] + G.stats.caps[1], Math.max(...G.stats.best), G.stats.moves[0] + G.stats.moves[1]];
  ['#st-caps', '#st-best', '#st-moves'].forEach((id, k) => { $(id).textContent = stats[k]; });
  setTimeout(() => {
    openSheet('result');
    // the scores count up; the stat cards rise in one after another
    countUp($('#r-bee'), b, 0); countUp($('#r-wasp'), wa, 1);
    document.querySelectorAll('#result .stat').forEach((s, k) => { s.classList.remove('in'); setTimeout(() => s.classList.add('in'), 500 + k * 110); });
  }, 1400);
}
function countUp(el, to, side) {
  let v = 0; el.textContent = 0;
  const step = Math.max(1, Math.ceil(to / 24));
  const id = setInterval(() => {
    v = Math.min(to, v + step); el.textContent = v;
    if (side === 0 && v % 3 === 0) sfx.count(v % 12);
    if (v >= to) clearInterval(id);
  }, 35);
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
  showBadges(i, G.targets);
  if (G.hint && G.hint.from !== i) { G.hint = null; view.setHint(null); }
  sfx.select(); vibrate(6);
  if (!G.targets.length) { sfx.nope(); toast('That piece is boxed in'); }
}
function deselect() { clearBadges(); if (G.selected >= 0) { G.selected = -1; G.targets = []; view.clearSelect(); } }

let toastTimer = 0;
function toast(msg, ms = 1500) {
  const t = $('#toast'); t.textContent = msg; t.style.opacity = 1;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.style.opacity = 0), ms);
}

// ---------------------------------------------------------------- sheets: they slide in, and slide away
function openSheet(id) { const s = $('#' + id); s.classList.remove('hidden', 'closing'); }
function closeSheet(id, then) {
  const s = $('#' + id);
  if (s.classList.contains('hidden')) { then?.(); return; }
  s.classList.add('closing');
  setTimeout(() => { s.classList.add('hidden'); s.classList.remove('closing'); then?.(); }, 260);
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
  G.target = [E.count(0), E.count(1)];
  closeSheet('result');
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
$('#btn-sound').onclick = () => { save.sound = !save.sound; persist(); syncSound(); sfx.mute(!save.sound); sfx.tap(); };
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
  const title = $('#title'), hud = $('#hud');
  if (name === 'title') {
    hud.classList.add('off');
    setTimeout(() => { if (screen === 'title') hud.classList.add('hidden'); }, 500);
    title.classList.remove('hidden'); title.classList.remove('shown'); void title.offsetWidth; title.classList.add('shown');
    view.setView('title');
  } else {
    title.classList.add('hidden'); title.classList.remove('shown');
    hud.classList.remove('hidden');
    requestAnimationFrame(() => { hud.classList.remove('off'); view.setView('play', hudPads()); });
  }
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
  sfx.tap(); vibrate(5); renderSetup();
}));
function openSetup() { renderSetup(); openSheet('setup'); }
$('#btn-play').onclick = () => {
  sfx.unlock(); sfx.tap();
  try { globalThis.DeviceOrientationEvent?.requestPermission?.().catch(() => {}); } catch { /* only iOS asks */ }
  openSetup();
};
$('#setup-cancel').onclick = () => { sfx.tap(); closeSheet('setup'); };
$('#setup-go').onclick = () => {
  sfx.unlock(); sfx.select();
  save.cfg = { ...cfg }; persist();
  closeSheet('setup', () => {
    show('game');
    newGame({ layout: cfg.layout, mode: cfg.mode, level: cfg.level, human: cfg.mode === 'ai' ? cfg.side : -1 });
  });
};
$('#btn-howto').onclick = () => { sfx.unlock(); sfx.tap(); openSheet('howto'); };
$('#howto-ok').onclick = () => { sfx.tap(); closeSheet('howto'); };
$('#btn-menu').onclick = () => { sfx.tap(); openSheet('pause'); };
$('#pause-resume').onclick = () => { sfx.tap(); closeSheet('pause'); };
$('#pause-new').onclick = () => { sfx.tap(); closeSheet('pause', openSetup); };
$('#pause-howto').onclick = () => { sfx.tap(); closeSheet('pause', () => openSheet('howto')); };
$('#pause-quit').onclick = () => { sfx.tap(); closeSheet('pause', goTitle); };
$('#result-again').onclick = () => {
  sfx.select();
  closeSheet('result', () => newGame({ layout: G.layout, mode: G.mode, level: G.level, human: G.human }));
};
$('#result-menu').onclick = () => { sfx.tap(); closeSheet('result', goTitle); };
function goTitle() { clearBadges(); show('title'); recordLine(); startDemo(); }

// Android back button / browser back: close sheets, then leave the game
history.replaceState({ s: 'root' }, '');
history.pushState({ s: 'app' }, '');
addEventListener('popstate', () => {
  const open = [...document.querySelectorAll('.sheet:not(.hidden)')];
  if (open.length) open.forEach((s) => closeSheet(s.id));
  else if (screen === 'game') goTitle();
  history.pushState({ s: 'app' }, '');
});

// boot: build the title scene, compile every shader out of sight, then lift the curtain
goTitle();
await view.prewarm();
requestAnimationFrame(() => {
  $('#boot').classList.add('done');
  // replay the title's entrance now that it can be seen
  const t = $('#title'); t.classList.remove('shown'); void t.offsetWidth; t.classList.add('shown');
});
if ('serviceWorker' in navigator && location.hostname !== 'localhost') navigator.serviceWorker.register('./sw.js').catch(() => {});
window.shardlight = { E, view, get G() { return G; }, newGame, play, AI }; // for testing in the console
