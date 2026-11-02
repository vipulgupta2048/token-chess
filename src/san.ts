// Standard Algebraic Notation: format a legal move as SAN (`Nf3`, `exd5`,
// `O-O`, `e8=Q#`) and resolve what a player typed (SAN or UCI like `e2e4`)
// back to one legal move.

import {applyMove, isInCheck, legalMoves, type Move} from './moves.js';
import {colOf, type Position, rowOf, squareName} from './position.js';

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

function normalize(text: string): string {
	return text
		.trim()
		.replace(/[+#!?]+$/, '')
		.replace(/0/g, 'O')
		.replace(/^o-o/i, 'O-O')
		.replace(/(\d)([qrbn])$/i, '$1=$2')
		.replace(/=([qrbn])$/, (_, kind: string) => `=${kind.toUpperCase()}`);
}

function stripSuffix(san: string): string {
	return san.replace(/[+#]$/, '');
}

// `Nf3` as typed, then the same with its piece letter uppercased so `nf3`
// works too. A lowercase `b` stays a pawn on the b-file first: `bxc3` is
// tried as typed before it could ever mean a bishop.
function sanCandidates(text: string): readonly string[] {
	const typed = normalize(text);
	const first = typed[0] ?? '';
	if (!/[nbrqk]/.test(first)) return [typed];
	return [typed, first.toUpperCase() + typed.slice(1)];
}

export function parseMove(position: Position, text: string): Move | undefined {
	const moves = legalMoves(position);
	const uci = text.trim().toLowerCase();
	if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) {
		const byUci = moves.find(move => toUci(move) === uci);
		if (byUci) return byUci;
	}
	for (const candidate of sanCandidates(text)) {
		const match = moves.find(
			move => stripSuffix(toSan(position, move)) === candidate,
		);
		if (match) return match;
	}
	return undefined;
}
