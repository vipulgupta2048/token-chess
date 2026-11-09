// Playing against the session's model: what to ask it, and how to read its
// answer back into one legal move. The model sees the legal moves listed, so
// most answers are legal; anything else is turned away, never guessed at.

import {currentPosition, type Game, moveListText} from './game.js';
import {legalMoves, type Move} from './moves.js';
import {toFen} from './position.js';
import {parseMove, toSan} from './san.js';

export interface LlmPrompt {
	readonly system: string;
	readonly prompt: string;
}

export interface LlmReply {
	readonly move?: Move;
	// One short line for the player, when the model added one.
	readonly remark?: string;
}

const REMARK_LENGTH = 80;

const SYSTEM = [
	'You are playing a game of chess against a person in their terminal.',
	'Answer with your move on the first line, in standard algebraic notation,',
	'spelled exactly as in the list of legal moves. On a second line you may',
	'add one short, friendly remark to your opponent, at most 12 words.',
	'Write nothing else.',
].join(' ');

export function llmPrompt(game: Game): LlmPrompt {
	const position = currentPosition(game);
	const side = position.turn === 'w' ? 'white' : 'black';
	const moves = moveListText(game, game.sanLog.length);
	const legal = legalMoves(position).map(move => toSan(position, move));
	return {
		system: SYSTEM,
		prompt: [
			`You play ${side}.`,
			`Moves so far: ${moves || 'none, you move first'}`,
			`Position (FEN): ${toFen(position)}`,
			`Legal moves: ${legal.join(' ')}`,
			'Your move:',
		].join('\n'),
	};
}

// The same question again, after an answer that wasn't a legal move.
export function retryPrompt(params: {
	first: LlmPrompt;
	answer: string;
}): LlmPrompt {
	const said = params.answer.split('\n')[0]?.trim().slice(0, 40) ?? '';
	return {
		system: params.first.system,
		prompt: `${params.first.prompt}\n\nYou answered "${said}", which is not one of the legal moves. Answer again with one move from the list.`,
	};
}

// Markdown, quotes, move numbers and labels a model wraps a move in.
function moveWords(line: string): readonly string[] {
	return line
		.replace(/^\s*(?:move|my move|answer)\s*:/i, '')
		.split(/\s+/)
		.map(word => word.replace(/^[*_`"'(]+|[*_`"'),.;:]+$/g, ''))
		.map(word => word.replace(/^\d+\.+/, ''))
		.filter(Boolean);
}

function cleanRemark(lines: readonly string[]): string | undefined {
	const text = lines
		.join(' ')
		.replace(/[\u0000-\u001f\u007f]/g, '')
		.replace(/^\s*(?:remark|comment|say)\s*:\s*/i, '')
		.replace(/^["'*_`]+|["'*_`]+$/g, '')
		.trim();
	if (!text) return undefined;
	if (text.length <= REMARK_LENGTH) return text;
	return `${text.slice(0, REMARK_LENGTH - 1)}…`;
}

// The first word of the first line that names a legal move, and the rest as a
// remark. A reply with no legal move in its first line has no move at all.
export function readReply(game: Game, text: string): LlmReply {
	const position = currentPosition(game);
	const [first = '', ...rest] = text.trim().split('\n');
	for (const word of moveWords(first)) {
		const move = parseMove(position, word);
		if (!move) continue;
		const remark = cleanRemark(rest);
		return remark ? {move, remark} : {move};
	}
	return {};
}
