import {describe, expect, it} from 'vitest';
import {chooseMove, type EngineLevel, evaluate, LEVELS} from '../engine.js';
import {applyMove, legalMoves} from '../moves.js';
import {type Position, parseFen, START_FEN} from '../position.js';
import {toSan} from '../san.js';

function position(fen: string): Position {
	const parsed = parseFen(fen);
	if (!parsed) throw new Error(`bad fen ${fen}`);
	return parsed;
}

function levelAt(index: number): EngineLevel {
	const level = LEVELS[index];
	if (!level) throw new Error(`level ${index + 1} is missing`);
	return level;
}

const LEVEL_THREE = levelAt(2);

async function best(fen: string): Promise<string> {
	const board = position(fen);
	const result = await chooseMove(board, LEVEL_THREE);
	if (!result) throw new Error('no move');
	return toSan(board, result.move);
}

describe('chooseMove', () => {
	it('mates in one', async () => {
		expect(await best('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1')).toBe('Ra8#');
	});

	it('takes a hanging queen', async () => {
		expect(await best('4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1')).toBe('Rxd5');
	});

	it('is deterministic for the same position and level', async () => {
		const board = position(START_FEN);
		const first = await chooseMove(board, LEVEL_THREE);
		const second = await chooseMove(board, LEVEL_THREE);
		expect(first?.move).toEqual(second?.move);
		expect(first?.nodes).toBe(second?.nodes);
	});

	it('stays inside its node budget', async () => {
		const level = levelAt(0);
		const result = await chooseMove(position(START_FEN), level);
		expect(result?.nodes).toBeLessThan(level.maxNodes * 1.5);
	});

	it('always finishes depth 1, even over budget in a busy position', async () => {
		const busy = position(
			'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
		);
		const result = await chooseMove(busy, {maxDepth: 1, maxNodes: 1});
		expect(result?.depth).toBe(1);
	});

	it('returns nothing when there is no legal move', async () => {
		const mated = position('R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1');
		expect(await chooseMove(mated, LEVEL_THREE)).toBeUndefined();
	});
});

describe('seeing mates', () => {
	const sanAt = async (fen: string, index: number): Promise<string> => {
		const board = position(fen);
		const result = await chooseMove(board, levelAt(index));
		if (!result) throw new Error('no move');
		return toSan(board, result.move);
	};

	it('mates in one at the lowest level', async () => {
		expect(await sanAt('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', 0)).toBe('Ra8#');
	});

	it('finds a quiet mate in two at the default level', async () => {
		expect(['Rb7', 'Ra7']).toContain(
			await sanAt('7k/8/8/8/8/8/R7/1R4K1 w - - 0 1', 2),
		);
	});

	it('finds a sacrifice that mates in two at the default level', async () => {
		expect(await sanAt('1r5k/6pp/7N/3Q4/8/8/8/6K1 w - - 0 1', 2)).toBe('Qg8+');
	});
});

describe('repetition', () => {
	it('steers away from a repeat when it is winning', async () => {
		const start = position('6k1/8/8/8/8/8/5PPP/R5K1 w - - 2 10');
		const played = position('6k1/8/8/8/8/8/5PPP/1R4K1 b - - 3 10');
		const back = position('5k2/8/8/8/8/8/5PPP/1R4K1 w - - 4 11');
		const after = position('5k2/8/8/8/8/8/5PPP/R5K1 b - - 5 11');
		const now = position('6k1/8/8/8/8/8/5PPP/R5K1 w - - 6 12');
		const history = [start, played, back, after, now];
		const best = await chooseMove(now, levelAt(2), history);
		if (!best) throw new Error('no move');
		const next = applyMove(now, best.move);
		expect(toSan(now, best.move)).not.toBe('Rb1');
		expect(legalMoves(next).length).toBeGreaterThan(0);
	});
});

describe('evaluation', () => {
	it('prefers a passed pawn further up the board', () => {
		const back = position('4k3/8/8/8/8/P7/8/4K3 w - - 0 1');
		const front = position('4k3/8/P7/8/8/8/8/4K3 w - - 0 1');
		expect(evaluate(front)).toBeGreaterThan(evaluate(back));
	});

	it('wants the king central in the endgame', () => {
		const corner = position('4k3/8/8/8/8/8/P7/K7 w - - 0 1');
		const center = position('4k3/8/8/8/3K4/8/P7/8 w - - 0 1');
		expect(evaluate(center)).toBeGreaterThan(evaluate(corner));
	});

	it('wants the lone king on the edge in a won ending', () => {
		const middle = position('8/8/8/4k3/8/8/8/R3K3 w - - 0 1');
		const edge = position('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
		expect(evaluate(edge)).toBeGreaterThan(evaluate(middle));
	});

	for (const [name, fen] of [
		['queen', '8/8/8/4k3/8/8/8/Q3K3 w - - 0 1'],
		['rook', '8/8/8/4k3/8/8/8/R3K3 w - - 0 1'],
	] as const) {
		it(`mates with king and ${name} against a passive king`, async () => {
			let board = position(fen);
			const history = [board];
			for (let ply = 0; ply < 120; ply++) {
				const moves = legalMoves(board);
				const move =
					board.turn === 'w'
						? (await chooseMove(board, levelAt(2), history))?.move
						: moves[0];
				if (!move) break;
				board = applyMove(board, move);
				history.push(board);
			}
			expect(legalMoves(board)).toHaveLength(0);
		}, 60_000);
	}
});
