// What `/chess <args>` asks for, parsed into data before anything acts on it.

import type {Opponent} from './game.js';
import type {Color} from './position.js';

export type Action =
	| {readonly kind: 'show'}
	| {readonly kind: 'help'}
	| {
			readonly kind: 'new';
			readonly player: Color;
			readonly opponent?: Opponent;
	  }
	| {readonly kind: 'opponent'; readonly opponent: Opponent}
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
	'/chess new [black] [engine]  new game: white against your session LLM',
	'                    unless you say black, or engine for the built-in one',
	'/chess vs <llm|engine>  switch who plays against you, mid-game too',
	'/chess undo         take back your last move and the reply',
	`/chess level <1-${MAX_LEVEL}>  engine strength (default 3), also the LLM's fallback`,
	'/chess resign       give up the current game',
	'/chess pgn          copy the game as PGN',
].join('\n');

function parsePlayer(word: string): Color | undefined {
	if (word === 'white' || word === 'w') return 'w';
	if (word === 'black' || word === 'b') return 'b';
	return undefined;
}

function parseOpponent(word: string | undefined): Opponent | undefined {
	if (word === 'llm' || word === 'ai' || word === 'model') return 'llm';
	if (word === 'engine' || word === 'bot') return 'engine';
	return undefined;
}

// `new`, then a side and an opponent in either order, each optional.
function parseNew(words: readonly string[]): Action {
	let player: Color = 'w';
	let opponent: Opponent | undefined;
	for (const word of words) {
		const side = parsePlayer(word);
		const rival = parseOpponent(word);
		if (side) player = side;
		else if (rival) opponent = rival;
		else
			return {
				kind: 'invalid',
				message:
					'Try /chess new, /chess new black, or /chess new black engine.',
			};
	}
	return opponent ? {kind: 'new', player, opponent} : {kind: 'new', player};
}

function parseLevel(word: string | undefined): Action {
	const level = Number(word);
	if (Number.isInteger(level) && level >= 1 && level <= MAX_LEVEL)
		return {kind: 'level', level};
	return {kind: 'invalid', message: `Level must be 1 to ${MAX_LEVEL}.`};
}

export function parseAction(args: string): Action {
	const words = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
	const [first, second] = words;
	if (first === undefined) return {kind: 'show'};
	const word = first.toLowerCase();
	if (word === 'help') return {kind: 'help'};
	if (word === 'undo' || word === 'takeback') return {kind: 'undo'};
	if (word === 'resign') return {kind: 'resign'};
	if (word === 'pgn') return {kind: 'pgn'};
	if (word === 'level') return parseLevel(second);
	if (word === 'new') return parseNew(words.slice(1));
	if (word !== 'vs') return {kind: 'move', text: args.trim()};
	const opponent = parseOpponent(second);
	if (opponent) return {kind: 'opponent', opponent};
	return {kind: 'invalid', message: 'Try /chess vs llm or /chess vs engine.'};
}
