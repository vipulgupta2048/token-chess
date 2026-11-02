// Board rendering as plain ANSI lines, the shape `cmd.addRenderer` takes.
// Grayscale only. Pieces use the outline glyphs (♔♕♖♗♘♙) for both sides and
// color tells them apart: the filled pawn ♟ has an emoji form that some
// terminals draw double width, which would break the grid.

import {
	type Color,
	colorOf,
	parseFen,
	squareAt,
	squareName,
} from './position.js';

export interface BoardView {
	readonly fen: string;
	readonly player: Color;
	readonly highlight: readonly number[];
	readonly heading: string;
	readonly notes: readonly string[];
}

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const WHITE_PIECE = '\x1b[1;38;5;231m';
const BLACK_PIECE = '\x1b[38;5;16m';

const GLYPHS: Readonly<Record<string, string>> = {
	k: '♔',
	q: '♕',
	r: '♖',
	b: '♗',
	n: '♘',
	p: '♙',
};

const FORWARD: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7];
const BACKWARD: readonly number[] = [7, 6, 5, 4, 3, 2, 1, 0];

// Rows and columns in screen order: the player's own pieces sit at the bottom.
function screenOrder(player: Color): readonly number[] {
	return player === 'b' ? BACKWARD : FORWARD;
}

function squareBackground(params: {
	row: number;
	col: number;
	lit: boolean;
}): string {
	const light = (params.row + params.col) % 2 === 0;
	if (params.lit) return light ? '\x1b[48;5;253m' : '\x1b[48;5;247m';
	return light ? '\x1b[48;5;250m' : '\x1b[48;5;243m';
}

function cell(piece: string): string {
	if (piece === '') return '   ';
	const color = colorOf(piece) === 'w' ? WHITE_PIECE : BLACK_PIECE;
	return ` ${color}${GLYPHS[piece.toLowerCase()] ?? '?'} `;
}

function rankLine(params: {
	board: readonly string[];
	row: number;
	view: BoardView;
}): string {
	const {board, row, view} = params;
	const cells = screenOrder(view.player).map(col => {
		const square = squareAt(row, col);
		const lit = view.highlight.includes(square);
		const background = squareBackground({row, col, lit});
		return `${background}${cell(board[square] ?? '')}${RESET}`;
	});
	return ` ${DIM}${8 - row}${RESET} ${cells.join('')}`;
}

export function renderBoard(view: BoardView): readonly string[] {
	const position = parseFen(view.fen);
	if (!position) return [`token-chess: unreadable position ${view.fen}`];
	const order = screenOrder(view.player);
	const files = order.map(col => ` ${squareName(squareAt(7, col))[0]} `);
	return [
		view.heading,
		...order.map(row => rankLine({board: position.board, row, view})),
		`   ${DIM}${files.join('')}${RESET}`,
		'',
		...view.notes.map(note => ` ${note}`),
	];
}

export function bold(text: string): string {
	return `${BOLD}${text}${RESET}`;
}

export function dim(text: string): string {
	return `${DIM}${text}${RESET}`;
}
