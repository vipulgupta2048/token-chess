// Legal move generation. Pseudo-legal moves are generated per piece from
// (row, col) deltas, so nothing wraps around the board edge, then each one is
// applied and dropped if it leaves the mover's own king attacked.

import {
	type Color,
	colOf,
	colorOf,
	opponent,
	type Position,
	rowOf,
	squareAt,
} from './position.js';

export type MoveFlag = 'normal' | 'double' | 'enPassant' | 'castle';

export interface Move {
	readonly from: number;
	readonly to: number;
	readonly piece: string;
	readonly captured: string;
	readonly promotion: string;
	readonly flag: MoveFlag;
}

type Delta = readonly [number, number];

const KNIGHT: readonly Delta[] = [
	[-2, -1],
	[-2, 1],
	[-1, -2],
	[-1, 2],
	[1, -2],
	[1, 2],
	[2, -1],
	[2, 1],
];
const KING: readonly Delta[] = [
	[-1, -1],
	[-1, 0],
	[-1, 1],
	[0, -1],
	[0, 1],
	[1, -1],
	[1, 0],
	[1, 1],
];
const ROOK: readonly Delta[] = [
	[-1, 0],
	[1, 0],
	[0, -1],
	[0, 1],
];
const BISHOP: readonly Delta[] = [
	[-1, -1],
	[-1, 1],
	[1, -1],
	[1, 1],
];

// Corner squares and the castling right each one guards.
const ROOK_HOMES: readonly (readonly [number, string])[] = [
	[63, 'K'],
	[56, 'Q'],
	[7, 'k'],
	[0, 'q'],
];

function pieceFor(color: Color, kind: string): string {
	return color === 'w' ? kind.toUpperCase() : kind;
}

function step(square: number, [dRow, dCol]: Delta): number {
	return squareAt(rowOf(square) + dRow, colOf(square) + dCol);
}

function attackedByLeaper(params: {
	board: readonly string[];
	square: number;
	deltas: readonly Delta[];
	attacker: string;
}): boolean {
	return params.deltas.some(
		delta => params.board[step(params.square, delta)] === params.attacker,
	);
}

function attackedBySlider(params: {
	board: readonly string[];
	square: number;
	deltas: readonly Delta[];
	attackers: readonly string[];
}): boolean {
	for (const delta of params.deltas) {
		let target = step(params.square, delta);
		while (target >= 0 && params.board[target] === '') {
			target = step(target, delta);
		}
		if (target < 0) continue;
		if (params.attackers.includes(params.board[target] ?? '')) return true;
	}
	return false;
}

export function isSquareAttacked(params: {
	board: readonly string[];
	square: number;
	by: Color;
}): boolean {
	const {board, square, by} = params;
	// A white pawn attacks upward (toward row 0), so it sits one row below.
	const pawnRow = by === 'w' ? 1 : -1;
	const pawn = pieceFor(by, 'p');
	const pawnDeltas: readonly Delta[] = [
		[pawnRow, -1],
		[pawnRow, 1],
	];
	if (attackedByLeaper({board, square, deltas: pawnDeltas, attacker: pawn}))
		return true;
	const knight = pieceFor(by, 'n');
	if (attackedByLeaper({board, square, deltas: KNIGHT, attacker: knight}))
		return true;
	const king = pieceFor(by, 'k');
	if (attackedByLeaper({board, square, deltas: KING, attacker: king}))
		return true;
	const queen = pieceFor(by, 'q');
	const straight = [pieceFor(by, 'r'), queen];
	if (attackedBySlider({board, square, deltas: ROOK, attackers: straight}))
		return true;
	const diagonal = [pieceFor(by, 'b'), queen];
	return attackedBySlider({
		board,
		square,
		deltas: BISHOP,
		attackers: diagonal,
	});
}

export function kingSquare(board: readonly string[], color: Color): number {
	return board.indexOf(pieceFor(color, 'k'));
}

export function isInCheck(position: Position): boolean {
	const king = kingSquare(position.board, position.turn);
	if (king < 0) return false;
	return isSquareAttacked({
		board: position.board,
		square: king,
		by: opponent(position.turn),
	});
}

function quietOrCapture(params: {
	position: Position;
	from: number;
	to: number;
}): Move | undefined {
	const {position, from, to} = params;
	const piece = position.board[from] ?? '';
	const captured = position.board[to] ?? '';
	if (colorOf(captured) === position.turn) return undefined;
	return {from, to, piece, captured, promotion: '', flag: 'normal'};
}

function leaperMoves(
	position: Position,
	from: number,
	deltas: readonly Delta[],
): readonly Move[] {
	return deltas.flatMap(delta => {
		const to = step(from, delta);
		if (to < 0) return [];
		const move = quietOrCapture({position, from, to});
		return move ? [move] : [];
	});
}

function sliderMoves(
	position: Position,
	from: number,
	deltas: readonly Delta[],
): readonly Move[] {
	const moves: Move[] = [];
	for (const delta of deltas) {
		let to = step(from, delta);
		while (to >= 0) {
			const move = quietOrCapture({position, from, to});
			if (!move) break;
			moves.push(move);
			if (move.captured !== '') break;
			to = step(to, delta);
		}
	}
	return moves;
}

function withPromotions(move: Move, color: Color): readonly Move[] {
	const lastRow = color === 'w' ? 0 : 7;
	if (rowOf(move.to) !== lastRow) return [move];
	return ['q', 'r', 'b', 'n'].map(kind => ({
		...move,
		promotion: pieceFor(color, kind),
	}));
}

function pawnPushes(position: Position, from: number): readonly Move[] {
	const color = position.turn;
	const forward = color === 'w' ? -1 : 1;
	const startRow = color === 'w' ? 6 : 1;
	const piece = position.board[from] ?? '';
	const one = step(from, [forward, 0]);
	if (one < 0 || position.board[one] !== '') return [];
	const single: Move = {
		from,
		to: one,
		piece,
		captured: '',
		promotion: '',
		flag: 'normal',
	};
	const two = step(from, [forward * 2, 0]);
	if (rowOf(from) !== startRow || position.board[two] !== '')
		return withPromotions(single, color);
	return [single, {...single, to: two, flag: 'double'}];
}

function pawnCaptures(position: Position, from: number): readonly Move[] {
	const color = position.turn;
	const forward = color === 'w' ? -1 : 1;
	const piece = position.board[from] ?? '';
	return [-1, 1].flatMap(side => {
		const to = step(from, [forward, side]);
		if (to < 0) return [];
		if (to === position.epSquare) {
			const captured = pieceFor(opponent(color), 'p');
			const flag: MoveFlag = 'enPassant';
			return [{from, to, piece, captured, promotion: '', flag}];
		}
		const captured = position.board[to] ?? '';
		if (colorOf(captured) !== opponent(color)) return [];
		const move: Move = {
			from,
			to,
			piece,
			captured,
			promotion: '',
			flag: 'normal',
		};
		return withPromotions(move, color);
	});
}

function castleMoves(position: Position, from: number): readonly Move[] {
	const color = position.turn;
	const homeRow = color === 'w' ? 7 : 0;
	if (from !== squareAt(homeRow, 4)) return [];
	const enemy = opponent(color);
	const {board} = position;
	if (isSquareAttacked({board, square: from, by: enemy})) return [];
	const sides = [
		{right: pieceFor(color, 'k'), empty: [5, 6], path: [5, 6], to: 6},
		{right: pieceFor(color, 'q'), empty: [1, 2, 3], path: [3, 2], to: 2},
	];
	const piece = board[from] ?? '';
	return sides.flatMap(side => {
		if (!position.castling.includes(side.right)) return [];
		const blocked = side.empty.some(
			col => board[squareAt(homeRow, col)] !== '',
		);
		if (blocked) return [];
		const unsafe = side.path.some(col =>
			isSquareAttacked({
				board,
				square: squareAt(homeRow, col),
				by: enemy,
			}),
		);
		if (unsafe) return [];
		const to = squareAt(homeRow, side.to);
		const flag: MoveFlag = 'castle';
		return [{from, to, piece, captured: '', promotion: '', flag}];
	});
}

function pieceMoves(position: Position, from: number): readonly Move[] {
	const kind = (position.board[from] ?? '').toLowerCase();
	if (kind === 'p')
		return [...pawnPushes(position, from), ...pawnCaptures(position, from)];
	if (kind === 'n') return leaperMoves(position, from, KNIGHT);
	if (kind === 'b') return sliderMoves(position, from, BISHOP);
	if (kind === 'r') return sliderMoves(position, from, ROOK);
	if (kind === 'q') return sliderMoves(position, from, [...ROOK, ...BISHOP]);
	if (kind === 'k')
		return [
			...leaperMoves(position, from, KING),
			...castleMoves(position, from),
		];
	return [];
}

function pseudoLegalMoves(position: Position): readonly Move[] {
	const moves: Move[] = [];
	for (let square = 0; square < 64; square++) {
		if (colorOf(position.board[square] ?? '') !== position.turn) continue;
		moves.push(...pieceMoves(position, square));
	}
	return moves;
}

function nextCastling(castling: string, move: Move): string {
	let rights = castling;
	const kind = move.piece.toLowerCase();
	if (kind === 'k') {
		const gone = colorOf(move.piece) === 'w' ? /[KQ]/g : /[kq]/g;
		rights = rights.replace(gone, '');
	}
	for (const [corner, right] of ROOK_HOMES) {
		if (move.from === corner || move.to === corner)
			rights = rights.replace(right, '');
	}
	return rights === '' ? '-' : rights;
}

function nextBoard(board: readonly string[], move: Move): readonly string[] {
	const next = [...board];
	next[move.from] = '';
	next[move.to] = move.promotion || move.piece;
	if (move.flag === 'enPassant') {
		// The captured pawn sits beside the mover, on the mover's start row.
		next[squareAt(rowOf(move.from), colOf(move.to))] = '';
	}
	if (move.flag === 'castle') {
		const row = rowOf(move.from);
		const kingSide = colOf(move.to) === 6;
		const rookFrom = squareAt(row, kingSide ? 7 : 0);
		const rookTo = squareAt(row, kingSide ? 5 : 3);
		next[rookTo] = next[rookFrom] ?? '';
		next[rookFrom] = '';
	}
	return next;
}

export function applyMove(position: Position, move: Move): Position {
	const resetsClock =
		move.piece.toLowerCase() === 'p' || move.captured !== '';
	return {
		board: nextBoard(position.board, move),
		turn: opponent(position.turn),
		castling: nextCastling(position.castling, move),
		epSquare: move.flag === 'double' ? (move.from + move.to) / 2 : -1,
		halfmove: resetsClock ? 0 : position.halfmove + 1,
		fullmove: position.fullmove + (position.turn === 'b' ? 1 : 0),
	};
}

function keepLegal(
	position: Position,
	moves: readonly Move[],
): readonly Move[] {
	return moves.filter(move => {
		const next = applyMove(position, move);
		const king = kingSquare(next.board, position.turn);
		return !isSquareAttacked({
			board: next.board,
			square: king,
			by: next.turn,
		});
	});
}

export function legalMoves(position: Position): readonly Move[] {
	return keepLegal(position, pseudoLegalMoves(position));
}

// Captures only, checked for legality after the filter: the quiescence
// search calls this at every leaf, where most moves are quiet.
export function legalCaptures(position: Position): readonly Move[] {
	const captures = pseudoLegalMoves(position).filter(
		move => move.captured !== '',
	);
	return keepLegal(position, captures);
}
