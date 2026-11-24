//! AI self-play: pits difficulty levels against each other on every board and reports results
//! and thinking time, to check that each level is stronger than the one below and fast enough.
//!
//!   cargo run --release --bin selfplay            (quick: 4 games per pairing)
//!   cargo run --release --bin selfplay -- 20      (more games)

use shardlight::core::{Game, Layout, BEE};
use std::time::Instant;

fn main() {
    let games: u32 = std::env::args().nth(1).and_then(|a| a.parse().ok()).unwrap_or(4);
    let names = ["Easy", "Medium", "Hard", "Expert", "V.easy"];
    let mut slowest = [0f64; 5];
    for (strong, weak) in [(0, 4), (1, 0), (2, 1), (3, 2)] {
        let mut score = 0.0;
        let mut n = 0;
        for layout in [Layout::Classic, Layout::Quick, Layout::Open, Layout::Flower] {
            for k in 0..games {
                // alternate colours
                let strong_side = (k % 2) as u8;
                let mut g = Game::new(layout);
                let mut seed = 1 + k as u64 * 7919;
                while g.over.is_none() {
                    let lvl = if g.state.turn == strong_side { strong } else { weak };
                    seed += 1;
                    let t = Instant::now();
                    let m = g.ai_move(lvl, seed).expect("a move");
                    slowest[lvl as usize] = slowest[lvl as usize].max(t.elapsed().as_secs_f64() * 1000.0);
                    g.play(m).unwrap();
                }
                let w = g.over.unwrap().winner();
                score += if w == strong_side { 1.0 } else if w == 2 { 0.5 } else { 0.0 };
                n += 1;
                let _ = BEE;
            }
        }
        println!("{:<7} vs {:<7} {:>4.0}% ({score}/{n})", names[strong as usize], names[weak as usize], score / n as f64 * 100.0);
    }
    for (k, ms) in slowest.iter().enumerate() { println!("slowest {:<7} move {:>6.0} ms (native)", names[k], ms); }
}
