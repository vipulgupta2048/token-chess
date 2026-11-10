// Board rendering as plain ANSI lines, the shape both `cmd.addRenderer` and a
// pane take. Like a printed diagram, white pieces are hollow and black pieces
// solid, both in dark ink on light squares: terminals with a minimum-contrast
// setting recolor a white piece on a light square, but leave this alone. The
// solid pawn ♟ has an emoji form, so it carries the text variation selector.

import {
	type Color,
	parseFen,
	squareAt,
	squareName,
} from './position.js';

export interface BoardView {
	readonly fen: string;
	readonly player: Color;
	readonly highlight: readonly number[];
	// The square of a king in check, drawn in red.
	readonly checked?: number;
	// Empty squares the picked piece can reach, drawn with a dot.
	readonly dots?: readonly number[];
	readonly heading: string;
	readonly notes: readonly string[];
}

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const INK = '\x1b[38;5;16m';
const RESET_FOREGROUND = '\x1b[39m';

// Keyed by FEN letter: uppercase is white.
const GLYPHS: Readonly<Record<string, string>> = {
	K: '♔',
	Q: '♕',
	R: '♖',
	B: '♗',
	N: '♘',
	P: '♙',
	k: '♚',
	q: '♛',
	r: '♜',
	b: '♝',
	n: '♞',
	p: '♟︎',
};


const FORWARD: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7];
const BACKWARD: readonly number[] = [7, 6, 5, 4, 3, 2, 1, 0];

// Rows and columns in screen order: the player's own pieces sit at the bottom.
function screenOrder(player: Color): readonly number[] {
	return player === 'b' ? BACKWARD : FORWARD;
}

// A terminal cell is about twice as tall as it is wide, so a square is five
// cells across and two rows down: half a row above the piece, its row, and
// half a row below. The half rows are ▀ and ▄ blocks shared by neighbouring
// ranks, which keeps each piece centred in a square-looking square.
const SQUARE_WIDTH = 5;
const UPPER_HALF = '▀';
const LOWER_HALF = '▄';

// 256-color codes for one square.
function squareColor(params: {
	row: number;
	col: number;
	view: BoardView;
}): number {
	const {row, col, view} = params;
	const square = squareAt(row, col);
	const light = (row + col) % 2 === 0;
	if (view.checked === square) return light ? 210 : 167;
	if (view.highlight.includes(square)) return light ? 150 : 107;
	return light ? 223 : 180;
}

function background(color: number): string {
	return `\x1b[48;5;${color}m`;
}

function foreground(color: number): string {
	return `\x1b[38;5;${color}m`;
}

function cell(piece: string, hasDot: boolean): string {
	const pad = ' '.repeat((SQUARE_WIDTH - 1) / 2);
	if (piece === '')
		return hasDot
			? `${pad}${INK}•${RESET_FOREGROUND}${pad}`
			: ' '.repeat(SQUARE_WIDTH);
	return `${pad}${INK}${GLYPHS[piece] ?? '?'}${RESET_FOREGROUND}${pad}`;
}

function rankLine(params: {
	board: readonly string[];
	row: number;
	view: BoardView;
}): string {
	const {board, row, view} = params;
	const cells = screenOrder(view.player).map(col => {
		const square = squareAt(row, col);
		const color = squareColor({row, col, view});
		const hasDot = view.dots?.includes(square) === true;
		return `${background(color)}${cell(board[square] ?? '', hasDot)}${RESET}`;
	});
	return ` ${DIM}${8 - row}${RESET} ${cells.join('')}`;
}

// The half rows around a rank: `above` paints the lower half of each cell in
// the rank below it, `below` the upper half in the rank above it. Either may
// be the board's edge, where the other half stays the pane's own background.
function edgeLine(params: {
	above?: number;
	below?: number;
	view: BoardView;
}): string {
	const {above, below, view} = params;
	const cells = screenOrder(view.player).map(col => {
		const block = (glyph: string): string => glyph.repeat(SQUARE_WIDTH);
		if (above === undefined && below !== undefined)
			return `${foreground(squareColor({row: below, col, view}))}${block(LOWER_HALF)}`;
		if (above !== undefined && below === undefined)
			return `${foreground(squareColor({row: above, col, view}))}${block(UPPER_HALF)}`;
		if (above === undefined || below === undefined) return '';
		const top = squareColor({row: above, col, view});
		const bottom = squareColor({row: below, col, view});
		return `${foreground(top)}${background(bottom)}${block(UPPER_HALF)}`;
	});
	return `   ${cells.join('')}${RESET}`;
}

// The eight ranks and the file letters: the pane's form.
export function renderBoardLines(view: BoardView): readonly string[] {
	const position = parseFen(view.fen);
	if (!position) return [`LLMChess: unreadable position ${view.fen}`];
	const order = screenOrder(view.player);
	const pad = ' '.repeat((SQUARE_WIDTH - 1) / 2);
	const files = order.map(
		col => `${pad}${squareName(squareAt(7, col))[0]}${pad}`,
	);
	const ranks = order.flatMap((row, index) => [
		rankLine({board: position.board, row, view}),
		edgeLine({above: row, below: order[index + 1], view}),
	]);
	return [
		edgeLine({below: order[0], view}),
		...ranks,
		`   ${DIM}${files.join('')}${RESET}`,
	];
}

// The feed's form, for hosts without panes: one self-contained entry per turn.
export function renderBoard(view: BoardView): readonly string[] {
	return [
		view.heading,
		...renderBoardLines(view),
		'',
		...view.notes.map(note => ` ${note}`),
	];
}

// Greedy word wrap for plain text, so a long message stays inside a pane.
export function wrapText(text: string, width: number): readonly string[] {
	const lines: string[] = [];
	for (const paragraph of text.split('\n')) {
		let line = '';
		for (const word of paragraph.split(' ')) {
			if (line && line.length + 1 + word.length > width) {
				lines.push(line);
				line = word;
			} else {
				line = line ? `${line} ${word}` : word;
			}
		}
		lines.push(line);
	}
	return lines;
}

export function bold(text: string): string {
	return `${BOLD}${text}${RESET}`;
}

export function dim(text: string): string {
	return `${DIM}${text}${RESET}`;
}
