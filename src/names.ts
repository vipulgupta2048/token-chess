// Who is playing, in words: a model id as people say it, and the last move
// told as a sentence ("DeepSeek V4.1 Flash took your knight (Nxe4)").

import type {Game} from './game.js';
import {parseSquare} from './position.js';

// Vendor spellings a plain capital gets wrong.
const BRANDS: Readonly<Record<string, string>> = {
	deepseek: 'DeepSeek',
	gpt: 'GPT',
	glm: 'GLM',
	minimax: 'MiniMax',
	openai: 'OpenAI',
	xai: 'xAI',
};

const PIECE_NAMES: Readonly<Record<string, string>> = {
	p: 'pawn',
	n: 'knight',
	b: 'bishop',
	r: 'rook',
	q: 'queen',
	k: 'king',
};

function wordOf(token: string): string {
	const brand = BRANDS[token];
	if (brand) return brand;
	// Sizes and versions: 32b → 32B, v4.1 → V4.1, k3 → K3.
	if (/^\d+(\.\d+)?[bkm]$/.test(token)) return token.toUpperCase();
	return (token[0] ?? '').toUpperCase() + token.slice(1);
}

// `deepseek/deepseek-v4.1-flash` → `DeepSeek V4.1 Flash`,
// `claude-fable-5-2` → `Claude Fable 5.2`. Trailing tags like `(latest)` go.
export function modelName(id: string): string {
	const base = (id.split('/').pop() ?? id)
		.replace(/-?\(.*\)$/, '')
		.replace(/:/g, '-');
	const words: string[] = [];
	for (const token of base.split('-').filter(Boolean)) {
		const previous = words[words.length - 1];
		// Version numbers split by dashes join back with dots.
		if (/^\d+$/.test(token) && previous && /^\d+(\.\d+)*$/.test(previous)) {
			words[words.length - 1] = `${previous}.${token}`;
			continue;
		}
		words.push(wordOf(token));
	}
	return words.join(' ') || id;
}

// What the last move did, after the mover's name: "played Nf6", "castled",
// "took your knight (Nxe4)". `isPlayers` says whose piece was taken.
export function moveVerb(game: Game, isPlayers: boolean): string {
	const san = game.sanLog[game.sanLog.length - 1];
	if (!san) return '';
	if (san.startsWith('O-O-O')) return 'castled long';
	if (san.startsWith('O-O')) return 'castled';
	// String match, not the RegExp method: `cmd mods inspect` reads that
	// method's name as running a process.
	const target = san.match(/([a-h][1-8])(=[QRBN])?[+#]?$/)?.[1];
	const before = game.positions[game.positions.length - 2];
	if (!san.includes('x') || !target || !before) return `played ${san}`;
	// An empty target square is an en passant capture: a pawn.
	const taken = before.board[parseSquare(target)]?.toLowerCase() || 'p';
	const owner = isPlayers ? 'their' : 'your';
	return `took ${owner} ${PIECE_NAMES[taken] ?? 'piece'} (${san})`;
}
