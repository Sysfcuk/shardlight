// Shardlight's soundtrack: a small generative score in Web Audio (no audio files) that follows
// the game.
//
// The music: D major with a Lydian lift (the G#-flavoured #11 on the IV chord), ~84 BPM, built
// from layers that fade in and out with the game's intensity:
//   pad      slow, breathing chords (always)
//   hook     a glass-bell motif, call and answer over four bars, then four bars of rest so it
//            keeps coming back without wearing out (understated, but it sticks)
//   arp      soft plucked eighths through the chord (in a game)
//   bass     a sub on the downbeat (in a game)
//   pulse    whisper-quiet kick, shaker and rim (as the board fills and the game gets close)
//   sparkle  pentatonic glints on captures
//
// What it listens to:
//   - screen: the title is just pad and hook; a game adds the rest
//   - intensity: rises as the board fills and when the score is close; captures add momentum
//   - whose turn: while the computer thinks, the mix muffles (a lowpass closes) and the hook
//     holds back; on your turn it opens up again
//   - who's ahead: winning plays the bright progression and a higher answer to the hook; losing
//     moves to the relative minor and the hook answers lower
//   - captures: a quantised sparkle run (longer for bigger captures) and a brief duck
//   - slow-motion takedowns: the music slurs down through a closing filter and a reverb swell
//   - the end of a game: a resolving cadence with the hook in full (or a minor one if you lost)

const BPM = 84;
const STEP = 60 / BPM / 4; // one sixteenth note
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

// four-bar progressions (one chord per bar), voiced around the middle of the piano
const BRIGHT = [
  { root: 50, notes: [50, 57, 61, 64, 66] }, // Dmaj9
  { root: 47, notes: [47, 54, 57, 61, 62] }, // Bm9
  { root: 43, notes: [43, 50, 54, 59, 61] }, // Gmaj7#11 (the Lydian shimmer)
  { root: 45, notes: [45, 52, 55, 59, 62] }, // A9sus4
];
const SHADOW = [
  { root: 47, notes: [47, 54, 57, 61, 62] }, // Bm9
  { root: 43, notes: [43, 50, 54, 59, 62] }, // Gmaj7
  { root: 42, notes: [42, 49, 54, 57, 61] }, // F#m7
  { root: 40, notes: [40, 47, 54, 55, 59] }, // Em9
];
// the hook: [beat, midi, beats]. Call (bars 1-2) and two answers (bars 3-4): one that rises
// (you're ahead) and one that falls (you're behind).
const CALL = [[0, 78, 0.5], [0.5, 81, 0.5], [1, 83, 1], [2, 81, 0.5], [2.5, 78, 0.5], [3, 76, 1], [4, 78, 0.5], [4.5, 76, 0.5], [5, 74, 2.5]];
const ANSWER_UP = [[8, 78, 0.5], [8.5, 81, 0.5], [9, 85, 1], [10, 83, 0.5], [10.5, 81, 0.5], [11, 78, 1.5], [12.5, 76, 0.5], [13, 74, 2.5]];
const ANSWER_DOWN = [[8, 78, 0.5], [8.5, 76, 0.5], [9, 74, 1], [10, 73, 0.5], [10.5, 71, 0.5], [11, 69, 1.5], [12.5, 71, 0.5], [13, 66, 2.5]];
const PENTA = [74, 76, 78, 81, 83, 86, 88, 90, 93, 95]; // D major pentatonic, high

export function createMusic(getAudio) {
  let A = null; // { ac, comp, verb }
  let out = null, lowpass = null, padBus = null, padFilter = null, delay = null, duckGain = null;
  let timer = 0, nextTime = 0, step = 0, running = false;
  let scene = 'title', intensity = 0.15, momentum = 0, adv = 0, fill = 0, waiting = false, cinematic = false, ending = null;
  let padVoices = [];

  function build() {
    A = getAudio();
    const { ac } = A;
    out = ac.createGain(); out.gain.value = 0;
    duckGain = ac.createGain(); duckGain.gain.value = 1;
    lowpass = ac.createBiquadFilter(); lowpass.type = 'lowpass'; lowpass.frequency.value = 7000; lowpass.Q.value = 0.6;
    lowpass.connect(duckGain).connect(out).connect(A.comp);
    const send = ac.createGain(); send.gain.value = 0.55; out.connect(send).connect(A.verb); // lots of space
    // the pads share one gently breathing filter
    padBus = ac.createGain(); padBus.gain.value = 0.9;
    padFilter = ac.createBiquadFilter(); padFilter.type = 'lowpass'; padFilter.frequency.value = 1100; padFilter.Q.value = 0.4;
    const lfo = ac.createOscillator(), lfoGain = ac.createGain(); lfo.frequency.value = 0.05; lfoGain.gain.value = 450;
    lfo.connect(lfoGain).connect(padFilter.frequency); lfo.start();
    padBus.connect(padFilter).connect(lowpass);
    // the hook rings through a dotted-eighth echo
    delay = ac.createDelay(2); delay.delayTime.value = STEP * 3;
    const fb = ac.createGain(); fb.gain.value = 0.32;
    const dl = ac.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2600;
    delay.connect(dl).connect(fb).connect(delay);
    dl.connect(lowpass);
  }

  // ---------------------------------------------------------------- instruments
  function voice(type, freq, t, dur, vol, dest, { attack = 0.01, release = 0.3, detune = 0 } = {}) {
    const { ac } = A;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = freq; o.detune.value = detune;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + Math.max(attack, dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + release + 0.05);
  }
  /** A glass bell: a sine with a quieter inharmonic partial, long decay. */
  function bell(m, t, beats, vol) {
    const f = midi(m), d = beats * STEP * 4;
    voice('sine', f, t, d * 0.6, vol, lowpass, { attack: 0.006, release: d * 0.9 + 0.8 });
    voice('sine', f * 2.756, t, 0.12, vol * 0.22, lowpass, { attack: 0.004, release: 0.6 });
    voice('sine', f, t, d * 0.5, vol * 0.5, delay, { attack: 0.006, release: d + 0.4 });
  }
  function pad(chord, t, bars) {
    const dur = bars * 16 * STEP;
    for (const m of chord.notes) {
      for (const det of [-7, 6]) voice('sawtooth', midi(m), t, dur, 0.016, padBus, { attack: 1.6, release: 2.2, detune: det });
      voice('sine', midi(m + 12), t, dur, 0.008, padBus, { attack: 2, release: 2.5 });
    }
  }
  function pluck(m, t, vol) { voice('triangle', midi(m), t, 0.05, vol, lowpass, { attack: 0.004, release: 0.45 }); }
  function bass(m, t, beats, vol) { voice('sine', midi(m), t, beats * STEP * 4 * 0.8, vol, lowpass, { attack: 0.03, release: 0.4 }); voice('triangle', midi(m + 12), t, 0.1, vol * 0.25, lowpass, { attack: 0.01, release: 0.25 }); }
  function kick(t, vol) {
    const { ac } = A, o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(lowpass); o.start(t); o.stop(t + 0.4);
  }
  let noiseBuf = null;
  function hiss(t, dur, vol, freq) {
    const { ac } = A;
    if (!noiseBuf) { noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; f.type = 'highpass'; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(lowpass); s.start(t, Math.random() * 0.4); s.stop(t + dur + 0.02);
  }

  // ---------------------------------------------------------------- the score
  const prog = () => (adv < -0.12 ? SHADOW : BRIGHT);
  function scheduleStep(s, t) {
    const bar = Math.floor(s / 16), inBar = s % 16, beat = inBar / 4;
    const p = prog(), chord = p[bar % 4];
    const game = scene === 'game';
    const level = Math.min(1, intensity + momentum);
    // pads: a new chord every bar
    if (inBar === 0) pad(chord, t, 1);
    // hook: bars 1-4 of every 8 (call + answer), quieter while the computer is thinking
    const cycle = bar % 8;
    if (cycle < 4 && !ending) {
      const phrase = cycle < 2 ? CALL : (adv >= -0.12 ? ANSWER_UP : ANSWER_DOWN);
      const beatInPhrase = (cycle % 4) * 4 + beat;
      for (const [b, m, len] of phrase) if (Math.abs(b - beatInPhrase) < 1e-6) bell(p === SHADOW ? m - 3 : m, t, len, waiting ? 0.025 : 0.05);
    }
    if (!game) return;
    // arp: soft eighths up and down the chord, more of them as the game heats up
    if (inBar % 2 === 0 && level > 0.2) {
      const tones = [...chord.notes.slice(1), ...chord.notes.slice(1).map((n) => n + 12)];
      const k = inBar / 2, idx = k < 4 ? k : 7 - k;
      if (level > 0.45 || k % 2 === 0) pluck(tones[idx % tones.length] + 12, t, 0.018 + level * 0.02);
    }
    // bass on the downbeat (and beat 3 once it's busy)
    if (inBar === 0) bass(chord.root - 12, t, 2, 0.09);
    if (inBar === 8 && level > 0.5) bass(chord.root - 12 + (bar % 2 ? 7 : 0), t, 1.5, 0.06);
    // pulse: kick, shaker, rim, fading in with intensity
    if (level > 0.5 && (inBar === 0 || inBar === 8)) kick(t, 0.12 * (level - 0.3));
    if (level > 0.38 && inBar % 2 === 1) hiss(t, 0.05, 0.012 + Math.random() * 0.01 * level, 7000);
    if (level > 0.72 && (inBar === 4 || inBar === 12)) hiss(t, 0.08, 0.03, 2500);
  }

  function tick() {
    if (!running) return;
    const now = A.ac.currentTime;
    while (nextTime < now + 0.15) { scheduleStep(step, nextTime); step++; nextTime += STEP; }
    momentum = Math.max(0, momentum - 0.002);
  }

  // smooth parameter changes, a little ahead of time
  const ramp = (param, v, secs = 0.8) => { const t = A.ac.currentTime; param.cancelScheduledValues(t); param.setValueAtTime(param.value, t); param.linearRampToValueAtTime(v, t + secs); };
  function applyFilter() {
    if (!A) return;
    const f = cinematic ? 700 : waiting ? 2300 : scene === 'title' ? 5200 : 7500;
    ramp(lowpass.frequency, f, cinematic ? 0.4 : 1.2);
  }
  /** Quantise to the next sixteenth (so stingers land in time with the music). */
  const nextGrid = () => { const t = A.ac.currentTime + 0.03; return nextTime - Math.floor((nextTime - t) / STEP) * STEP; };

  return {
    /** Start (or resume) playing. Safe to call repeatedly. */
    start() {
      if (running) return;
      if (!A) build();
      running = true;
      nextTime = A.ac.currentTime + 0.1; step = 0;
      ramp(out.gain, 0.75, 3);
      timer = setInterval(tick, 25);
      applyFilter();
    },
    stop() {
      if (!running) return;
      running = false; clearInterval(timer);
      ramp(out.gain, 0, 0.8);
    },
    get playing() { return running; },
    setScene(name) { scene = name; ending = null; if (name === 'title') intensity = 0.15; applyFilter(); },
    /**
     * The state of play: adv = your share minus theirs (-1..1, 0 for two players), fill = how
     * much of the board is taken (0..1), waiting = the computer is thinking.
     */
    setState({ adv: a = 0, fill: f = 0, waiting: w = false }) {
      adv = a; fill = f;
      const close = 1 - Math.min(1, Math.abs(a) * 2);
      intensity = 0.28 + f * 0.45 + close * f * 0.2;
      if (w !== waiting) { waiting = w; applyFilter(); }
    },
    /** A capture: a quantised pentatonic run, longer for bigger captures, and a lift in momentum. */
    capture(n, mine = true) {
      if (!running) return;
      momentum = Math.min(0.35, momentum + n * 0.04);
      let t = nextGrid();
      const start = (Math.random() * 3) | 0, len = Math.min(8, 2 + n);
      for (let k = 0; k < len; k++) { bell(PENTA[Math.min(PENTA.length - 1, start + (mine ? k : len - 1 - k))], t, 0.25, 0.028); t += STEP; }
      // make room for the effect's own sound
      const now = A.ac.currentTime;
      duckGain.gain.cancelScheduledValues(now); duckGain.gain.setValueAtTime(0.55, now); duckGain.gain.linearRampToValueAtTime(1, now + 0.6);
    },
    /** Slow-motion takedown: slur down through a closing filter, then open back up. */
    cinematic(on) {
      if (!running) return;
      cinematic = on; applyFilter();
      if (on) { const t = A.ac.currentTime; for (const m of [62, 66, 69, 74]) voice('sine', midi(m), t, 1.4, 0.03, lowpass, { attack: 0.3, release: 1.6, detune: -30 }); }
    },
    /** End of a game: a cadence. result: 'win' | 'lose' | 'draw'. */
    end(result) {
      if (!running) return;
      ending = result;
      const t = nextGrid() + STEP * 2;
      const chord = result === 'lose' ? [47, 54, 59, 62, 66] : [50, 57, 62, 66, 69, 74];
      for (const m of chord) voice('sine', midi(m), t, 2.4, 0.03, lowpass, { attack: 0.08, release: 2.2 });
      const line = result === 'lose' ? [[0, 78], [0.5, 76], [1, 74], [2, 71]] : [[0, 78], [0.5, 81], [1, 83], [1.5, 85], [2, 86]];
      for (const [b, m] of line) bell(m, t + b * STEP * 4, 1, 0.05);
      setTimeout(() => { ending = null; }, 6000);
    },
  };
}
