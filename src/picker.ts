// The arrow-key way to move: pick a piece, then pick where it goes. A pane's
// `select` draws on one line and never wraps, so long lists split into pages
// that fit the pane, with a `more` option to step through them.

import {legalMoves, type Move} from './moves.js';
import {colOf, type Position, squareName} from './position.js';
import {toSan, toUci} from './san.js';

export interface PickOption {
	readonly label: string;
	readonly value: string;
}

export const MORE = 'more';
export const BACK = 'back';
export const MENU = 'menu';

const MORE_OPTION: PickOption = {label: 'more ›', value: MORE};
export const BACK_OPTION: PickOption = {label: '‹ back', value: BACK};
export const MENU_OPTION: PickOption = {label: '≡ menu', value: MENU};
const KIND_ORDER = 'pnbrqk';
// A select draws each option as `○ label`, two spaces apart.
const OPTION_CHROME = 4;

function kindRank(move: Move): number {
	return KIND_ORDER.indexOf(move.piece.toLowerCase());
}

function pieceLabel(move: Move): string {
	const square = squareName(move.from);
	const kind = move.piece.toUpperCase();
	return kind === 'P' ? square : `${kind}${square}`;
}

// Every piece that can move: pawns first, then up to the king, a-file first.
export function pieceOptions(position: Position): readonly PickOption[] {
	const firsts = new Map<number, Move>();
	for (const move of legalMoves(position)) {
		if (!firsts.has(move.from)) firsts.set(move.from, move);
	}
	return [...firsts.values()]
		.sort(
			(a, b) =>
				kindRank(a) - kindRank(b) || colOf(a.from) - colOf(b.from),
		)
		.map(move => ({label: pieceLabel(move), value: squareName(move.from)}));
}

export function movesFrom(position: Position, from: string): readonly Move[] {
	return legalMoves(position).filter(
		move => squareName(move.from) === from,
	);
}

export function targetOptions(
	position: Position,
	from: string,
): readonly PickOption[] {
	return movesFrom(position, from).map(move => ({
		label: toSan(position, move),
		value: toUci(move),
	}));
}

function optionWidth(option: PickOption): number {
	return option.label.length + OPTION_CHROME;
}

function splitPages(params: {
	options: readonly PickOption[];
	width: number;
}): readonly (readonly PickOption[])[] {
	const pages: PickOption[][] = [];
	let used = 0;
	for (const option of params.options) {
		const page = pages[pages.length - 1];
		if (page && used + optionWidth(option) <= params.width) {
			page.push(option);
			used += optionWidth(option);
		} else {
			pages.push([option]);
			used = optionWidth(option);
		}
	}
	return pages;
}

// One page of options that fits `width`, with room kept for `more` and the
// `tail` options that end every page. `page` wraps around.
export function pageOf(params: {
	options: readonly PickOption[];
	page: number;
	width: number;
	tail: readonly PickOption[];
}): readonly PickOption[] {
	const {options, page, width, tail} = params;
	const tailWidth = tail.reduce((sum, item) => sum + optionWidth(item), 0);
	const all = splitPages({options, width: width - tailWidth});
	if (all.length <= 1) return [...options, ...tail];
	const pages = splitPages({
		options,
		width: width - tailWidth - optionWidth(MORE_OPTION),
	});
	const current = pages[page % pages.length] ?? [];
	return [...current, MORE_OPTION, ...tail];
}
