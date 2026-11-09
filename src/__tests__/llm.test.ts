import {describe, expect, it} from 'vitest';
import {currentPosition, type Game, newGame, playMove} from '../game.js';
import {llmPrompt, readReply, retryPrompt} from '../llm.js';
import {parseMove, toSan} from '../san.js';

function play(moves: readonly string[]): Game {
	return moves.reduce((game, text) => {
		const move = parseMove(currentPosition(game), text);
		if (!move) throw new Error(`illegal ${text}`);
		return playMove(game, move);
	}, newGame({player: 'w', level: 3}));
}

function sanOf(game: Game, text: string): string | undefined {
	const {move} = readReply(game, text);
	return move ? toSan(currentPosition(game), move) : undefined;
}

describe('llmPrompt', () => {
	it('names the side, the moves so far, the position and every legal move', () => {
		const {system, prompt} = llmPrompt(play(['e4']));
		expect(system).toContain('first line');
		expect(prompt).toContain('You play black.');
		expect(prompt).toContain('Moves so far: 1. e4');
		expect(prompt).toContain('Position (FEN): rnbqkbnr/pppppppp/8/8/4P3/');
		expect(prompt).toMatch(/Legal moves: .*\bNf6\b.*\be5\b|Legal moves: .*\be5\b.*\bNf6\b/);
	});

	it('says when the LLM moves first', () => {
		expect(llmPrompt(newGame({player: 'b', level: 3})).prompt).toContain(
			'none, you move first',
		);
	});

	it('quotes the bad answer when asking again', () => {
		const first = llmPrompt(play(['e4']));
		const again = retryPrompt({first, answer: 'Ke2\nwhatever'});
		expect(again.prompt).toContain('You answered "Ke2"');
	});
});

describe('readReply', () => {
	const game = play(['e4']);

	it('reads a bare move and a wrapped one', () => {
		expect(sanOf(game, 'e5')).toBe('e5');
		expect(sanOf(game, '**Nf6**')).toBe('Nf6');
		expect(sanOf(game, '`1... c5`')).toBe('c5');
		expect(sanOf(game, 'Move: d5.')).toBe('d5');
		expect(sanOf(game, "I'll play e6 here")).toBe('e6');
	});

	it('keeps a one-line remark, cleaned and cut short', () => {
		expect(readReply(game, 'e5\n"Your move."').remark).toBe('Your move.');
		const long = readReply(game, `e5\n${'word '.repeat(40)}`).remark ?? '';
		expect(long.length).toBeLessThanOrEqual(80);
		expect(long.endsWith('…')).toBe(true);
		expect(readReply(game, 'e5\n\u001b[31mred\u001b[0m').remark).not.toContain(
			'\u001b',
		);
	});

	it('finds no move when the first line has no legal one', () => {
		expect(readReply(game, 'Ke2').move).toBeUndefined();
		expect(readReply(game, 'Let me think.\ne5').move).toBeUndefined();
		expect(readReply(game, '').move).toBeUndefined();
	});
});
