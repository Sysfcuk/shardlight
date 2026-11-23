# Shardlight

**Rubies against sapphires on a stone board, deep in a crystal cavern.**

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

- Rubies and sapphires take turns; rubies go first. Tap one of your gems, then a glowing cell.
- **Split** (green ring, next door): the gem splits and a copy grows there.
- **Leap** (violet ring, two cells away): it leaps there and leaves its old cell empty.
- Every enemy gem **touching the cell you land on** changes to your colour.
- If the side to move can't move, the game ends and every empty cell goes to the other side.
  The game also ends when the board is full or one side is wiped out. **Most cells wins.**

Play the computer (Easy, Medium, Hard or Expert, as either colour) or a friend on the same phone,
on four boards: Classic, Quick, Open and Flower. Undo is free, and Hint asks the AI for a good move.
Drag to turn and tilt the board, pinch to zoom out and see the cavern.

## The look

- **Gems:** an eight-facet brilliant cut, flat shaded so every facet catches light. On desktop
  they're real refractive crystal (transmission, index of refraction 1.77, a little dispersion for
  fire); on phones, a cheaper glossy glowing stone that reads the same at a glance.
- **Captures:** a captured gem tumbles end over end and changes colour half way round.
- **Board:** polished dark stone cells that glow ruby or sapphire underneath whoever owns them.
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
| `web/models.js` | The gem cut and its materials. |
| `web/world.js` | The cavern: dome, spikes, crystals and their lights, floating rocks, lake, skylight shaft, dust. |
| `web/swarm.js` | The wisps (boids flocking). |
| `web/main.js` | Screens, turns, input, undo, hints, glassy chime sounds (a tiny synth, no audio files). |
