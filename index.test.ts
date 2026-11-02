// Drives the mod through a stub of the Command Code mod API: the same calls
// the host makes, with the feed and footer captured as plain text.

import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {beforeEach, describe, expect, it} from 'vitest';
import tokenChess from './index.js';
import type {ModApi, ModCommand, ModCommandResult} from './src/mod-api.js';

// biome-ignore lint/suspicious/noControlCharactersInRegex: strips ANSI codes
const stripAnsi = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '');

interface Stub {
	readonly run: (args: string) => Promise<ModCommandResult | undefined>;
	readonly feed: string[];
	readonly status: () => string;
	readonly commands: string[];
}

function loadChess(): Stub {
	const feed: string[] = [];
	const commands: string[] = [];
	const renderers = new Map<string, (data: unknown) => readonly string[]>();
	let status = '';
	let command: ModCommand | undefined;
	const disposable = {dispose: (): void => {}};
	const cmd: ModApi = {
		ui: {
			setStatus: text => {
				status = text ?? '';
				return disposable;
			},
		},
		hooks: () => disposable,
		on: () => disposable,
		addCommand: registered => {
			commands.push(registered.name);
			command = registered;
			return disposable;
		},
		addRenderer: (type, render) => {
			renderers.set(type, render);
			return disposable;
		},
		showEntry: (type, data) => {
			const lines = renderers.get(type)?.(data) ?? [];
			feed.push(lines.map(stripAnsi).join('\n'));
		},
	};
	tokenChess(cmd);
	return {
		run: async args => command?.handler({args}),
		feed,
		status: () => stripAnsi(status),
		commands,
	};
}

describe('token-chess mod', () => {
	let chess: Stub;
	beforeEach(() => {
		process.env.HOME = mkdtempSync(join(tmpdir(), 'token-chess-home-'));
		chess = loadChess();
	});

	it('registers /chess', () => {
		expect(chess.commands).toEqual(['chess']);
	});

	it('plays a move, gets a reply, and shows one board', async () => {
		await chess.run('e4');
		expect(chess.feed).toHaveLength(1);
		expect(chess.feed[0]).toMatch(/1\. e4 \S+/);
		expect(chess.feed[0]).toContain('Your move');
		expect(chess.status()).toMatch(/your move · last /);
	});

	it('explains an illegal move with the legal list', async () => {
		const result = await chess.run('e5');
		expect(result?.message).toContain('e5 is not legal here');
		expect(result?.message).toContain('Nf3');
	});

	it('lets the engine open when the player takes black', async () => {
		await chess.run('new black');
		const board = chess.feed[chess.feed.length - 1] ?? '';
		expect(board).toContain('you play black');
		expect(board).toContain('/chess e5, Nf6');
		expect(board).toMatch(/1\. \S+/);
	});

	it('undoes a turn and resigns', async () => {
		await chess.run('d4');
		await chess.run('undo');
		expect(chess.feed[chess.feed.length - 1]).not.toContain('1. d4');
		await chess.run('resign');
		expect(chess.status()).toContain('black wins by resignation');
	});

	it('resumes the saved game after a reload', async () => {
		await chess.run('Nf3');
		const reloaded = loadChess();
		await reloaded.run('');
		expect(reloaded.feed[0]).toContain('1. Nf3');
	});
});
