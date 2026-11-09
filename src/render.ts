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
export const GLYPHS: Readonly<Record<string, string>> = {
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

// Rank label, a space, then eight squares of three columns.
const BOARD_WIDTH = 27;
const COLUMN_GAP = '     ';
const MIN_SIDE_WIDTH = 16;

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
	checked: boolean;
}): string {
	const light = (params.row + params.col) % 2 === 0;
	if (params.checked) return light ? '\x1b[48;5;210m' : '\x1b[48;5;167m';
	if (params.lit) return light ? '\x1b[48;5;150m' : '\x1b[48;5;107m';
	return light ? '\x1b[48;5;223m' : '\x1b[48;5;180m';
}

function cell(piece: string, hasDot: boolean): string {
	if (piece === '') return hasDot ? ` ${INK}•${RESET_FOREGROUND} ` : '   ';
	return ` ${INK}${GLYPHS[piece] ?? '?'}${RESET_FOREGROUND} `;
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
		const checked = view.checked === square;
		const background = squareBackground({row, col, lit, checked});
		const hasDot = view.dots?.includes(square) === true;
		return `${background}${cell(board[square] ?? '', hasDot)}${RESET}`;
	});
	return ` ${DIM}${8 - row}${RESET} ${cells.join('')}`;
}

// The eight ranks and the file letters.
function boardLines(view: BoardView): readonly string[] {
	const position = parseFen(view.fen);
	if (!position) return [`token-chess: unreadable position ${view.fen}`];
	const order = screenOrder(view.player);
	const files = order.map(col => ` ${squareName(squareAt(7, col))[0]} `);
	return [
		...order.map(row => rankLine({board: position.board, row, view})),
		`   ${DIM}${files.join('')}${RESET}`,
	];
}

// The feed's form, for hosts without panes: one self-contained entry per turn.
export function renderBoard(view: BoardView): readonly string[] {
	return [
		view.heading,
		...boardLines(view),
		'',
		...view.notes.map(note => ` ${note}`),
	];
}

// The pane's form: the board with `side` beside it, or below it when the pane
// is too narrow for both. Side lines are short, styled, and never wrap.
export function renderPanel(params: {
	view: BoardView;
	side: readonly string[];
	width: number;
}): readonly string[] {
	const {view, side, width} = params;
	const board = boardLines(view);
	if (width - BOARD_WIDTH - COLUMN_GAP.length < MIN_SIDE_WIDTH)
		return [...board, ...side];
	const room = width - BOARD_WIDTH - COLUMN_GAP.length;
	return board.map((line, index) => {
		const beside = side[index];
		return beside ? `${line}${COLUMN_GAP}${fitWidth(beside, room)}` : line;
	});
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: matches ANSI codes
const ANSI = /\x1b\[[0-9;]*m/g;

// A line cut to `width` columns with an ellipsis. A cut line loses its style.
function fitWidth(line: string, width: number): string {
	const plain = line.replace(ANSI, '');
	if ([...plain].length <= width) return line;
	return `${[...plain].slice(0, Math.max(0, width - 1)).join('')}…`;
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
