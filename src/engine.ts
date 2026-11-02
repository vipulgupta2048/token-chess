// A small deterministic engine: iterative-deepening negamax with alpha-beta,
// a capture-only quiescence search, MVV-LVA move ordering, and a material +
// piece-square evaluation. Same position and level always give the same move.
//
// The search is bounded by a node budget, not a clock, so the same position
// and level give the same move on any machine. It runs inside the TUI
// process, so it yields to the event loop between root moves and the agent's
// stream keeps painting while the engine thinks.

import {
	applyMove,
	isInCheck,
	legalCaptures,
	legalMoves,
	type Move,
} from './moves.js';
import {colOf, colorOf, type Position, rowOf} from './position.js';

export interface EngineLevel {
	readonly maxDepth: number;
	readonly maxNodes: number;
}

export interface EngineResult {
	readonly move: Move;
	readonly score: number;
	readonly depth: number;
	readonly nodes: number;
}

interface SearchState {
	nodes: number;
	readonly maxNodes: number;
}

const MATE = 100_000;

export const LEVELS: readonly EngineLevel[] = [
	{maxDepth: 1, maxNodes: 1_000},
	{maxDepth: 2, maxNodes: 4_000},
	{maxDepth: 3, maxNodes: 12_000},
	{maxDepth: 4, maxNodes: 30_000},
	{maxDepth: 5, maxNodes: 60_000},
];

const VALUES: Readonly<Record<string, number>> = {
	p: 100,
	n: 320,
	b: 330,
	r: 500,
	q: 900,
	k: 0,
};

// Piece-square tables from white's side, row 0 = rank 8 (Michniewski's
// "simplified evaluation function").
const TABLES: Readonly<Record<string, readonly number[]>> = {
	p: [
		0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30,
		30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5,
		-5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0,
		0, 0, 0, 0,
	],
	n: [
		-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40,
		-30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0,
		15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5,
		5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50,
	],
	b: [
		-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10,
		0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10,
		10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5,
		-10, -20, -10, -10, -10, -10, -10, -10, -20,
	],
	r: [
		0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0,
		0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0,
		0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0,
	],
	q: [
		-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10,
		0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0,
		-5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10,
		-10, -5, -5, -10, -10, -20,
	],
	k: [
		-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40,
		-40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50,
		-50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20,
		-20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0,
		0, 10, 30, 20,
	],
};

function pieceScore(piece: string, square: number): number {
	const kind = piece.toLowerCase();
	// Black reads the table mirrored top to bottom.
	const index =
		colorOf(piece) === 'w'
			? square
			: (7 - rowOf(square)) * 8 + colOf(square);
	return (VALUES[kind] ?? 0) + (TABLES[kind]?.[index] ?? 0);
}

// Score from the side to move's point of view: positive is good for them.
export function evaluate(position: Position): number {
	let white = 0;
	for (let square = 0; square < 64; square++) {
		const piece = position.board[square] ?? '';
		if (piece === '') continue;
		const score = pieceScore(piece, square);
		white += colorOf(piece) === 'w' ? score : -score;
	}
	return position.turn === 'w' ? white : -white;
}

function orderScore(move: Move): number {
	const victim = VALUES[move.captured.toLowerCase()] ?? 0;
	const attacker = VALUES[move.piece.toLowerCase()] ?? 0;
	const promotion = move.promotion ? 800 : 0;
	return victim * 10 - attacker / 10 + promotion;
}

function ordered(moves: readonly Move[]): readonly Move[] {
	return [...moves].sort((a, b) => orderScore(b) - orderScore(a));
}

function outOfBudget(state: SearchState): boolean {
	return state.nodes > state.maxNodes;
}

function quiesce(params: {
	position: Position;
	alpha: number;
	beta: number;
	state: SearchState;
}): number {
	const {position, beta, state} = params;
	state.nodes++;
	const standPat = evaluate(position);
	if (standPat >= beta) return beta;
	let alpha = Math.max(params.alpha, standPat);
	if (outOfBudget(state)) return alpha;
	for (const move of ordered(legalCaptures(position))) {
		const score = -quiesce({
			position: applyMove(position, move),
			alpha: -beta,
			beta: -alpha,
			state,
		});
		if (score >= beta) return beta;
		alpha = Math.max(alpha, score);
	}
	return alpha;
}

function negamax(params: {
	position: Position;
	depth: number;
	ply: number;
	alpha: number;
	beta: number;
	state: SearchState;
}): number {
	const {position, depth, ply, beta, state} = params;
	// Leaves go straight to quiescence: generating every legal move just to
	// spot a mate on the horizon would cost more than the whole leaf.
	if (depth <= 0 || outOfBudget(state))
		return quiesce({position, alpha: params.alpha, beta, state});
	state.nodes++;
	const moves = legalMoves(position);
	if (moves.length === 0) return isInCheck(position) ? -MATE + ply : 0;
	if (position.halfmove >= 100) return 0;
	let alpha = params.alpha;
	for (const move of ordered(moves)) {
		if (outOfBudget(state)) break;
		const score = -negamax({
			position: applyMove(position, move),
			depth: depth - 1,
			ply: ply + 1,
			alpha: -beta,
			beta: -alpha,
			state,
		});
		if (score >= beta) return beta;
		alpha = Math.max(alpha, score);
	}
	return alpha;
}

function yieldToEventLoop(): Promise<void> {
	return new Promise(resolve => setImmediate(resolve));
}

interface RootSearch {
	readonly move: Move;
	readonly score: number;
	readonly complete: boolean;
}

async function searchRoot(params: {
	position: Position;
	moves: readonly Move[];
	depth: number;
	state: SearchState;
}): Promise<RootSearch | undefined> {
	const {position, moves, depth, state} = params;
	let best: RootSearch | undefined;
	let alpha = -MATE - 1;
	for (const move of moves) {
		await yieldToEventLoop();
		if (outOfBudget(state)) return best && {...best, complete: false};
		const score = -negamax({
			position: applyMove(position, move),
			depth: depth - 1,
			ply: 1,
			alpha: -MATE - 1,
			beta: -alpha,
			state,
		});
		if (score <= alpha) continue;
		alpha = score;
		best = {move, score, complete: true};
	}
	return best;
}

// Root moves for the next depth: last depth's best first, the rest in the
// usual capture-first order. Searching the best line first prunes the most.
function rootOrder(
	moves: readonly Move[],
	best: Move | undefined,
): readonly Move[] {
	const rest = ordered(moves.filter(move => move !== best));
	return best ? [best, ...rest] : rest;
}

export async function chooseMove(
	position: Position,
	level: EngineLevel,
): Promise<EngineResult | undefined> {
	const moves = legalMoves(position);
	const first = moves[0];
	if (!first) return undefined;
	const state: SearchState = {nodes: 0, maxNodes: level.maxNodes};
	let result: EngineResult = {move: first, score: 0, depth: 0, nodes: 0};
	for (let depth = 1; depth <= level.maxDepth; depth++) {
		const root = await searchRoot({
			position,
			moves: rootOrder(moves, result.move),
			depth,
			state,
		});
		// A depth cut short by the budget still counts: it searched last
		// depth's best move first, so whatever it kept beat that move.
		if (root)
			result = {
				move: root.move,
				score: root.score,
				depth,
				nodes: state.nodes,
			};
		if (!root?.complete || Math.abs(result.score) > MATE - 100) break;
	}
	return {...result, nodes: state.nodes};
}
