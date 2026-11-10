import {describe, expect, it} from 'vitest';
import {currentPosition, type Game, newGame, playMove} from '../game.js';
import {modelName, moveVerb} from '../names.js';
import {parseMove} from '../san.js';

function played(...sans: string[]): Game {
	let game = newGame({player: 'w', level: 3, opponent: 'llm'});
	for (const san of sans) {
		const move = parseMove(currentPosition(game), san);
		if (!move) throw new Error(`illegal ${san}`);
		game = playMove(game, move);
	}
	return game;
}

describe('modelName', () => {
	it('says model ids the way people do', () => {
		expect(modelName('deepseek/deepseek-v4.1-flash')).toBe('DeepSeek V4.1 Flash');
		expect(modelName('claude-fable-5-2')).toBe('Claude Fable 5.2');
		expect(modelName('moonshotai/kimi-k3')).toBe('Kimi K3');
		expect(modelName('qwen/qwen3.8-27b')).toBe('Qwen3.8 27B');
		expect(modelName('deepseek-v4.1-flash-(latest)')).toBe('DeepSeek V4.1 Flash');
	});
});

describe('moveVerb', () => {
	it('tells a quiet move, a capture, and castling apart', () => {
		expect(moveVerb(played('e4'), true)).toBe('played e4');
		expect(moveVerb(played('e4', 'd5', 'exd5'), true)).toBe('took their pawn (exd5)');
		expect(moveVerb(played('e4', 'd5', 'Nc3', 'dxe4'), false)).toBe('took your pawn (dxe4)');
		expect(moveVerb(played('e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'O-O'), true)).toBe('castled');
	});
});
