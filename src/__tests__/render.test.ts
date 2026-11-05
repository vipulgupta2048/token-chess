import {describe, expect, it} from 'vitest';
import {START_FEN} from '../position.js';
import {
	type BoardView,
	renderBoard,
	renderPanel,
	wrapText,
} from '../render.js';

const view: BoardView = {
	fen: START_FEN,
	player: 'w',
	highlight: [],
	heading: 'heading',
	notes: ['note'],
};

// biome-ignore lint/suspicious/noControlCharactersInRegex: strips ANSI codes
const plain = (line: string): string => line.replace(/\x1b\[[0-9;]*m/g, '');

describe('renderBoard', () => {
	it('draws white hollow and black solid, in the same dark ink', () => {
		const lines = renderBoard(view);
		expect(plain(lines[1] ?? '')).toContain('♚');
		expect(plain(lines[8] ?? '')).toContain('♔');
		expect(lines.join('\n')).not.toContain('38;5;231');
	});

	it('marks a checked king and the last move in their own colors', () => {
		const normal = renderBoard(view).join('\n');
		const marked = renderBoard({...view, checked: 60, highlight: [52]}).join(
			'\n',
		);
		expect(normal).not.toContain('48;5;167');
		expect(marked).toContain('48;5;167');
		expect(marked).toContain('48;5;150');
	});

	it('flips the board for black', () => {
		const lines = renderBoard({...view, player: 'b'}).map(plain);
		expect(lines[1]?.trim().startsWith('1')).toBe(true);
	});
});

describe('renderPanel', () => {
	const side = ['1. e4 e5', 'Level 3'];

	it('puts the side lines beside the board when there is room', () => {
		const lines = renderPanel({view, side, width: 60}).map(plain);
		expect(lines).toHaveLength(9);
		expect(lines[0]).toMatch(/^ 8 .*1\. e4 e5$/);
		expect(lines[2]).toMatch(/^ 6 /);
	});

	it('stacks them under the board in a narrow pane', () => {
		const lines = renderPanel({view, side, width: 40}).map(plain);
		expect(lines).toHaveLength(11);
		expect(lines[9]).toBe('1. e4 e5');
	});
});

describe('wrapText', () => {
	it('wraps on words and keeps newlines', () => {
		expect(wrapText('one two three', 7)).toEqual(['one two', 'three']);
		expect(wrapText('a\nb', 7)).toEqual(['a', 'b']);
	});
});
