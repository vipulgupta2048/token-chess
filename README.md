# token-chess

Play chess in the Command Code TUI while your agent works. The board prints
right in the feed, the engine answers in a fraction of a second, and the
footer keeps the game in view. Same idea as
[token-snake](https://github.com/vipulgupta2048/token-snake), but as a mod: no
second terminal pane, and chess is turn based, so it fits a prompt loop.

Zero runtime dependencies. Deterministic engine: the same position at the same
level always gets the same reply.

## Try it

```bash
# Install it for every session
cmd mods add vipulgupta2048/token-chess -g

# Or try it for one session from a clone
git clone https://github.com/vipulgupta2048/token-chess
cmd --mod ./token-chess/index.ts
```

Then, at any time, including while the agent is mid-turn:

| Command | What it does |
|---|---|
| `/chess` | Show the board (starts a game if none) |
| `/chess e4` | Play a move. SAN (`Nf3`, `exd5`, `O-O`, `e8=Q`) or UCI (`e2e4`) |
| `/chess new [black]` | New game. You play white unless you say black |
| `/chess undo` | Take back your last move and the engine's reply |
| `/chess level <1-5>` | Engine strength, default 3 |
| `/chess resign` | Give up the current game |
| `/chess help` | The list above |

An illegal move is answered with the full list of legal moves. The game is
saved to `~/.commandcode/token-chess/game.json`, so it survives `/reload` and
new sessions.

## How it fits the mod API

| Need | Seam |
|---|---|
| Take moves while the agent runs | `cmd.addCommand`. Mod commands still run while the agent is working, so `/chess e4` works mid-turn |
| Draw the board | `cmd.addRenderer` + `cmd.showEntry`, line based ANSI rows in the feed |
| Keep the game visible | `cmd.ui.setStatus`, one footer segment: `♙ chess · your move · last Nf6` |
| Offer a game while you wait | `cmd.on('run_start')` sets `♙ /chess to play while you wait` when no game is going |
| Resume a saved game | `cmd.hooks({onSessionStart})` |

## Engine

Iterative deepening negamax with alpha-beta, a capture-only quiescence search,
MVV-LVA ordering, and Michniewski's material plus piece-square evaluation. The
search is bounded by a node budget instead of a clock, which is what makes it
deterministic across machines. It runs in the TUI process and yields to the
event loop between root moves, so the agent's stream keeps painting.

Measured on a busy middlegame (kiwipete):

| Level | Depth | Node budget | Think time | Longest UI stall |
|---|---|---|---|---|
| 1 | 1 | 1,000 | ~25 ms | ~20 ms |
| 2 | 2 | 4,000 | ~85 ms | ~20 ms |
| 3 (default) | 3 | 12,000 | ~0.4 s | ~100 ms |
| 4 | 4 | 30,000 | ~0.9 s | ~100 ms |
| 5 | 5 | 60,000 | ~1.5 s | ~0.5 s |

Move generation is checked with perft against the published reference counts
for the start position, kiwipete, and positions 3 to 5 (castling through
check, en passant pins, promotions, discovered checks).

## Not yet

- **An LLM opponent.** The `ModApi` has no side channel to the model: anything
  sent through `queueMessage` or `sendUserMessage` lands in the agent's own
  transcript and would derail the work you are waiting on. The workable route
  is a separate headless run (`cmd.exec` of `cmd -p "<FEN + legal moves>"`),
  with the reply validated against the legal move list and the local engine as
  the fallback. That costs credits and seconds per move, so it should be an
  opt-in flag.
- **A live board pane.** `cmd.ui.widget` (a panel above the editor) is in the
  API but not wired into the TUI yet. When it is, the board can stay pinned
  above the prompt instead of printing into the feed.
- **Keyboard play.** Mod shortcuts need Ctrl or Alt, so arrow-key piece
  selection like token-snake's controls is out; typed moves are the fit.

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
