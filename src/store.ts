// The game in progress survives `/reload` and new sessions in one small JSON
// file. A missing, unreadable or malformed file just means no game yet.

import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';
import {fromSaved, type Game, type SavedGame, toSaved} from './game.js';

export function defaultGameFile(): string {
	return join(homedir(), '.commandcode', 'token-chess', 'game.json');
}

function isStringArray(value: unknown): value is readonly string[] {
	return (
		Array.isArray(value) && value.every(item => typeof item === 'string')
	);
}

function isSavedGame(value: unknown): value is SavedGame {
	if (typeof value !== 'object' || value === null) return false;
	const saved = value as Record<string, unknown>;
	if (!isStringArray(saved.fens) || !isStringArray(saved.sanLog))
		return false;
	if (saved.player !== 'w' && saved.player !== 'b') return false;
	if (typeof saved.level !== 'number') return false;
	return typeof saved.resigned === 'boolean';
}

export function loadGame(file: string): Game | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
		if (!isSavedGame(parsed)) return undefined;
		return fromSaved(parsed);
	} catch {
		return undefined;
	}
}

export function saveGame(file: string, game: Game): void {
	try {
		mkdirSync(dirname(file), {recursive: true});
		writeFileSync(file, `${JSON.stringify(toSaved(game))}\n`);
	} catch {
		// Losing the save only costs resuming after a restart; never the move.
	}
}
