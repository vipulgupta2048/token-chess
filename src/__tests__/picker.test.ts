import {describe, expect, it} from 'vitest';
import {
	BACK,
	BACK_OPTION,
	MORE,
	movesFrom,
	pageOf,
	pieceOptions,
	targetOptions,
} from '../picker.js';
import {type Position, parseFen, START_FEN} from '../position.js';

function position(fen: string): Position {
	const parsed = parseFen(fen);
	if (!parsed) throw new Error(`bad fen ${fen}`);
	return parsed;
}

describe('pieceOptions', () => {
	it('lists only pieces that can move, pawns first', () => {
		const labels = pieceOptions(position(START_FEN)).map(item => item.label);
		expect(labels).toEqual([
			'a2',
			'b2',
			'c2',
			'd2',
			'e2',
			'f2',
			'g2',
			'h2',
			'Nb1',
			'Ng1',
		]);
	});
});

describe('targetOptions', () => {
	it('labels with SAN and carries a playable coordinate move', () => {
		expect(targetOptions(position(START_FEN), 'g1')).toEqual([
			{label: 'Nf3', value: 'g1f3'},
			{label: 'Nh3', value: 'g1h3'},
		]);
	});

	it('offers each promotion', () => {
		const board = position('8/4P3/8/8/8/8/k7/4K3 w - - 0 1');
		expect(movesFrom(board, 'e7')).toHaveLength(4);
		expect(targetOptions(board, 'e7').map(item => item.value)).toContain(
			'e7e8n',
		);
	});
});

describe('pageOf', () => {
	const options = pieceOptions(position(START_FEN));
	const drawnWidth = (items: readonly {label: string}[]): number =>
		items.map(item => `○ ${item.label}`).join('  ').length;

	it('shows everything, without more, when it fits', () => {
		const page = pageOf({options, page: 0, width: 80, tail: []});
		expect(page).toEqual(options);
	});

	it('pages a list too wide for the pane, and every page fits', () => {
		const width = 30;
		const seen = new Set<string>();
		for (let index = 0; index < options.length; index++) {
			const page = pageOf({options, page: index, width, tail: [BACK_OPTION]});
			expect(drawnWidth(page)).toBeLessThanOrEqual(width);
			expect(page.map(item => item.value)).toContain(MORE);
			expect(page.map(item => item.value)).toContain(BACK);
			for (const item of page) seen.add(item.value);
		}
		for (const item of options) expect(seen).toContain(item.value);
	});

	it('wraps back to the first page', () => {
		const first = pageOf({options, page: 0, width: 30, tail: []});
		const pages = new Set<string>();
		for (let index = 0; index < 10; index++) {
			const page = pageOf({options, page: index, width: 30, tail: []});
			pages.add(page[0]?.value ?? '');
		}
		expect(pages.size).toBeLessThan(10);
		expect(pages).toContain(first[0]?.value);
	});
});
