// Bridge to the Rust core (shardlight.wasm). All rules and the AI live in Rust; this file only moves
// numbers across the boundary. See src/lib.rs for the exported functions.

export const EMPTY = 0, BEE = 1, WASP = 2;            // what hw_piece returns
export const LAYOUTS = ['Classic', 'Quick', 'Open', 'Flower'];
export const LEVELS = ['Easy', 'Medium', 'Hard', 'Expert', 'Very easy']; // 4 was added later, so saved records keep their numbers

export async function loadEngine(url = new URL('./shardlight.wasm', import.meta.url)) {
  const res = await fetch(url);
  const { instance } = res.headers.get('content-type')?.includes('wasm') && WebAssembly.instantiateStreaming
    ? await WebAssembly.instantiateStreaming(res, {})
    : await WebAssembly.instantiate(await res.arrayBuffer(), {});
  const x = instance.exports;
  const out = (n) => Array.from(new Int32Array(x.memory.buffer, x.hw_out(), Math.max(0, n)));

  return {
    /** New game on a layout; returns cell coordinates [{q, r}]. */
    newGame(layout = 0) {
      x.hw_new(layout);
      const v = out(x.hw_coords());
      const cells = [];
      for (let k = 0; k < v.length; k += 2) cells.push({ q: v[k], r: v[k + 1] });
      return cells;
    },
    piece(i) { return x.hw_piece(i); },
    /** 0 bees, 1 wasps */
    get turn() { return x.hw_turn(); },
    count(side) { return x.hw_count(side); },
    get movesMade() { return x.hw_moves_made(); },
    /** -1 playing, 0 bees won, 1 wasps won, 2 draw */
    get winner() { return x.hw_winner(); },
    targets(from) { return out(x.hw_targets(from)).map((v) => ({ to: v & 255, fly: !!(v >> 8) })); },
    /** Play a move; returns what happened, in order, for the animation (or null if illegal). */
    play(from, to) {
      const n = x.hw_play(from, to);
      if (n < 0) return null;
      const v = out(n);
      let k = 0;
      const move = { from: v[k++], to: v[k++], buzz: !!v[k++] };
      const flips = v.slice(k + 1, k + 1 + v[k]); k += 1 + v[k];
      const over = !!v[k++], winner = v[k++], filledBy = v[k++];
      const filled = v.slice(k + 1, k + 1 + v[k]);
      return { move, flips, over, winner, filledBy, filled };
    },
    undo() { return !!x.hw_undo(); },
    /** The position as 9 numbers, for the AI worker. */
    state() { return out(x.hw_state()); },
    setState(s) { x.hw_set_state(...s); },
    /** AI move for the side to move, or null. Runs synchronously: use the worker in the page. */
    ai(level, seed = (Math.random() * 1e9) | 0) { const v = x.hw_ai(level, seed); return v < 0 ? null : { from: v >> 8, to: v & 255 }; },
  };
}

/** The AI in a Web Worker, so animations never stutter while it thinks. Falls back to the page. */
export function createAi(engine) {
  let worker = null, seq = 0;
  const pending = new Map();
  try {
    worker = new Worker(new URL('./ai.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); p(e.data.move); } };
    worker.onerror = () => { worker = null; for (const p of pending.values()) p(undefined); pending.clear(); };
  } catch { worker = null; }
  return {
    /** Resolves to { from, to } or null. */
    think(layout, level) {
      const state = engine.state();
      if (!worker) return Promise.resolve(engine.ai(level));
      const id = ++seq;
      return new Promise((resolve) => {
        pending.set(id, (move) => resolve(move === undefined ? engine.ai(level) : move));
        worker.postMessage({ id, layout, level, state, seed: (Math.random() * 1e9) | 0 });
      });
    },
  };
}
