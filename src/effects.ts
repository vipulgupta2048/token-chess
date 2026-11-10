// The moments worth calling out: a model's blunder, and the end of a game.

import {chooseMove, LEVELS} from './engine.js';
import {currentPosition, type Game, outcomeOf} from './game.js';

// A move that hands over this much (centipawns, at a shallow search) is a
// blunder: a minor piece and change, or worse.
const BLUNDER_LOSS = 250;
// Scores past this are forced mates, not material.
const MATE_SCORE = 50_000;
// A quick search: blunders worth calling out are one or two moves deep.
const BLUNDER_LEVEL = LEVELS[1] ?? {maxDepth: 2, maxNodes: 10_000};

const PIECE_NAMES: Readonly<Record<string, string>> = {
	p: 'pawn',
	n: 'knight',
	b: 'bishop',
	r: 'rook',
	q: 'queen',
};

// How the opponent's move in `after` (played from `before`) threw the game
// away, or undefined when it didn't: "blundered its queen", "walked into mate".
export async function blunderOf(
	before: Game,
	after: Game,
): Promise<string | undefined> {
	if (outcomeOf(after).kind !== 'ongoing') return undefined;
	const best = await chooseMove(
		currentPosition(before),
		BLUNDER_LEVEL,
		before.positions,
	);
	const punish = await chooseMove(
		currentPosition(after),
		BLUNDER_LEVEL,
		after.positions,
	);
	if (!best || !punish) return undefined;
	// Already lost before this move: nothing left to blunder.
	if (best.score < -MATE_SCORE) return undefined;
	if (punish.score > MATE_SCORE) return 'walked into mate';
	// Both scores are from the side to move, so the drop is their sum.
	if (best.score + punish.score < BLUNDER_LOSS) return undefined;
	const taken = PIECE_NAMES[punish.move.captured.toLowerCase()];
	return taken ? `blundered its ${taken}` : 'blundered';
}

// One line for a finished game, from the player's side: "You beat DeepSeek
// V4.1 Flash in 23 moves". Undefined while the game goes on.
export function gameOverText(game: Game, rival: string): string | undefined {
	const outcome = outcomeOf(game);
	if (outcome.kind === 'ongoing') return undefined;
	const moves = Math.ceil(game.sanLog.length / 2);
	const length =
		moves === 0 ? '' : ` in ${moves} ${moves === 1 ? 'move' : 'moves'}`;
	if (outcome.kind === 'draw') return `Draw with ${rival} by ${outcome.reason}`;
	const how = outcome.kind === 'resigned' ? ' by resignation' : '';
	return outcome.winner === game.player
		? `You beat ${rival}${length}${how}`
		: `${rival} beat you${length}${how}`;
}
