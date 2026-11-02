import {describe, expect, it} from 'vitest';
import {chooseMove, type EngineLevel, LEVELS} from '../engine.js';
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

	it('returns nothing when there is no legal move', async () => {
		const mated = position('R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1');
		expect(await chooseMove(mated, LEVEL_THREE)).toBeUndefined();
	});
});
