//! Shardlight rules and AI. Pure Rust, shared by the WASM build and native tests.
//!
//! Rules (classic head-to-head hex play)
//! - Rubies and sapphires take turns. Rubies move first.
//! - Move to an empty cell one step away: the gem *splits* and a copy grows there.
//!   Two steps away: it *leaps* there and leaves its old cell empty.
//! - Every enemy piece touching the landing cell switches sides.
//! - If the side to move has no legal move, the game ends and every empty cell goes to the other side.
//! - The game also ends when the board is full or one side has no pieces. Most cells wins.
//!
//! Cells are stored in a compact list (row by row); positions are u128 bitmasks, so the AI can
//! copy and compare them cheaply.

pub type Mask = u128;
pub const MAX_CELLS: usize = 128;

#[inline]
pub fn bit(i: usize) -> Mask { 1u128 << i }

pub fn cells(mut m: Mask) -> impl Iterator<Item = usize> {
    std::iter::from_fn(move || {
        if m == 0 { return None; }
        let i = m.trailing_zeros() as usize;
        m &= m - 1;
        Some(i)
    })
}

pub const BEE: u8 = 0;
pub const WASP: u8 = 1;

#[derive(Clone, Debug)]
pub struct Board {
    pub name: &'static str,
    /// Axial coordinates (q, r) of each cell, in index order.
    pub coords: Vec<(i32, i32)>,
    pub all: Mask,
    pub ring1: Vec<Mask>,
    pub ring2: Vec<Mask>,
}

fn dist(a: (i32, i32), b: (i32, i32)) -> i32 {
    let (dq, dr) = (a.0 - b.0, a.1 - b.1);
    (dq.abs() + dr.abs() + (dq + dr).abs()) / 2
}

/// Corner directions in turning order; bees take every other corner.
const DIRS: [(i32, i32); 6] = [(1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Layout { Classic, Quick, Open, Flower }

impl Layout {
    pub fn from_index(i: u32) -> Layout {
        match i { 1 => Layout::Quick, 2 => Layout::Open, 3 => Layout::Flower, _ => Layout::Classic }
    }
}

impl Board {
    pub fn new(layout: Layout) -> (Board, State) {
        let (radius, holes): (i32, Vec<(i32, i32)>) = match layout {
            // three gaps around the middle
            Layout::Classic => (4, vec![(1, 0), (0, -1), (-1, 1)]),
            // a small, fast board with one gap in the middle
            Layout::Quick => (3, vec![(0, 0)]),
            // nothing in the way
            Layout::Open => (4, vec![]),
            // six gaps like petals around the centre
            Layout::Flower => (4, DIRS.iter().map(|&(q, r)| (q * 2, r * 2)).collect()),
        };
        let mut coords = Vec::new();
        for r in -radius..=radius {
            for q in -radius..=radius {
                if (q + r).abs() <= radius && !holes.contains(&(q, r)) { coords.push((q, r)); }
            }
        }
        let n = coords.len();
        assert!(n <= MAX_CELLS);
        let mut ring1 = vec![0; n];
        let mut ring2 = vec![0; n];
        for a in 0..n {
            for b in 0..n {
                match dist(coords[a], coords[b]) { 1 => ring1[a] |= bit(b), 2 => ring2[a] |= bit(b), _ => {} }
            }
        }
        let all = if n == 128 { !0 } else { bit(n) - 1 };
        let mut s = State { pieces: [0, 0], turn: BEE };
        for (k, &(dq, dr)) in DIRS.iter().enumerate() {
            let c = (dq * radius, dr * radius);
            if let Some(i) = coords.iter().position(|&x| x == c) { s.pieces[k % 2] |= bit(i); }
        }
        let name = match layout { Layout::Classic => "Classic", Layout::Quick => "Quick", Layout::Open => "Open", Layout::Flower => "Flower" };
        (Board { name, coords, all, ring1, ring2 }, s)
    }

    pub fn n(&self) -> usize { self.coords.len() }
    pub fn empty(&self, s: &State) -> Mask { self.all & !(s.pieces[0] | s.pieces[1]) }
    pub fn distance(&self, a: usize, b: usize) -> i32 { dist(self.coords[a], self.coords[b]) }

    /// Legal moves for the side to move. Buzzes to the same cell give the same position, so each
    /// target appears once as a buzz.
    pub fn moves(&self, s: &State) -> Vec<Move> {
        let me = s.pieces[s.turn as usize];
        let empty = self.empty(s);
        let mut out = Vec::new();
        let mut buzzed: Mask = 0;
        for f in cells(me) {
            for t in cells(self.ring1[f] & empty & !buzzed) { out.push(Move { from: f as u8, to: t as u8, clone: true }); buzzed |= bit(t); }
        }
        for f in cells(me) {
            for t in cells(self.ring2[f] & empty) { out.push(Move { from: f as u8, to: t as u8, clone: false }); }
        }
        out
    }

    pub fn has_move(&self, s: &State, side: u8) -> bool {
        let empty = self.empty(s);
        cells(s.pieces[side as usize]).any(|f| (self.ring1[f] | self.ring2[f]) & empty != 0)
    }

    pub fn targets_from(&self, s: &State, from: usize) -> Vec<Move> {
        if s.pieces[s.turn as usize] & bit(from) == 0 { return vec![]; }
        let empty = self.empty(s);
        let mut out: Vec<Move> = cells(self.ring1[from] & empty).map(|t| Move { from: from as u8, to: t as u8, clone: true }).collect();
        out.extend(cells(self.ring2[from] & empty).map(|t| Move { from: from as u8, to: t as u8, clone: false }));
        out
    }

    pub fn is_legal(&self, s: &State, m: Move) -> bool {
        let (f, t) = (m.from as usize, m.to as usize);
        if f >= self.n() || t >= self.n() { return false; }
        if s.pieces[s.turn as usize] & bit(f) == 0 || self.empty(s) & bit(t) == 0 { return false; }
        let d = self.distance(f, t);
        (d == 1 && m.clone) || (d == 2 && !m.clone)
    }

    /// Play a move: returns the new position and which cells switched sides.
    pub fn apply(&self, s: &State, m: Move) -> (State, Mask) {
        let me = s.turn as usize;
        let mut n = *s;
        if !m.clone { n.pieces[me] &= !bit(m.from as usize); }
        n.pieces[me] |= bit(m.to as usize);
        let flips = self.ring1[m.to as usize] & n.pieces[1 - me];
        n.pieces[me] |= flips;
        n.pieces[1 - me] &= !flips;
        n.turn = 1 - s.turn;
        (n, flips)
    }

    /// Is the game over? If the side to move is stuck, the empties go to the other side.
    pub fn outcome(&self, s: &State) -> Option<Final> {
        let (b, w) = (s.pieces[0], s.pieces[1]);
        let empty = self.empty(s);
        if b == 0 || w == 0 || empty == 0 {
            return Some(Final { pieces: [b, w], filled_by: None, filled: 0 });
        }
        if !self.has_move(s, s.turn) {
            let other = 1 - s.turn as usize;
            let mut p = [b, w];
            p[other] |= empty;
            return Some(Final { pieces: p, filled_by: Some(other as u8), filled: empty });
        }
        None
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct State { pub pieces: [Mask; 2], pub turn: u8 }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Move { pub from: u8, pub to: u8, pub clone: bool }

#[derive(Clone, Copy, Debug)]
pub struct Final { pub pieces: [Mask; 2], pub filled_by: Option<u8>, pub filled: Mask }

impl Final {
    pub fn counts(&self) -> [u32; 2] { [self.pieces[0].count_ones(), self.pieces[1].count_ones()] }
    /// 0 bees, 1 wasps, 2 draw
    pub fn winner(&self) -> u8 {
        let [b, w] = self.counts();
        if b > w { 0 } else if w > b { 1 } else { 2 }
    }
}

// ---------------------------------------------------------------- AI

/// Alpha-beta search with iterative deepening and a node budget (WASM has no clock).
pub struct Ai<'a> {
    board: &'a Board,
    pub nodes: u64,
    budget: u64,
    aborted: bool,
}

const WIN: i32 = 10_000;

impl<'a> Ai<'a> {
    pub fn new(board: &'a Board, budget: u64) -> Self { Ai { board, nodes: 0, budget, aborted: false } }

    fn eval(&self, s: &State) -> i32 {
        let me = s.turn as usize;
        s.pieces[me].count_ones() as i32 - s.pieces[1 - me].count_ones() as i32
    }

    fn terminal(&self, s: &State) -> Option<i32> {
        self.board.outcome(s).map(|f| {
            let c = f.counts();
            let me = s.turn as usize;
            let d = c[me] as i32 - c[1 - me] as i32;
            if d > 0 { WIN + d } else if d < 0 { -WIN + d } else { 0 }
        })
    }

    fn ordered(&self, s: &State) -> Vec<(i32, Move)> {
        let opp = s.pieces[1 - s.turn as usize];
        let mut v: Vec<(i32, Move)> = self.board.moves(s).into_iter().map(|m| {
            let caps = (self.board.ring1[m.to as usize] & opp).count_ones() as i32;
            // a fly leaves a hole behind: count the neighbours it abandons
            let hole = if m.clone { 0 } else { (self.board.ring1[m.from as usize] & s.pieces[s.turn as usize]).count_ones() as i32 };
            (caps * 4 + if m.clone { 3 } else { -hole }, m)
        }).collect();
        v.sort_by(|a, b| b.0.cmp(&a.0));
        v
    }

    fn negamax(&mut self, s: &State, depth: u32, mut alpha: i32, beta: i32) -> i32 {
        self.nodes += 1;
        if self.nodes > self.budget { self.aborted = true; return 0; }
        if let Some(t) = self.terminal(s) { return t; }
        if depth == 0 { return self.eval(s); }
        let mut best = -i32::MAX;
        for (_, m) in self.ordered(s) {
            let (n, _) = self.board.apply(s, m);
            let v = -self.negamax(&n, depth - 1, -beta, -alpha);
            if self.aborted { return 0; }
            if v > best { best = v; }
            if v > alpha { alpha = v; }
            if alpha >= beta { break; }
        }
        best
    }

    /// Best move found within `max_depth` plies and the node budget. `noise` (0..) adds a random
    /// wobble to each root score, which makes the easy levels beatable. `seed` drives it.
    pub fn best(&mut self, s: &State, max_depth: u32, noise: i32, seed: u64) -> Option<Move> {
        let root = self.ordered(s);
        if root.is_empty() { return None; }
        let mut rng = seed | 1;
        let mut jitter = || { rng ^= rng << 13; rng ^= rng >> 7; rng ^= rng << 17; if noise > 0 { (rng % (noise as u64 * 2 + 1)) as i32 - noise } else { 0 } };
        let mut best = root[0].1;
        let mut order: Vec<Move> = root.iter().map(|x| x.1).collect();
        for depth in 1..=max_depth.max(1) {
            let mut alpha = -i32::MAX;
            let mut scored = Vec::with_capacity(order.len());
            let mut depth_best = None;
            for &m in &order {
                let (n, _) = self.board.apply(s, m);
                // with noise, every root move needs its true score (a full window); otherwise prune
                let beta = if noise > 0 { i32::MAX } else { -alpha };
                let v = -self.negamax(&n, depth - 1, -i32::MAX, beta) + jitter();
                if self.aborted { break; }
                scored.push((v, m));
                if depth_best.map_or(true, |(b, _)| v > b) { depth_best = Some((v, m)); }
                if v > alpha { alpha = v; }
            }
            if self.aborted { break; }
            if let Some((_, m)) = depth_best { best = m; }
            scored.sort_by(|a, b| b.0.cmp(&a.0));
            order = scored.into_iter().map(|x| x.1).collect();
        }
        Some(best)
    }
}

/// Difficulty presets: (max depth, node budget, noise).
pub fn difficulty(level: u32) -> (u32, u64, i32) {
    match level {
        0 => (1, 50_000, 3),         // Easy: greedy-ish, with mistakes
        1 => (2, 200_000, 1),        // Medium
        2 => (4, 600_000, 0),        // Hard
        4 => (1, 20_000, 7),         // Very easy (listed first): no look-ahead and a big wobble, so it
                                     // often passes up captures and makes loose jumps
        _ => (7, 1_500_000, 0),      // Expert: as deep as the budget allows (about 0.5 s on a PC, a second or two on a phone)
    }
}

// ---------------------------------------------------------------- game session

pub struct Game {
    pub board: Board,
    pub state: State,
    pub history: Vec<State>,
    pub over: Option<Final>,
}

impl Game {
    pub fn new(layout: Layout) -> Game {
        let (board, state) = Board::new(layout);
        Game { board, state, history: vec![], over: None }
    }
    pub fn play(&mut self, m: Move) -> Option<(Mask, Option<Final>)> {
        if self.over.is_some() || !self.board.is_legal(&self.state, m) { return None; }
        let (n, flips) = self.board.apply(&self.state, m);
        self.history.push(self.state);
        self.state = n;
        self.over = self.board.outcome(&n);
        if let Some(f) = self.over { self.state.pieces = f.pieces; }
        Some((flips, self.over))
    }
    pub fn undo(&mut self) -> bool {
        match self.history.pop() { Some(s) => { self.state = s; self.over = None; true } None => false }
    }
    pub fn ai_move(&self, level: u32, seed: u64) -> Option<Move> {
        let (depth, budget, noise) = difficulty(level);
        Ai::new(&self.board, budget).best(&self.state, depth, noise, seed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boards_have_expected_sizes() {
        assert_eq!(Board::new(Layout::Classic).0.n(), 58);
        assert_eq!(Board::new(Layout::Quick).0.n(), 36);
        assert_eq!(Board::new(Layout::Open).0.n(), 61);
        assert_eq!(Board::new(Layout::Flower).0.n(), 55);
        for l in [Layout::Classic, Layout::Quick, Layout::Open, Layout::Flower] {
            let (_, s) = Board::new(l);
            assert_eq!(s.pieces[0].count_ones(), 3);
            assert_eq!(s.pieces[1].count_ones(), 3);
        }
    }

    #[test]
    fn buzz_copies_fly_moves_and_neighbours_switch() {
        let mut g = Game::new(Layout::Classic);
        let m = g.board.moves(&g.state).into_iter().find(|m| m.clone).unwrap();
        g.play(m).unwrap();
        assert_eq!(g.state.pieces[0].count_ones(), 4);
        assert_eq!(g.state.turn, WASP);
        let f = g.board.moves(&g.state).into_iter().find(|m| !m.clone).unwrap();
        let wasps_before = g.state.pieces[1].count_ones();
        g.play(f).unwrap();
        assert!(g.state.pieces[1].count_ones() >= wasps_before); // a fly never loses pieces
        assert_eq!(g.state.pieces[1] & bit(f.from as usize), 0); // and leaves its cell empty
        assert!(g.undo() && g.undo());
        assert_eq!(g.state.pieces[0].count_ones(), 3);
    }

    #[test]
    fn captures_flip_touching_enemies() {
        let (b, _) = Board::new(Layout::Open);
        // put a wasp next to an empty cell and a bee two steps from it
        let target = 30;
        let wasp = cells(b.ring1[target]).next().unwrap();
        let bee = cells(b.ring1[target] & !b.ring1[wasp] & !bit(wasp)).next().unwrap();
        let s = State { pieces: [bit(bee), bit(wasp) | bit(0)], turn: BEE };
        let (n, flips) = b.apply(&s, Move { from: bee as u8, to: target as u8, clone: true });
        assert_eq!(flips, bit(wasp));
        assert!(n.pieces[0] & bit(wasp) != 0);
    }

    #[test]
    fn stuck_side_hands_over_the_empties() {
        let (b, _) = Board::new(Layout::Quick);
        // bees fill everything except one cell next to the lone wasp... then wasps have a move;
        // instead: a wasp with no empty cell within two steps
        let wasp = 0usize;
        let near = b.ring1[wasp] | b.ring2[wasp];
        let s = State { pieces: [near, bit(wasp)], turn: WASP };
        let f = b.outcome(&s).expect("wasps are stuck");
        assert_eq!(f.filled_by, Some(BEE));
        assert_eq!(f.winner(), BEE);
    }

    #[test]
    fn ai_takes_a_free_capture() {
        let (b, _) = Board::new(Layout::Open);
        let target = 30;
        let ns: Vec<usize> = cells(b.ring1[target]).collect();
        // three wasps around an empty cell, one bee a step away from it
        let s = State { pieces: [bit(ns[0]), bit(ns[2]) | bit(ns[3]) | bit(ns[4])], turn: BEE };
        let m = Ai::new(&b, 100_000).best(&s, 2, 0, 1).unwrap();
        assert_eq!(m.to as usize, target);
    }

    #[test]
    fn stronger_ai_beats_weaker() {
        // Hard (bees) vs Easy (wasps), and the other way round: the stronger side should win both.
        for (bee_lvl, wasp_lvl, want) in [(2, 0, BEE), (0, 2, WASP)] {
            let mut g = Game::new(Layout::Quick);
            let mut seed = 7;
            while g.over.is_none() {
                let lvl = if g.state.turn == BEE { bee_lvl } else { wasp_lvl };
                seed += 1;
                let m = g.ai_move(lvl, seed).unwrap();
                g.play(m).unwrap();
            }
            assert_eq!(g.over.unwrap().winner(), want, "bee {bee_lvl} vs wasp {wasp_lvl}");
        }
    }
}
