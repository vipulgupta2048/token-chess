// Perft counts every leaf of the legal move tree to a fixed depth. The
// expected numbers are the published reference counts (chessprogramming.org
// "Perft Results"); matching them exercises castling through check, en passant
// pins, promotions and discovered checks, which is where move generators break.

import {describe, expect, it} from 'vitest';
import {applyMove, legalMoves} from '../moves.js';
import {type Position, parseFen, START_FEN} from '../position.js';

function perft(position: Position, depth: number): number {
	const moves = legalMoves(position);
	if (depth === 1) return moves.length;
	return moves.reduce(
		(total, move) => total + perft(applyMove(position, move), depth - 1),
		0,
	);
}

function position(fen: string): Position {
	const parsed = parseFen(fen);
	if (!parsed) throw new Error(`bad fen ${fen}`);
	return parsed;
}

const CASES: readonly (readonly [string, string, readonly number[]])[] = [
	['start position', START_FEN, [20, 400, 8902]],
	[
		'kiwipete',
		'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
		[48, 2039, 97862],
	],
	[
		'position 3',
		'8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
		[14, 191, 2812, 43238],
	],
	[
		'position 4',
		'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
		[6, 264, 9467],
	],
	[
		'position 5',
		'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
		[44, 1486, 62379],
	],
];

describe('perft', () => {
	it.each(CASES)('%s matches the reference counts', (_, fen, counts) => {
		const root = position(fen);
		counts.forEach((count, index) => {
			expect(perft(root, index + 1)).toBe(count);
		});
	});
});
