// Board state and FEN. The board is 64 squares in FEN order: index 0 is a8,
// index 63 is h1. A piece is one FEN letter (uppercase white, lowercase black)
// and an empty square is ''. Every function here returns new data; nothing
// mutates a position in place.

export type Color = 'w' | 'b';

export interface Position {
	readonly board: readonly string[];
	readonly turn: Color;
	readonly castling: string;
	readonly epSquare: number;
	readonly halfmove: number;
	readonly fullmove: number;
}

export const START_FEN =
	'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const FILES = 'abcdefgh';

export function rowOf(square: number): number {
	return square >> 3;
}

export function colOf(square: number): number {
	return square & 7;
}

export function squareAt(row: number, col: number): number {
	if (row < 0 || row > 7 || col < 0 || col > 7) return -1;
	return row * 8 + col;
}

export function squareName(square: number): string {
	return `${FILES[colOf(square)]}${8 - rowOf(square)}`;
}

export function parseSquare(name: string): number {
	if (!/^[a-h][1-8]$/.test(name)) return -1;
	return squareAt(8 - Number(name[1]), FILES.indexOf(name[0] ?? ''));
}

export function colorOf(piece: string): Color | undefined {
	if (piece === '') return undefined;
	return piece === piece.toUpperCase() ? 'w' : 'b';
}

export function opponent(color: Color): Color {
	return color === 'w' ? 'b' : 'w';
}

function parseRow(row: string): readonly string[] | undefined {
	const squares: string[] = [];
	for (const char of row) {
		if (/[1-8]/.test(char)) {
			squares.push(...Array<string>(Number(char)).fill(''));
			continue;
		}
		if (!/[pnbrqkPNBRQK]/.test(char)) return undefined;
		squares.push(char);
	}
	return squares.length === 8 ? squares : undefined;
}

export function parseFen(fen: string): Position | undefined {
	const [placement, turn, castling, ep, half, full] = fen.trim().split(/\s+/);
	if (!placement || (turn !== 'w' && turn !== 'b')) return undefined;
	const rows = placement.split('/');
	if (rows.length !== 8) return undefined;
	const board: string[] = [];
	for (const row of rows) {
		const squares = parseRow(row);
		if (!squares) return undefined;
		board.push(...squares);
	}
	return {
		board,
		turn,
		castling: castling && /^(-|K?Q?k?q?)$/.test(castling) ? castling : '-',
		epSquare: ep && ep !== '-' ? parseSquare(ep) : -1,
		halfmove: Number(half ?? 0) || 0,
		fullmove: Number(full ?? 1) || 1,
	};
}

function placementOf(board: readonly string[]): string {
	const rows: string[] = [];
	for (let row = 0; row < 8; row++) {
		let text = '';
		let empty = 0;
		for (let col = 0; col < 8; col++) {
			const piece = board[row * 8 + col] ?? '';
			if (piece === '') {
				empty++;
				continue;
			}
			text += (empty > 0 ? String(empty) : '') + piece;
			empty = 0;
		}
		rows.push(text + (empty > 0 ? String(empty) : ''));
	}
	return rows.join('/');
}

export function toFen(position: Position): string {
	const ep = position.epSquare >= 0 ? squareName(position.epSquare) : '-';
	return [
		placementOf(position.board),
		position.turn,
		position.castling || '-',
		ep,
		position.halfmove,
		position.fullmove,
	].join(' ');
}

// The part of the FEN that decides threefold repetition: pieces, side to move,
// castling rights and en passant square, without the move counters.
export function repetitionKey(position: Position): string {
	return toFen(position).split(' ').slice(0, 4).join(' ');
}
