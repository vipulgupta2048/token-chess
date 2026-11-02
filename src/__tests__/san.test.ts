import {describe, expect, it} from 'vitest';
import {applyMove, legalMoves} from '../moves.js';
import {type Position, parseFen, START_FEN} from '../position.js';
import {parseMove, toSan} from '../san.js';

function position(fen: string): Position {
	const parsed = parseFen(fen);
	if (!parsed) throw new Error(`bad fen ${fen}`);
	return parsed;
}

function play(fen: string, moves: readonly string[]): Position {
	return moves.reduce((current, text) => {
		const move = parseMove(current, text);
		if (!move) throw new Error(`illegal ${text}`);
		return applyMove(current, move);
	}, position(fen));
}

describe('parseMove', () => {
	it('reads SAN, lowercase piece letters and UCI', () => {
		const start = position(START_FEN);
		expect(parseMove(start, 'e4')?.to).toBe(36);
		expect(parseMove(start, 'Nf3')).toEqual(parseMove(start, 'nf3'));
		expect(parseMove(start, 'g1f3')).toEqual(parseMove(start, 'Nf3'));
		expect(parseMove(start, 'e5')).toBeUndefined();
		expect(parseMove(start, 'hello')).toBeUndefined();
	});

	it('keeps a lowercase b as a pawn move before a bishop', () => {
		const board = play(START_FEN, ['b4', 'c5']);
		const move = parseMove(board, 'bxc5');
		expect(move?.piece).toBe('P');
	});

	it('reads castling with letters or zeros', () => {
		const board = position('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
		expect(parseMove(board, 'O-O')?.flag).toBe('castle');
		expect(parseMove(board, '0-0-0')?.flag).toBe('castle');
		expect(parseMove(board, 'o-o')?.to).toBe(62);
	});

	it('reads promotions in every common spelling', () => {
		const board = position('8/4P3/8/8/8/8/k7/4K3 w - - 0 1');
		for (const text of ['e8=Q', 'e8Q', 'e8q', 'e7e8q', 'e8=q']) {
			expect(parseMove(board, text)?.promotion).toBe('Q');
		}
		expect(parseMove(board, 'e8=N')?.promotion).toBe('N');
	});
});

describe('toSan', () => {
	it('disambiguates by file, then rank', () => {
		const files = position('4k3/8/8/8/8/8/8/R4RK1 w - - 0 1');
		const sans = legalMoves(files).map(move => toSan(files, move));
		expect(sans).toContain('Rad1');
		expect(sans).toContain('Rfd1');
		const ranks = position('4k3/R7/8/8/8/8/8/R3K3 w - - 0 1');
		const rankSans = legalMoves(ranks).map(move => toSan(ranks, move));
		expect(rankSans).toContain('R1a4');
		expect(rankSans).toContain('R7a4');
	});

	it('marks check and mate', () => {
		const board = play(START_FEN, ['f3', 'e5', 'g4']);
		const mate = parseMove(board, 'Qh4');
		if (!mate) throw new Error('Qh4 should be legal');
		expect(toSan(board, mate)).toBe('Qh4#');
		const check = position('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
		const rook = parseMove(check, 'Ra8');
		if (!rook) throw new Error('Ra8 should be legal');
		expect(toSan(check, rook)).toBe('Ra8+');
	});

	it('writes en passant as a pawn capture', () => {
		const board = play(START_FEN, ['e4', 'a6', 'e5', 'd5']);
		const ep = parseMove(board, 'exd6');
		expect(ep?.flag).toBe('enPassant');
	});
});
