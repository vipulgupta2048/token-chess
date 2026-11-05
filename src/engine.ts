// A small deterministic engine: iterative-deepening negamax with alpha-beta,
// check extensions, a quiescence search over captures and check evasions,
// repetition awareness, MVV-LVA move ordering, and an evaluation of material,
// piece-square tables, passed pawns and endgame king play. The same position,
// game history and level always give the same move.
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
import {
	colOf,
	colorOf,
	type Position,
	repetitionKey,
	rowOf,
} from './position.js';

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
	maxNodes: number;
	// Positions from the last irreversible move up to the current search node.
	readonly seen: string[];
}

const MATE = 100_000;
// Check extensions and evasions stop here, so a run of checks can't run away.
const MAX_PLY = 32;

export const LEVELS: readonly EngineLevel[] = [
	{maxDepth: 1, maxNodes: 1_000},
	{maxDepth: 2, maxNodes: 10_000},
	{maxDepth: 3, maxNodes: 30_000},
	{maxDepth: 4, maxNodes: 60_000},
	{maxDepth: 5, maxNodes: 120_000},
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

// The king heads for the center once the pieces are off.
const KING_ENDGAME: readonly number[] = [
	-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30,
	-30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30,
	-10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30,
	0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50,
];

// A full board is phase 24; a bare endgame is phase 0.
const FULL_PHASE = 24;
const PHASE: Readonly<Record<string, number>> = {n: 1, b: 1, r: 2, q: 4};
// By ranks a passed pawn has advanced from its starting square.
const PASSED_BONUS: readonly number[] = [0, 10, 20, 35, 60, 100];
// A lead this big, against no pawns, is a win to convert: see `mopUp`.
const MOP_UP_LEAD = 400;

// Black reads the tables mirrored top to bottom.
function tableIndex(piece: string, square: number): number {
	return colorOf(piece) === 'w'
		? square
		: (7 - rowOf(square)) * 8 + colOf(square);
}

function pieceScore(piece: string, square: number): number {
	const kind = piece.toLowerCase();
	return (
		(VALUES[kind] ?? 0) +
		(TABLES[kind]?.[tableIndex(piece, square)] ?? 0)
	);
}

function kingScore(params: {
	king: string;
	square: number;
	phase: number;
}): number {
	const {king, square, phase} = params;
	const index = tableIndex(king, square);
	const middle = TABLES.k?.[index] ?? 0;
	const end = KING_ENDGAME[index] ?? 0;
	return (middle * phase + end * (FULL_PHASE - phase)) / FULL_PHASE;
}

function passedScore(advanced: number, phase: number): number {
	const bonus = PASSED_BONUS[advanced] ?? 0;
	return (bonus * (phase / 2 + FULL_PHASE - phase)) / FULL_PHASE;
}

// Pawns with no enemy pawn ahead on their own or a neighboring file.
function passedPawns(board: readonly string[], phase: number): number {
	const whiteRear = Array<number>(8).fill(-1);
	const blackRear = Array<number>(8).fill(8);
	for (let square = 8; square < 56; square++) {
		const col = colOf(square);
		const row = rowOf(square);
		if (board[square] === 'P') whiteRear[col] = row;
		else if (board[square] === 'p')
			blackRear[col] = Math.min(blackRear[col] ?? 8, row);
	}
	let score = 0;
	for (let square = 8; square < 56; square++) {
		const piece = board[square];
		if (piece !== 'P' && piece !== 'p') continue;
		const col = colOf(square);
		const row = rowOf(square);
		let isPassed = true;
		for (let file = Math.max(0, col - 1); file <= Math.min(7, col + 1); file++) {
			if (piece === 'P' && (blackRear[file] ?? 8) < row) isPassed = false;
			if (piece === 'p' && (whiteRear[file] ?? -1) > row) isPassed = false;
		}
		if (!isPassed) continue;
		score +=
			piece === 'P'
				? passedScore(6 - row, phase)
				: -passedScore(row - 1, phase);
	}
	return score;
}

// How far a square is from the four center squares: 0 to 6.
function centerDistance(square: number): number {
	const row = rowOf(square);
	const col = colOf(square);
	return Math.max(3 - row, row - 4) + Math.max(3 - col, col - 4);
}

// Drive the lone king to the edge and bring your own king up: piece-square
// tables alone can't find the mate in a won ending like king and rook v king.
function mopUp(params: {winner: number; loser: number}): number {
	const {winner, loser} = params;
	const kingGap =
		Math.abs(rowOf(winner) - rowOf(loser)) +
		Math.abs(colOf(winner) - colOf(loser));
	return centerDistance(loser) * 10 + (14 - kingGap) * 4;
}

// Score from the side to move's point of view: positive is good for them.
export function evaluate(position: Position): number {
	const {board} = position;
	let white = 0;
	let phase = 0;
	let material = 0;
	let whiteKing = -1;
	let blackKing = -1;
	let whitePawns = 0;
	let blackPawns = 0;
	for (let square = 0; square < 64; square++) {
		const piece = board[square] ?? '';
		if (piece === '') continue;
		const isWhite = colorOf(piece) === 'w';
		const kind = piece.toLowerCase();
		if (kind === 'k') {
			if (isWhite) whiteKing = square;
			else blackKing = square;
			continue;
		}
		const score = pieceScore(piece, square);
		white += isWhite ? score : -score;
		phase += PHASE[kind] ?? 0;
		material += isWhite ? (VALUES[kind] ?? 0) : -(VALUES[kind] ?? 0);
		if (piece === 'P') whitePawns++;
		if (piece === 'p') blackPawns++;
	}
	phase = Math.min(phase, FULL_PHASE);
	white += kingScore({king: 'K', square: whiteKing, phase});
	white -= kingScore({king: 'k', square: blackKing, phase});
	if (whitePawns + blackPawns > 0) white += passedPawns(board, phase);
	if (material >= MOP_UP_LEAD && blackPawns === 0)
		white += mopUp({winner: whiteKing, loser: blackKing});
	if (material <= -MOP_UP_LEAD && whitePawns === 0)
		white -= mopUp({winner: blackKing, loser: whiteKing});
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

// Nobody can stand pat in check: a check at the leaf is searched out, which is
// also how a mate past the horizon gets seen.
function quiesceEvasions(params: {
	position: Position;
	alpha: number;
	beta: number;
	ply: number;
	state: SearchState;
}): number {
	const {position, beta, ply, state} = params;
	const moves = legalMoves(position);
	if (moves.length === 0) return -MATE + ply;
	let alpha = params.alpha;
	for (const move of ordered(moves)) {
		if (outOfBudget(state)) break;
		const score = -quiesce({
			position: applyMove(position, move),
			alpha: -beta,
			beta: -alpha,
			ply: ply + 1,
			state,
		});
		if (score >= beta) return beta;
		alpha = Math.max(alpha, score);
	}
	return alpha;
}

function quiesce(params: {
	position: Position;
	alpha: number;
	beta: number;
	ply: number;
	state: SearchState;
}): number {
	const {position, beta, ply, state} = params;
	state.nodes++;
	if (ply < MAX_PLY && !outOfBudget(state) && isInCheck(position))
		return quiesceEvasions(params);
	const standPat = evaluate(position);
	if (standPat >= beta) return beta;
	let alpha = Math.max(params.alpha, standPat);
	if (outOfBudget(state)) return alpha;
	for (const move of ordered(legalCaptures(position))) {
		const score = -quiesce({
			position: applyMove(position, move),
			alpha: -beta,
			beta: -alpha,
			ply: ply + 1,
			state,
		});
		if (score >= beta) return beta;
		alpha = Math.max(alpha, score);
	}
	return alpha;
}

interface NodeParams {
	readonly position: Position;
	readonly depth: number;
	readonly ply: number;
	readonly alpha: number;
	readonly beta: number;
	readonly state: SearchState;
}

function searchMoves(
	params: NodeParams & {moves: readonly Move[]; nextDepth: number},
): number {
	const {position, moves, nextDepth, ply, beta, state} = params;
	let alpha = params.alpha;
	for (const move of ordered(moves)) {
		if (outOfBudget(state)) break;
		const score = -negamax({
			position: applyMove(position, move),
			depth: nextDepth,
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

function negamax(params: NodeParams): number {
	const {position, depth, ply, beta, state} = params;
	// A position met before on this line is a draw in the making: a winning
	// side steers away from it, a losing side heads for it. A repeat needs at
	// least two reversible moves, which spares most nodes building the key.
	if (position.halfmove >= 2 && state.seen.includes(repetitionKey(position)))
		return 0;
	const inCheck = ply < MAX_PLY && isInCheck(position);
	if ((depth <= 0 && !inCheck) || outOfBudget(state))
		return quiesce({position, alpha: params.alpha, beta, ply, state});
	state.nodes++;
	const moves = legalMoves(position);
	if (moves.length === 0) return inCheck ? -MATE + ply : 0;
	if (position.halfmove >= 100) return 0;
	state.seen.push(repetitionKey(position));
	const nextDepth = inCheck ? depth : depth - 1;
	const score = searchMoves({...params, moves, nextDepth});
	state.seen.pop();
	return score;
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
		// The budget ran out inside this move, before its refutation was
		// searched, so its score means nothing. Keep what was finished.
		if (outOfBudget(state)) return best && {...best, complete: false};
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

// The positions a repeat could return to: back to the last irreversible move.
function reachablePositions(params: {
	position: Position;
	history: readonly Position[];
}): string[] {
	const {position, history} = params;
	const earlier = history.slice(0, -1).slice(-position.halfmove);
	return [...earlier, position].map(repetitionKey);
}

// `history` is the game so far, ending with `position`.
export async function chooseMove(
	position: Position,
	level: EngineLevel,
	history: readonly Position[] = [position],
): Promise<EngineResult | undefined> {
	const moves = legalMoves(position);
	const first = moves[0];
	if (!first) return undefined;
	const state: SearchState = {
		nodes: 0,
		maxNodes: level.maxNodes,
		seen: reachablePositions({position, history}),
	};
	let result: EngineResult = {move: first, score: 0, depth: 0, nodes: 0};
	for (let depth = 1; depth <= level.maxDepth; depth++) {
		// Depth 1 always finishes, so a busy position at a small budget still
		// gets a searched move, never the first legal one.
		state.maxNodes = depth === 1 ? Number.POSITIVE_INFINITY : level.maxNodes;
		const root = await searchRoot({
			position,
			moves: rootOrder(moves, result.move),
			depth,
			state,
		});
		// A depth cut short by the budget still counts: it searched last
		// depth's best move first, so whatever it finished beat that move.
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
