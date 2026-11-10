import {describe, expect, it} from 'vitest';
import {blunderOf, gameOverText} from '../effects.js';
import {currentPosition, type Game, newGame, playMove} from '../game.js';
import {parseMove} from '../san.js';

function played(player: 'w' | 'b', ...sans: string[]): Game {
	let game = newGame({player, level: 3, opponent: 'llm'});
	for (const san of sans) {
		const move = parseMove(currentPosition(game), san);
		if (!move) throw new Error(`illegal ${san}`);
		game = playMove(game, move);
	}
	return game;
}

function then(game: Game, san: string): Game {
	const move = parseMove(currentPosition(game), san);
	if (!move) throw new Error(`illegal ${san}`);
	return playMove(game, move);
}

describe('blunderOf', () => {
	it('names the piece a model hangs', async () => {
		const before = played('w', 'e4', 'e5', 'Nf3');
		expect(await blunderOf(before, then(before, 'Qh4'))).toBe(
			'blundered its queen',
		);
	});

	it('leaves an ordinary move alone', async () => {
		const before = played('w', 'e4', 'e5', 'Nf3');
		expect(await blunderOf(before, then(before, 'Nc6'))).toBeUndefined();
	});

	it('calls out walking into mate', async () => {
		const before = played('b', 'f3', 'e5');
		expect(await blunderOf(before, then(before, 'g4'))).toBe(
			'walked into mate',
		);
	});
});

describe('gameOverText', () => {
	it('tells the result from your side, with the length', () => {
		const mated = played('b', 'f3', 'e5', 'g4', 'Qh4');
		expect(gameOverText(mated, 'DeepSeek V4.1 Flash')).toBe(
			'You beat DeepSeek V4.1 Flash in 2 moves',
		);
		const lost = played('w', 'f3', 'e5', 'g4', 'Qh4');
		expect(gameOverText(lost, 'Kimi K3')).toBe('Kimi K3 beat you in 2 moves');
		expect(gameOverText(played('w', 'e4'), 'Kimi K3')).toBeUndefined();
	});
});
