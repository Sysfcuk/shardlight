//! WebAssembly surface for Shardlight. No wasm-bindgen: plain exported functions and one i32
//! output buffer. See web/engine.js. The page and the AI worker each load their own instance.

pub mod core;

use crate::core::{bit, Game, Layout, Move, State};
use std::cell::RefCell;

thread_local! {
    static GAME: RefCell<Option<Game>> = const { RefCell::new(None) };
    static OUT: RefCell<Vec<i32>> = const { RefCell::new(Vec::new()) };
}

fn with_game<R>(dflt: R, f: impl FnOnce(&mut Game) -> R) -> R {
    GAME.with(|g| g.borrow_mut().as_mut().map_or(dflt, f))
}

fn set_out(v: Vec<i32>) -> i32 {
    let n = v.len() as i32;
    OUT.with(|o| *o.borrow_mut() = v);
    n
}

/// Pointer to the latest results (i32s). Re-read after every call: the buffer may move.
#[no_mangle]
pub extern "C" fn hw_out() -> *const i32 { OUT.with(|o| o.borrow().as_ptr()) }

/// Start a new game. layout: 0 Classic, 1 Quick, 2 Open, 3 Flower. Returns the number of cells.
#[no_mangle]
pub extern "C" fn hw_new(layout: u32) -> i32 {
    let g = Game::new(Layout::from_index(layout));
    let n = g.board.n() as i32;
    GAME.with(|x| *x.borrow_mut() = Some(g));
    n
}

/// Axial coordinates of every cell: out = [q0, r0, q1, r1, ...].
#[no_mangle]
pub extern "C" fn hw_coords() -> i32 {
    let v = with_game(vec![], |g| g.board.coords.iter().flat_map(|&(q, r)| [q, r]).collect());
    set_out(v)
}

/// 0 empty, 1 bee, 2 wasp
#[no_mangle]
pub extern "C" fn hw_piece(i: usize) -> i32 {
    with_game(0, |g| {
        if i >= 128 { 0 } else if g.state.pieces[0] & bit(i) != 0 { 1 } else if g.state.pieces[1] & bit(i) != 0 { 2 } else { 0 }
    })
}

/// Whose turn: 0 bees, 1 wasps.
#[no_mangle] pub extern "C" fn hw_turn() -> i32 { with_game(0, |g| g.state.turn as i32) }
#[no_mangle] pub extern "C" fn hw_count(side: u32) -> i32 { with_game(0, |g| g.state.pieces[(side & 1) as usize].count_ones() as i32) }
#[no_mangle] pub extern "C" fn hw_moves_made() -> i32 { with_game(0, |g| g.history.len() as i32) }
/// -1 still playing, 0 bees won, 1 wasps won, 2 draw
#[no_mangle] pub extern "C" fn hw_winner() -> i32 { with_game(-1, |g| g.over.map_or(-1, |f| f.winner() as i32)) }

/// Legal destinations for the piece on `from`. Out: one i32 per target, `to | fly << 8`.
#[no_mangle]
pub extern "C" fn hw_targets(from: usize) -> i32 {
    let v = with_game(vec![], |g| {
        if g.over.is_some() { return vec![]; }
        g.board.targets_from(&g.state, from).iter().map(|m| m.to as i32 | ((!m.clone as i32) << 8)).collect()
    });
    set_out(v)
}

/// Play a move for the side to move. Returns the number of i32s written, or -1 if illegal. Out:
/// `[from, to, buzz, nflips, ...flips, over, winner, filledBy, nfilled, ...filled]`
#[no_mangle]
pub extern "C" fn hw_play(from: usize, to: usize) -> i32 {
    let res = with_game(None, |g| {
        if from >= g.board.n() || to >= g.board.n() { return None; }
        let clone = g.board.distance(from, to) == 1;
        let m = Move { from: from as u8, to: to as u8, clone };
        g.play(m).map(|(flips, over)| (m, flips, over))
    });
    let Some((m, flips, over)) = res else { return -1 };
    let flips: Vec<i32> = core::cells(flips).map(|c| c as i32).collect();
    let mut v = vec![m.from as i32, m.to as i32, m.clone as i32, flips.len() as i32];
    v.extend(flips);
    match over {
        Some(f) => {
            let filled: Vec<i32> = core::cells(f.filled).map(|c| c as i32).collect();
            v.extend([1, f.winner() as i32, f.filled_by.map_or(-1, |x| x as i32), filled.len() as i32]);
            v.extend(filled);
        }
        None => v.extend([0, -1, -1, 0]),
    }
    set_out(v)
}

#[no_mangle] pub extern "C" fn hw_undo() -> i32 { with_game(0, |g| g.undo() as i32) }

/// The position as 9 i32s for the AI worker: bee mask (4 words), wasp mask (4 words), turn.
#[no_mangle]
pub extern "C" fn hw_state() -> i32 {
    let v = with_game(vec![], |g| {
        let mut v = Vec::with_capacity(9);
        for p in g.state.pieces { for k in 0..4 { v.push((p >> (32 * k)) as u32 as i32); } }
        v.push(g.state.turn as i32);
        v
    });
    set_out(v)
}

/// Load a position sent by hw_state (the AI worker mirrors the page's game this way).
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn hw_set_state(b0: u32, b1: u32, b2: u32, b3: u32, w0: u32, w1: u32, w2: u32, w3: u32, turn: u32) {
    let join = |a: u32, b: u32, c: u32, d: u32| a as u128 | (b as u128) << 32 | (c as u128) << 64 | (d as u128) << 96;
    with_game((), |g| {
        g.state = State { pieces: [join(b0, b1, b2, b3), join(w0, w1, w2, w3)], turn: (turn & 1) as u8 };
        g.history.clear();
        g.over = g.board.outcome(&g.state);
    });
}

/// The AI's move for the side to move: `from << 8 | to`, or -1. level 0 Easy .. 3 Expert, 4 Very easy.
#[no_mangle]
pub extern "C" fn hw_ai(level: u32, seed: u32) -> i32 {
    with_game(-1, |g| {
        if g.over.is_some() { return -1; }
        g.ai_move(level, seed as u64 * 2654435761 + 1).map_or(-1, |m| (m.from as i32) << 8 | m.to as i32)
    })
}
