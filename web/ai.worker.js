// AI worker: its own copy of the Rust engine. The page sends the position; this sends a move back.
import { loadEngine } from './engine.js';

const ready = loadEngine();
let layoutLoaded = -1;

self.onmessage = async (e) => {
  const { id, layout, level, state, seed } = e.data;
  const E = await ready;
  if (layout !== layoutLoaded) { E.newGame(layout); layoutLoaded = layout; }
  E.setState(state);
  self.postMessage({ id, move: E.ai(level, seed) });
};
