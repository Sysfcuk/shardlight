# Shardlight

**Shards against blobs on a stone board, deep in a crystal cavern.**

▶ **[Play on your phone](https://sysfcuk.github.io/shardlight/)**: open it in Chrome or Safari and use "Add to Home Screen" to install it.

Shardlight is a head-to-head hex strategy game for phones, in full 3D: an original take on the
classic clone-and-jump hex game, with its own look. The rules and the computer opponent are Rust
compiled to WebAssembly; the 3D world is Three.js (WebGL). It's built on the same engine as
[Hivewise](https://github.com/Sysfcuk/hivewise). There is no build step for the web side and
nothing to install beyond Rust.

## Play

```powershell
.\build.ps1          # tests, then the WASM build
python serve.py      # http://localhost:8140
```

On a phone on the same Wi-Fi, open `http://<your-pc's-ip>:8140`.

## Rules

- Shards and blobs take turns; shards go first. Tap one of your pieces, then a glowing cell.
- **Split** (green ring, next door): the piece splits and a copy grows there.
- **Leap** (violet ring, two cells away): it leaps there and leaves its old cell empty.
- Every enemy piece **touching the cell you land on** turns into one of yours.
- If the side to move can't move, the game ends and every empty cell goes to the other side.
  The game also ends when the board is full or one side is wiped out. **Most cells wins.**

Play the computer (Easy, Medium, Hard or Expert, as either side) or a friend on the same phone,
on four boards: Classic, Quick, Open and Flower. Undo is free, and Hint asks the AI for a good move.
Drag to turn and tilt the board, pinch to zoom out and see the cavern.

## The look

- **Two opposite sides:** the **Shards** are crystal clusters (a tall spire and shards bursting out
  at angles, every crystal a different gemstone colour, flat faceted and refractive on desktop);
  the **Blobs** are living green jelly.
- **Real jelly:** each blob is simulated with meshless shape matching (Müller, Heidelberger,
  Teschner & Gross, *Meshless Deformations Based on Shape Matching*, SIGGRAPH 2005): a dozen
  particles pulled toward the best-fitting rigid-plus-linear deformation of the rest shape, with
  volume preserved. Landings squash them, hops stretch them, strikes knock them sideways, and
  they wobble back. Linear shape matching gives one 3x3 transform per blob, which is exactly an
  instance matrix, so the deformation costs nothing to draw; a vertex shader adds fine ripples.
- **Takeover effects**, one picked at random for each capture:
  - lightning: a forking bolt with a flash of light;
  - shockwave: a ring of light, with pieces turning as it passes;
  - shatter: the old piece bursts into tumbling fragments;
  - goo splash: the blobs lob goo onto a shard, which sinks into it;
  - crystallise: crystal spikes erupt through a blob;
  - and the classic end-over-end tumble.
- **Board:** polished dark stone cells that glow violet (shards) or green (blobs) underneath whoever owns them.
- **The cavern:** a skylight's shaft of daylight on the board with drifting dust, glowing crystal
  clusters (with coloured lights) on the floor, walls and floating rocks, stalactites and
  stalagmites, and an underground lake. Glowing wisps drift about using boids flocking.
- **Post effects:** bloom for the glow, and a tilt-shift blur that keeps the board sharp. If frames
  run slow on a phone, the game drops the blur, softens the bloom and lowers the resolution.

## How it's built

| Part | What it does |
| --- | --- |
| `src/core.rs` | Rules, boards, and the alpha-beta AI (iterative deepening with a node budget per difficulty). |
| `src/lib.rs` | The WebAssembly interface: plain `extern "C"` functions, no wasm-bindgen. |
| `src/bin/selfplay.rs` | Pits the difficulty levels against each other. |
| `web/engine.js` | Loads `shardlight.wasm`; runs the AI in a Web Worker (`ai.worker.js`). |
| `web/scene.js` | Board, gems, camera (orbit, tilt, pinch zoom), animations, bloom and tilt-shift. |
| `web/models.js` | The shard cluster and the blob, and their materials (the blob's ripple shader). |
| `web/jelly.js` | The blobs' jelly physics (shape matching). |
| `web/fx.js` | The takeover effects. |
| `web/world.js` | The cavern: dome, spikes, crystals and their lights, floating rocks, lake, skylight shaft, dust. |
| `web/swarm.js` | The wisps (boids flocking). |
| `web/main.js` | Screens, turns, input, undo, hints, glassy chime sounds (a tiny synth, no audio files). |
