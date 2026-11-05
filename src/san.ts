// Standard Algebraic Notation: format a legal move as SAN (`Nf3`, `exd5`,
// `O-O`, `e8=Q#`), resolve what a player typed (SAN or coordinates like `e2e4`
// and `e2-e4`) back to one legal move, and explain the ones that don't resolve.

import {applyMove, isInCheck, legalMoves, type Move} from './moves.js';
import {
	colOf,
	colorOf,
	type Position,
	parseSquare,
	rowOf,
	squareName,
} from './position.js';

function disambiguation(position: Position, move: Move): string {
	const rivals = legalMoves(position).filter(
		other =>
			other.piece === move.piece &&
			other.to === move.to &&
			other.from !== move.from,
	);
	if (rivals.length === 0) return '';
	const from = squareName(move.from);
	const sameFile = rivals.some(
		other => colOf(other.from) === colOf(move.from),
	);
	if (!sameFile) return from[0] ?? '';
	const sameRank = rivals.some(
		other => rowOf(other.from) === rowOf(move.from),
	);
	if (!sameRank) return from[1] ?? '';
	return from;
}

function checkSuffix(position: Position, move: Move): string {
	const next = applyMove(position, move);
	if (!isInCheck(next)) return '';
	return legalMoves(next).length === 0 ? '#' : '+';
}

function moveBody(position: Position, move: Move): string {
	if (move.flag === 'castle') return colOf(move.to) === 6 ? 'O-O' : 'O-O-O';
	const to = squareName(move.to);
	const capture = move.captured !== '' ? 'x' : '';
	const kind = move.piece.toUpperCase();
	if (kind !== 'P')
		return `${kind}${disambiguation(position, move)}${capture}${to}`;
	const file = capture ? (squareName(move.from)[0] ?? '') : '';
	const promotion = move.promotion ? `=${move.promotion.toUpperCase()}` : '';
	return `${file}${capture}${to}${promotion}`;
}

export function toSan(position: Position, move: Move): string {
	return moveBody(position, move) + checkSuffix(position, move);
}

export function toUci(move: Move): string {
	const promotion = move.promotion.toLowerCase();
	return `${squareName(move.from)}${squareName(move.to)}${promotion}`;
}

// What was typed without its annotations, spaces or hyphens: `e2 e4`, `e2-e4`
// and `e4!` all reduce to the bare move, in the case it was typed.
function compact(text: string): string {
	return text.replace(/[\s+#!?-]/g, '');
}

function castlingSan(typed: string): string | undefined {
	if (/^[o0]{2}$/i.test(typed)) return 'O-O';
	if (/^[o0]{3}$/i.test(typed)) return 'O-O-O';
	return undefined;
}

function withPromotion(lower: string): string {
	return lower.replace(
		/(\d)=?([qrbn])$/,
		(_, rank: string, kind: string) => `${rank}=${kind.toUpperCase()}`,
	);
}

// The SAN spellings a typed move could mean, likeliest first. Case only says
// which comes first: `bxc3` is the b-pawn before it is a bishop, `BXC3` the
// bishop before the pawn, and `NF3`, `nf3` and `E4` each have one reading.
function sanCandidates(typed: string): readonly string[] {
	const castling = castlingSan(typed);
	if (castling) return [castling];
	const lower = withPromotion(typed.toLowerCase());
	if (!/^[nbrqk]/.test(lower)) return [lower];
	const piece = (lower[0] ?? '').toUpperCase() + lower.slice(1);
	return typed.startsWith(piece[0] ?? '') ? [piece, lower] : [lower, piece];
}

// `e2e4`, `Ng1f3` and `e7e8q`: a move named by both of its squares.
function matchCoordinates(params: {
	moves: readonly Move[];
	typed: string;
}): Move | undefined {
	const parts = /^([kqrbn])?([a-h][1-8])x?([a-h][1-8])=?([qrbn])?$/.exec(
		params.typed.toLowerCase(),
	);
	if (!parts) return undefined;
	const [, kind, from, to, promotion] = parts;
	const uci = `${from}${to}${promotion ?? ''}`;
	const move = params.moves.find(candidate => toUci(candidate) === uci);
	if (kind && move?.piece.toLowerCase() !== kind) return undefined;
	return move;
}

function stripSuffix(san: string): string {
	return san.replace(/[+#]$/, '');
}

function matchMove(position: Position, typed: string): Move | undefined {
	const moves = legalMoves(position);
	const byCoordinates = matchCoordinates({moves, typed});
	if (byCoordinates) return byCoordinates;
	for (const candidate of sanCandidates(typed)) {
		const match = moves.find(
			move => stripSuffix(toSan(position, move)) === candidate,
		);
		if (match) return match;
	}
	return undefined;
}

// A promotion with no piece named (`e8`, `e7e8`) makes a queen.
export function parseMove(position: Position, text: string): Move | undefined {
	const typed = compact(text);
	return matchMove(position, typed) ?? matchMove(position, `${typed}q`);
}

const PIECE_NAMES: Readonly<Record<string, string>> = {
	k: 'king',
	q: 'queen',
	r: 'rook',
	b: 'bishop',
	n: 'knight',
	p: 'pawn',
};

function capitalized(word: string): string {
	return (word[0] ?? '').toUpperCase() + word.slice(1);
}

function explainFromSquare(params: {
	position: Position;
	from: string;
	to: string;
}): string {
	const {position, from, to} = params;
	const piece = position.board[parseSquare(from)] ?? '';
	if (piece === '' || colorOf(piece) !== position.turn)
		return `you have no piece on ${from}.`;
	const name = PIECE_NAMES[piece.toLowerCase()] ?? 'piece';
	const options = legalMoves(position)
		.filter(move => squareName(move.from) === from)
		.map(move => toSan(position, move));
	if (options.length === 0)
		return `the ${name} on ${from} can't move right now.`;
	return `the ${name} on ${from} can't reach ${to}. It can play: ${options.join(' ')}`;
}

// The piece a SAN-looking move names: `Nd5` a knight, `d5` and `bxc3` pawns.
function namedKind(typed: string): string {
	if (/^b([1-8]|x)/.test(typed)) return 'p';
	if (/^[KQRBNkqrbn]/.test(typed)) return (typed[0] ?? '').toLowerCase();
	return 'p';
}

// Why a typed move didn't resolve, in terms of the piece it named, with the
// moves that piece does have so the next try is one glance away.
export function explainIllegal(position: Position, text: string): string {
	const typed = compact(text);
	const moves = legalMoves(position);
	const check = isInCheck(position) ? "You're in check. " : '';
	const allMoves = moves.map(move => toSan(position, move));
	if (castlingSan(typed))
		return `${check}${text} isn't legal: you can't castle that way now.`;
	const coordinates = /^[kqrbn]?([a-h][1-8])x?([a-h][1-8])/i.exec(typed);
	if (coordinates) {
		const reason = explainFromSquare({
			position,
			from: (coordinates[1] ?? '').toLowerCase(),
			to: (coordinates[2] ?? '').toLowerCase(),
		});
		return `${check}${text} isn't legal: ${reason}`;
	}
	const target = /([a-h][1-8])(=?[qrbn])?$/i.exec(typed)?.[1]?.toLowerCase();
	if (!target)
		return `${text} isn't a move. Legal moves: ${allMoves.join(' ')}`;
	const kind = namedKind(typed);
	const name = PIECE_NAMES[kind] ?? 'piece';
	const ofKind = moves.filter(move => move.piece.toLowerCase() === kind);
	const rivals = ofKind.filter(move => squareName(move.to) === target);
	const sans = ofKind.map(move => toSan(position, move));
	if (rivals.length > 1) {
		const named = rivals.map(move => toSan(position, move)).join(' or ');
		return `${text} could mean ${named}. Say which.`;
	}
	if (sans.length === 0)
		return `${check}${text} isn't legal: no ${name} of yours can move. Legal moves: ${allMoves.join(' ')}`;
	return `${check}${text} isn't legal: no ${name} can reach ${target}. ${capitalized(name)} moves: ${sans.join(' ')}`;
}
