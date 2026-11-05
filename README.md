# token-chess

Play chess in the Command Code TUI while your agent works. The board stays in
a live pane above the prompt, you play with the arrow keys, the engine answers
in a second or two at most, and the footer keeps the game in view. Same idea as
[token-snake](https://github.com/vipulgupta2048/token-snake), but as a mod: no
second terminal pane, and chess is turn based, so it fits between agent steps.

Zero runtime dependencies. Deterministic engine: the same position, game history
and level always get the same reply.

## Try it

```bash
# Install it for every session
cmd mods add vipulgupta2048/token-chess -g

# Or try it for one session from a clone
git clone https://github.com/vipulgupta2048/token-chess
cmd --mod ./token-chess/index.ts
```

Then, at any time, including while the agent is mid-turn, run `/chess`. The
board opens with one control under it, driven by ←/→ and Enter:

1. Choose a piece.
2. Choose its square. Dots mark where it can go, and captures light up.

Undo, New game, Level, Resign and Type a move are under `≡ menu` at the end of
the list. Esc hands the keyboard back to the prompt, and `/chess`, Alt+C or
Alt+↑ returns to the board. Alt+0 closes it.

Everything also works from the prompt, or in Type a move:

| After `/chess`, or typed in the pane | What it does |
|---|---|
| `e4`, `Nf3`, `exd5`, `O-O`, `e8=Q` | Play a move in SAN |
| `e2e4`, `e2 e4`, `e2-e4`, `Ng1f3` | The same by squares. Case doesn't matter, `oo` castles, and a promotion with no piece makes a queen |
| `new [black]` | New game. You play white unless you say black |
| `undo` | Take back your last move and the engine's reply |
| `level <1-5>` | Engine strength, default 3 |
| `resign` | Give up the current game |
| `help` | The list above |

An illegal move is answered in terms of the piece you named: `Nd5` gets "no
knight can reach d5" and that piece's legal moves. The game is saved to
`~/.commandcode/token-chess/game.json`, so it survives `/reload` and new
sessions. On a host without panes, each turn prints a board in the feed instead.

## How it fits the mod API

| Need | Seam |
|---|---|
| Take moves while the agent runs | A `select` or `input` element in the pane, or `cmd.addCommand`. Both run while the agent is working |
| Draw the board | `cmd.ui.pane`, line based ANSI rows repainted with `refreshWidgets`. `cmd.addRenderer` + `cmd.showEntry` where panes aren't available |
| Reach the board from the prompt | `cmd.addShortcut('alt+c')` |
| Keep the game visible | `cmd.ui.setStatus`, one footer segment: `♙ chess · your move · last Nf6` |
| Offer a game while you wait | `cmd.on('run_start')` sets `♙ /chess to play while you wait` when no game is going |
| Resume a saved game | `cmd.hooks({onSessionStart})` |

## Engine

Iterative deepening negamax with alpha-beta, check extensions, a quiescence
search over captures and check evasions, repetition awareness, and MVV-LVA
ordering. The evaluation is Michniewski's material plus piece-square tables,
with tapered king tables, passed pawns, and a push toward mate in won endings.
The search is bounded by a node budget instead of a clock, which is what makes
it deterministic across machines. It runs in the TUI process and yields to the
event loop between root moves, so the agent's stream keeps painting.

Measured on a busy middlegame (kiwipete):

| Level | Depth | Node budget | Think time | Longest UI stall |
|---|---|---|---|---|
| 1 | 1 | Always finishes depth 1 | ~0.1 s | ~35 ms |
| 2 | 2 | 10,000 | ~0.2 s | ~30 ms |
| 3 (default) | 3 | 30,000 | ~0.5 s | ~160 ms |
| 4 | 4 | 60,000 | ~1.2 s | ~190 ms |
| 5 | 5 (reached 4 here) | 120,000 | ~2.4 s | ~185 ms |

Move generation is checked with perft against the published reference counts
for the start position, kiwipete, and positions 3 to 5 (castling through
check, en passant pins, promotions, discovered checks).

## Not yet

- **An LLM opponent.** `cmd.model.complete` runs one completion outside the
  agent's transcript, with the reply validated against the legal move list and
  the local engine as the fallback. That costs credits and seconds per move,
  so it should be an opt-in flag.
- **A cursor on the board.** Mod shortcuts need Ctrl or Alt, a pane only takes
  buttons, inputs and selects, and a select doesn't report its highlight until
  Enter, so the picker can't preview a piece before you choose it.

## Develop

```bash
pnpm install
pnpm test        # perft, SAN, rules, engine, and the mod through a stub of the mod API
pnpm typecheck
```

`src/mod-api.ts` declares the slice of Command Code's `ModApi` this mod uses,
so the project typechecks on its own. The mod has no runtime
dependencies; the dev dependencies are only for the tests.

## License

MIT
