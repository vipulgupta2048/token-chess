import {describe, expect, it} from 'vitest';
import {applyMove, legalMoves} from '../moves.js';
import {type Position, parseFen, START_FEN} from '../position.js';
import {explainIllegal, parseMove, toSan} from '../san.js';

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

describe('parseMove forgives', () => {
	const start = position(START_FEN);
	const nf3 = parseMove(start, 'Nf3');

	it('case, spaces, hyphens and full-square piece moves', () => {
		for (const text of ['E4', 'e2 e4', 'e2-e4', 'E2E4', 'e4!'])
			expect(parseMove(start, text)?.to).toBe(36);
		for (const text of ['NF3', 'nF3', 'Ng1f3', 'ng1-f3', 'g1 f3'])
			expect(parseMove(start, text)).toEqual(nf3);
	});

	it('refuses a full-square move naming the wrong piece', () => {
		expect(parseMove(start, 'Bg1f3')).toBeUndefined();
	});

	it('castling without hyphens', () => {
		const board = position('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
		for (const text of ['oo', 'OO', '00']) expect(parseMove(board, text)?.to).toBe(62);
		for (const text of ['ooo', '000']) expect(parseMove(board, text)?.to).toBe(58);
	});

	it('uses case to tell a bishop from the b-pawn', () => {
		const board = position('4k3/8/8/8/8/2p5/1P6/4KB2 w - - 0 1');
		expect(parseMove(board, 'bxc3')?.piece).toBe('P');
		const both = position('4k3/8/8/8/8/2p5/1P1B4/4K3 w - - 0 1');
		expect(parseMove(both, 'bxc3')?.piece).toBe('P');
		expect(parseMove(both, 'Bxc3')?.piece).toBe('B');
		expect(parseMove(both, 'BXC3')?.piece).toBe('B');
	});

	it('makes a queen when a promotion names no piece', () => {
		const board = position('8/4P3/8/8/8/8/k7/4K3 w - - 0 1');
		for (const text of ['e8', 'e7e8', 'e7-e8'])
			expect(parseMove(board, text)?.promotion).toBe('Q');
	});
});

describe('explainIllegal', () => {
	const start = position(START_FEN);

	it('names the piece and lists its moves', () => {
		const text = explainIllegal(start, 'Nd5');
		expect(text).toContain('no knight can reach d5');
		expect(text).toContain('Nf3');
		expect(text).not.toContain('e4');
	});

	it('treats a bare square as a pawn move', () => {
		expect(explainIllegal(start, 'e5')).toContain('no pawn can reach e5');
	});

	it('explains coordinates by the piece on the from square', () => {
		expect(explainIllegal(start, 'e2e5')).toContain(
			"the pawn on e2 can't reach e5. It can play: e3 e4",
		);
		expect(explainIllegal(start, 'e3e4')).toContain('no piece on e3');
		expect(explainIllegal(start, 'e7e5')).toContain('no piece on e7');
		expect(explainIllegal(start, 'a1a2')).toContain("can't move right now");
	});

	it('asks which piece when two can reach the square', () => {
		const board = position('4k3/8/8/8/8/8/8/R4RK1 w - - 0 1');
		expect(explainIllegal(board, 'Rd1')).toBe(
			'Rd1 could mean Rad1 or Rfd1. Say which.',
		);
	});

	it('explains castling and mentions check', () => {
		expect(explainIllegal(start, 'O-O')).toContain("can't castle");
		const checked = position('4k3/8/8/8/8/8/4r3/4K3 w - - 0 1');
		expect(explainIllegal(checked, 'Kf3')).toContain("You're in check.");
	});

	it('falls back to every legal move for what it cannot read', () => {
		const text = explainIllegal(start, 'hello');
		expect(text).toContain("hello isn't a move");
		expect(text).toContain('Nf3');
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
