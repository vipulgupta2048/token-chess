// A game: every position played so far plus the SAN log, so undo is just
// dropping the tail and threefold repetition is a count over the history.

import {applyMove, isInCheck, legalMoves, type Move} from './moves.js';
import {
	type Color,
	opponent,
	type Position,
	parseFen,
	repetitionKey,
	START_FEN,
	toFen,
} from './position.js';
import {toSan} from './san.js';

export interface Game {
	readonly positions: readonly Position[];
	readonly sanLog: readonly string[];
	readonly player: Color;
	readonly level: number;
	readonly resigned: boolean;
}

export type Outcome =
	| {readonly kind: 'ongoing'}
	| {readonly kind: 'checkmate'; readonly winner: Color}
	| {readonly kind: 'resigned'; readonly winner: Color}
	| {
			readonly kind: 'draw';
			readonly reason:
				| 'stalemate'
				| 'fifty-move rule'
				| 'threefold repetition'
				| 'insufficient material';
	  };

export function newGame(params: {player: Color; level: number}): Game {
	const start = parseFen(START_FEN);
	if (!start)
		throw new Error('token-chess: the start position failed to parse');
	return {
		positions: [start],
		sanLog: [],
		player: params.player,
		level: params.level,
		resigned: false,
	};
}

export function currentPosition(game: Game): Position {
	const position = game.positions[game.positions.length - 1];
	if (!position) throw new Error('token-chess: a game has no positions');
	return position;
}

export function playMove(game: Game, move: Move): Game {
	const position = currentPosition(game);
	return {
		...game,
		positions: [...game.positions, applyMove(position, move)],
		sanLog: [...game.sanLog, toSan(position, move)],
	};
}

// Takes back the player's last move and the engine's reply to it, so the
// player is on move again. Returns the game unchanged when there is nothing
// of the player's to take back.
export function undoTurn(game: Game): Game {
	const isPlayerTurn = currentPosition(game).turn === game.player;
	const plies = isPlayerTurn ? 2 : 1;
	const keep = game.positions.length - plies;
	if (keep < 1) return game;
	if (game.positions[keep - 1]?.turn !== game.player) return game;
	return {
		...game,
		positions: game.positions.slice(0, keep),
		sanLog: game.sanLog.slice(0, keep - 1),
		resigned: false,
	};
}

function isInsufficientMaterial(position: Position): boolean {
	const pieces = position.board.filter(piece => piece !== '');
	const minors = pieces.filter(piece => /[nbNB]/.test(piece));
	const others = pieces.filter(piece => !/[kKnbNB]/.test(piece));
	if (others.length > 0) return false;
	return minors.length <= 1;
}

function repetitions(game: Game): number {
	const key = repetitionKey(currentPosition(game));
	return game.positions.filter(position => repetitionKey(position) === key)
		.length;
}

export function outcomeOf(game: Game): Outcome {
	const position = currentPosition(game);
	if (game.resigned) return {kind: 'resigned', winner: opponent(game.player)};
	if (legalMoves(position).length === 0) {
		if (isInCheck(position))
			return {kind: 'checkmate', winner: opponent(position.turn)};
		return {kind: 'draw', reason: 'stalemate'};
	}
	if (position.halfmove >= 100)
		return {kind: 'draw', reason: 'fifty-move rule'};
	if (repetitions(game) >= 3)
		return {kind: 'draw', reason: 'threefold repetition'};
	if (isInsufficientMaterial(position))
		return {kind: 'draw', reason: 'insufficient material'};
	return {kind: 'ongoing'};
}

export function colorName(color: Color): string {
	return color === 'w' ? 'white' : 'black';
}

export function describeOutcome(outcome: Outcome): string {
	if (outcome.kind === 'ongoing') return 'in progress';
	if (outcome.kind === 'draw') return `draw by ${outcome.reason}`;
	const how = outcome.kind === 'checkmate' ? 'checkmate' : 'resignation';
	return `${colorName(outcome.winner)} wins by ${how}`;
}

// The move list as `1. e4 e5 2. Nf3`, last `count` plies only.
export function moveListText(game: Game, count: number): string {
	const first = game.positions[0];
	const blackStarts = first?.turn === 'b';
	const startNumber = first?.fullmove ?? 1;
	const tokens = game.sanLog.map((san, index) => {
		const ply = index + (blackStarts ? 1 : 0);
		const number = startNumber + Math.floor(ply / 2);
		if (ply % 2 === 0) return `${number}. ${san}`;
		return index === 0 ? `${number}... ${san}` : san;
	});
	return tokens.slice(-count).join(' ');
}

export interface SavedGame {
	readonly fens: readonly string[];
	readonly sanLog: readonly string[];
	readonly player: Color;
	readonly level: number;
	readonly resigned: boolean;
}

export function toSaved(game: Game): SavedGame {
	return {
		fens: game.positions.map(toFen),
		sanLog: game.sanLog,
		player: game.player,
		level: game.level,
		resigned: game.resigned,
	};
}

export function fromSaved(saved: SavedGame): Game | undefined {
	const positions = saved.fens.map(parseFen);
	if (positions.length === 0) return undefined;
	if (positions.some(position => position === undefined)) return undefined;
	return {
		positions: positions.filter(position => position !== undefined),
		sanLog: saved.sanLog,
		player: saved.player,
		level: saved.level,
		resigned: saved.resigned,
	};
}
