// Drives the mod through a stub of the Command Code mod API: the same calls
// the host makes, with the feed and footer captured as plain text.

import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import tokenChess from './index.js';
import type {
	InputElement,
	ModApi,
	ModCommand,
	ModCommandResult,
	ModPane,
	SelectElement,
} from './src/mod-api.js';

// biome-ignore lint/suspicious/noControlCharactersInRegex: strips ANSI codes
const stripAnsi = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '');

interface Stub {
	readonly run: (args: string) => Promise<ModCommandResult | undefined>;
	readonly feed: string[];
	readonly status: () => string;
	readonly commands: string[];
	readonly opened: {id: string; focus: boolean}[];
	readonly pane: () => string;
	readonly type: (text: string) => void;
	readonly pick: (label: string) => void;
	readonly picks: () => readonly string[];
	readonly hasInput: () => boolean;
}

function loadChess(options: {hasPane: boolean} = {hasPane: false}): Stub {
	const feed: string[] = [];
	const commands: string[] = [];
	const renderers = new Map<string, (data: unknown) => readonly string[]>();
	let status = '';
	let command: ModCommand | undefined;
	let pane: ModPane | undefined;
	const opened: {id: string; focus: boolean}[] = [];
	const disposable = {dispose: (): void => {}};
	const cmd: ModApi = {
		ui: {
			capabilities: {surface: options.hasPane},
			setStatus: text => {
				status = text ?? '';
				return disposable;
			},
			pane: registered => {
				pane = registered;
				return disposable;
			},
			openPane: (id, openOptions) => {
				opened.push({id, focus: openOptions?.focus === true});
			},
			refreshWidgets: () => {},
		},
		hooks: () => disposable,
		on: () => disposable,
		addCommand: registered => {
			commands.push(registered.name);
			command = registered;
			return disposable;
		},
		addShortcut: () => disposable,
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
	const nodes = () => pane?.render({width: 80}) ?? [];
	const select = (): SelectElement | undefined =>
		nodes().find(
			(node): node is SelectElement =>
				typeof node === 'object' && node.type === 'select',
		);
	return {
		pick: label => {
			const option = select()?.options.find(item => item.label === label);
			if (!option) throw new Error(`no option ${label}`);
			select()?.onSelect(option.value);
		},
		picks: () => select()?.options.map(item => item.label) ?? [],
		hasInput: () =>
			nodes().some(node => typeof node === 'object' && node.type === 'input'),
		run: async args => command?.handler({args}),
		feed,
		status: () => stripAnsi(status),
		commands,
		opened,
		pane: () =>
			nodes()
				.filter(node => typeof node === 'string')
				.map(stripAnsi)
				.join('\n'),
		type: text => {
			const input = nodes().find(
				(node): node is InputElement =>
					typeof node === 'object' && node.type === 'input',
			);
			input?.onSubmit(text);
		},
	};
}

async function settled(check: () => boolean): Promise<void> {
	await vi.waitFor(() => {
		if (!check()) throw new Error('not yet');
	});
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

	it('explains an illegal move with that piece\'s moves', async () => {
		const result = await chess.run('e5');
		expect(result?.message).toContain('no pawn can reach e5');
		expect(result?.message).toContain('e4');
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

describe('token-chess mod in a pane', () => {
	let chess: Stub;
	const isIdle = () => chess.status().includes('your move');
	beforeEach(() => {
		process.env.HOME = mkdtempSync(join(tmpdir(), 'token-chess-home-'));
		chess = loadChess({hasPane: true});
	});

	it('opens the pane with focus on a bare /chess', async () => {
		await chess.run('');
		expect(chess.opened).toEqual([{id: 'board', focus: true}]);
		expect(chess.feed).toHaveLength(0);
		expect(chess.pane()).toContain('Your move');
	});

	it('leaves the keyboard at the prompt for /chess <move>', async () => {
		await chess.run('e4');
		expect(chess.opened).toEqual([{id: 'board', focus: false}]);
		expect(chess.feed).toHaveLength(0);
		expect(chess.pane()).toMatch(/1\. e4 \S+/);
	});

	const openTyping = (): void => {
		chess.pick('≡ menu');
		chess.pick('Type a move');
	};

	it('shows one control at a time', () => {
		expect(chess.picks()).toContain('≡ menu');
		expect(chess.hasInput()).toBe(false);
		openTyping();
		expect(chess.hasInput()).toBe(true);
		expect(chess.picks()).toEqual([]);
	});

	it('plays a typed move, stays typing, and an empty Enter leaves', async () => {
		openTyping();
		chess.type('e2 e4');
		await settled(() => /1\. e4 \S+/.test(chess.pane()) && isIdle());
		expect(chess.pane()).toContain('Black played');
		expect(chess.hasInput()).toBe(true);
		chess.type('');
		expect(chess.hasInput()).toBe(false);
		expect(chess.pane()).toContain('Choose a piece:');
	});

	it('shows your move and Thinking… before the engine answers', () => {
		chess.pick('e2');
		chess.pick('e4');
		expect(chess.pane()).toContain('Thinking…');
		expect(chess.pane()).toContain('1. e4');
	});

	it('answers an illegal move in the pane, and clears it next time', async () => {
		openTyping();
		chess.type('e5');
		await settled(() => chess.pane().includes('no pawn can reach e5'));
		chess.type('e4');
		await settled(() => /1\. e4 \S+/.test(chess.pane()) && isIdle());
		expect(chess.pane()).not.toContain('no pawn can reach');
	});

	it('runs the menu: level, then resign after asking', async () => {
		chess.pick('≡ menu');
		chess.pick('Level 3');
		chess.pick('5');
		await settled(() => chess.pane().includes('Engine level set to 5'));
		chess.pick('≡ menu');
		expect(chess.picks()).toContain('Level 5');
		chess.pick('Resign');
		chess.pick('‹ back');
		expect(chess.picks()).toContain('Resign');
		chess.pick('Resign');
		chess.pick('Yes, resign');
		await settled(() => chess.pane().includes('resignation'));
	});

	it('undoes from the menu, and starts a new game as black', async () => {
		chess.pick('e2');
		chess.pick('e4');
		await settled(() => /1\. e4 \S+/.test(chess.pane()) && isIdle());
		chess.pick('≡ menu');
		chess.pick('Undo');
		await settled(() => !chess.pane().includes('1. e4'));
		chess.pick('≡ menu');
		chess.pick('New game');
		chess.pick('Black');
		await settled(() => /1\. \S+/.test(chess.pane()) && isIdle());
	});

	it('leaves material out until someone is ahead', () => {
		expect(chess.pane()).not.toContain('Material');
		expect(chess.pane()).not.toContain("You're");
	});

	it('refuses a level change while the engine thinks', async () => {
		chess.pick('e2');
		chess.pick('e4');
		const reply = await chess.run('level 1');
		expect(reply?.message).toContain('finish its move');
		await settled(() => /1\. e4 \S+/.test(chess.pane()) && isIdle());
	});

	it('does not stay stuck thinking after resigning mid-search', async () => {
		chess.pick('e2');
		chess.pick('e4');
		await chess.run('resign');
		await settled(() => !chess.pane().includes('Thinking…'));
		expect(chess.pane()).toContain('resignation');
	});

	it('plays a move by picking a piece, then a square', async () => {
		expect(chess.picks()).toContain('Ng1');
		chess.pick('Ng1');
		expect(chess.pane()).toContain('Move g1 to:');
		expect(chess.picks()).toEqual(['Nf3', 'Nh3', '‹ back']);
		expect(chess.pane()).toContain('•');
		chess.pick('Nf3');
		await settled(() => /1\. Nf3 \S+/.test(chess.pane()) && isIdle());
		expect(chess.pane()).toContain('Choose a piece:');
		expect(chess.pane()).not.toContain('•');
	});

	it('goes back to choosing a piece', () => {
		chess.pick('e2');
		chess.pick('‹ back');
		expect(chess.pane()).toContain('Choose a piece:');
	});

	it('drops a half-made pick when a move arrives from the prompt', async () => {
		chess.pick('e2');
		await chess.run('d4');
		await settled(() => /1\. d4 \S+/.test(chess.pane()) && isIdle());
		expect(chess.pane()).toContain('Choose a piece:');
	});

	it('holds the picker in place while thinking and after the game', async () => {
		chess.pick('e2');
		chess.pick('e4');
		expect(chess.picks()).toEqual(['Thinking…']);
		chess.pick('Thinking…');
		await settled(isIdle);
		await chess.run('resign');
		expect(chess.picks()).toEqual(['New game']);
		chess.pick('New game');
		chess.pick('White');
		await settled(() => chess.pane().includes('Choose a piece:'));
	});
});
