import {describe, expect, it} from 'vitest';
import {
	currentPosition,
	describeOutcome,
	fromSaved,
	type Game,
	moveListText,
	newGame,
	outcomeOf,
	playMove,
	toSaved,
	undoTurn,
} from '../game.js';
import {parseFen, toFen} from '../position.js';
import {parseMove} from '../san.js';

function play(game: Game, moves: readonly string[]): Game {
	return moves.reduce((current, text) => {
		const move = parseMove(currentPosition(current), text);
		if (!move) throw new Error(`illegal ${text}`);
		return playMove(current, move);
	}, game);
}

function fromFen(fen: string): Game {
	const position = parseFen(fen);
	if (!position) throw new Error(`bad fen ${fen}`);
	return {...newGame({player: 'w', level: 1}), positions: [position]};
}

describe('outcomeOf', () => {
	it("finds fool's mate", () => {
		const game = play(newGame({player: 'w', level: 1}), [
			'f3',
			'e5',
			'g4',
			'Qh4',
		]);
		expect(describeOutcome(outcomeOf(game))).toBe(
			'black wins by checkmate',
		);
	});

	it('finds stalemate', () => {
		const game = fromFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
		expect(outcomeOf(game)).toEqual({kind: 'draw', reason: 'stalemate'});
	});

	it('finds threefold repetition', () => {
		const shuffle = [
			'Nf3',
			'Nf6',
			'Ng1',
			'Ng8',
			'Nf3',
			'Nf6',
			'Ng1',
			'Ng8',
		];
		const game = play(newGame({player: 'w', level: 1}), shuffle);
		expect(outcomeOf(game)).toEqual({
			kind: 'draw',
			reason: 'threefold repetition',
		});
	});

	it('finds insufficient material and the fifty-move rule', () => {
		expect(outcomeOf(fromFen('8/8/4k3/8/8/2N5/8/4K3 w - - 0 1')).kind).toBe(
			'draw',
		);
		expect(outcomeOf(fromFen('8/8/4k3/8/8/2R5/8/4K3 w - - 0 1')).kind).toBe(
			'ongoing',
		);
		expect(
			outcomeOf(fromFen('8/8/4k3/8/8/2R5/8/4K3 w - - 100 80')),
		).toEqual({
			kind: 'draw',
			reason: 'fifty-move rule',
		});
	});
});

describe('undoTurn', () => {
	it("takes back the player's move and the reply", () => {
		const game = play(newGame({player: 'w', level: 1}), [
			'e4',
			'e5',
			'Nf3',
			'Nc6',
		]);
		const undone = undoTurn(game);
		expect(undone.sanLog).toEqual(['e4', 'e5']);
		expect(currentPosition(undone).turn).toBe('w');
	});

	it('leaves a game with nothing of the player to take back', () => {
		const asBlack = play(newGame({player: 'b', level: 1}), ['e4']);
		expect(undoTurn(asBlack)).toBe(asBlack);
	});
});

describe('save and move list', () => {
	it('round-trips through the saved shape', () => {
		const game = play(newGame({player: 'b', level: 4}), [
			'd4',
			'Nf6',
			'c4',
		]);
		const restored = fromSaved(toSaved(game));
		expect(restored?.sanLog).toEqual(game.sanLog);
		expect(restored && toFen(currentPosition(restored))).toBe(
			toFen(currentPosition(game)),
		);
	});

	it('numbers moves', () => {
		const game = play(newGame({player: 'w', level: 1}), [
			'e4',
			'e5',
			'Nf3',
		]);
		expect(moveListText(game, 10)).toBe('1. e4 e5 2. Nf3');
	});
});
