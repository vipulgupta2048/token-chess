// What `/chess <args>` asks for, parsed into data before anything acts on it.

import type {Color} from './position.js';

export type Action =
	| {readonly kind: 'show'}
	| {readonly kind: 'help'}
	| {readonly kind: 'new'; readonly player: Color}
	| {readonly kind: 'undo'}
	| {readonly kind: 'resign'}
	| {readonly kind: 'pgn'}
	| {readonly kind: 'level'; readonly level: number}
	| {readonly kind: 'move'; readonly text: string}
	| {readonly kind: 'invalid'; readonly message: string};

export const MAX_LEVEL = 5;
export const DEFAULT_LEVEL = 3;

export const HELP = [
	'/chess              show the board and start typing moves in it',
	'/chess <move>       play a move: e4, Nf3, exd5, O-O, e8=Q or e2 e4',
	'/chess new [black]  new game, you play white unless you say black',
	'/chess undo         take back your last move and the reply',
	`/chess level <1-${MAX_LEVEL}>  engine strength (default 3)`,
	'/chess resign       give up the current game',
	'/chess pgn          copy the game as PGN',
].join('\n');

function parsePlayer(word: string | undefined): Color | undefined {
	if (word === undefined || word === 'white' || word === 'w') return 'w';
	if (word === 'black' || word === 'b') return 'b';
	return undefined;
}

function parseLevel(word: string | undefined): Action {
	const level = Number(word);
	if (Number.isInteger(level) && level >= 1 && level <= MAX_LEVEL)
		return {kind: 'level', level};
	return {kind: 'invalid', message: `Level must be 1 to ${MAX_LEVEL}.`};
}

export function parseAction(args: string): Action {
	const [first, second] = args.trim().split(/\s+/).filter(Boolean);
	if (first === undefined) return {kind: 'show'};
	const word = first.toLowerCase();
	if (word === 'help') return {kind: 'help'};
	if (word === 'undo' || word === 'takeback') return {kind: 'undo'};
	if (word === 'resign') return {kind: 'resign'};
	if (word === 'pgn') return {kind: 'pgn'};
	if (word === 'level') return parseLevel(second);
	if (word !== 'new') return {kind: 'move', text: args.trim()};
	const player = parsePlayer(second?.toLowerCase());
	if (player) return {kind: 'new', player};
	return {
		kind: 'invalid',
		message: 'Pick a side: /chess new white or /chess new black.',
	};
}
