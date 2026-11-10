// Drives the mod through a stub of the Command Code mod API: the same calls
// the host makes, with the feed and footer captured as plain text.

import {mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import llmChess from './index.js';
import {defaultGameFile, legacyGameFile} from './src/store.js';
import type {
	ModApi,
	ModCommand,
	ModCommandResult,
	ModModelCompleteResult,
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
	readonly pick: (label: string) => void;
	readonly picks: () => readonly string[];
	// Labels the settings dialog showed, and what the person picks in it next.
	readonly dialogs: () => readonly string[][];
	// The moves of the game so far, as the save file has them.
	readonly sans: () => string;
	readonly choose: (label: string | undefined) => void;
	// Answers the stub model gives, in order; after them it is unavailable.
	// 'hold' answers only when the call is aborted.
	readonly answer: (...answers: (ModModelCompleteResult | 'hold')[]) => void;
	readonly asked: () => readonly {prompt: string; signal?: AbortSignal}[];
	// The TUI mounting its surface, which happens after mods load.
	readonly mount: () => void;
	readonly toasts: string[];
}

function loadChess(
	options: {hasPane: boolean; isMountedLater?: boolean} = {hasPane: false},
): Stub {
	let isMounted = options.hasPane && !options.isMountedLater;
	const feed: string[] = [];
	const commands: string[] = [];
	const renderers = new Map<string, (data: unknown) => readonly string[]>();
	let status = '';
	let command: ModCommand | undefined;
	let pane: ModPane | undefined;
	const opened: {id: string; focus: boolean}[] = [];
	const toasts: string[] = [];
	const dialogs: string[][] = [];
	const picked: (string | undefined)[] = [];
	const answers: (ModModelCompleteResult | 'hold')[] = [];
	const asked: {prompt: string; signal?: AbortSignal}[] = [];
	const disposable = {dispose: (): void => {}};
	const cmd: ModApi = {
		ui: {
			capabilities: {
				get surface() {
					return isMounted;
				},
			},
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
			toast: text => {
				toasts.push(text);
			},
			select: async ({options}) => {
				dialogs.push(options.map(option => option.label));
				return picked.shift();
			},
		},
		hooks: () => disposable,
		on: () => disposable,
		addCommand: registered => {
			commands.push(registered.name);
			command = registered;
			return disposable;
		},
		model: {
			complete: async params => {
				asked.push(params);
				const next = answers.shift();
				if (next !== 'hold')
					return next ?? {isAnswered: false, reason: 'unavailable'};
				return new Promise(resolve => {
					params.signal?.addEventListener('abort', () =>
						resolve({isAnswered: false, reason: 'aborted'}),
					);
				});
			},
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
	llmChess(cmd);
	const nodes = () => pane?.render({width: 80}) ?? [];
	const select = (): SelectElement | undefined =>
		nodes().find(
			(node): node is SelectElement =>
				typeof node === 'object' && node.type === 'select',
		);
	return {
		toasts,
		mount: () => {
			isMounted = options.hasPane;
		},
		// Pages through `more ›` like a player would, to find the option.
		pick: label => {
			for (let page = 0; page < 5; page++) {
				const options = select()?.options ?? [];
				const option = options.find(item => item.label === label);
				if (option) return select()?.onSelect(option.value);
				const more = options.find(item => item.label === 'more ›');
				if (!more) break;
				select()?.onSelect(more.value);
			}
			throw new Error(`no option ${label}`);
		},
		picks: () => select()?.options.map(item => item.label) ?? [],
		dialogs: () => dialogs,
		sans: () => {
			try {
				const saved = JSON.parse(readFileSync(defaultGameFile(), 'utf8'));
				return (saved.sanLog as string[]).join(' ');
			} catch {
				return '';
			}
		},
		choose: label => {
			picked.push(label);
		},
		answer: (...more) => {
			answers.push(...more);
		},
		asked: () => asked,
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
		// Pages through `more ›` like a player would, to find the option.
		pick: label => {
			for (let page = 0; page < 5; page++) {
				const options = select()?.options ?? [];
				const option = options.find(item => item.label === label);
				if (option) return select()?.onSelect(option.value);
				const more = options.find(item => item.label === 'more ›');
				if (!more) break;
				select()?.onSelect(more.value);
			}
			throw new Error(`no option ${label}`);
		},
		picks: () => select()?.options.map(item => item.label) ?? [],
		dialogs: () => dialogs,
		choose: label => {
			picked.push(label);
		},
		answer: (...more) => {
			answers.push(...more);
		},
		asked: () => asked,
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

describe('LLMChess mod', () => {
	let chess: Stub;
	beforeEach(() => {
		vi.stubEnv('HOME', mkdtempSync(join(tmpdir(), 'token-chess-home-')));
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
		expect(chess.status()).toContain('LLM beat you by resignation');
	});

	it('resumes the saved game after a reload', async () => {
		await chess.run('Nf3');
		const reloaded = loadChess();
		await reloaded.run('');
		expect(reloaded.feed[0]).toContain('1. Nf3');
	});
});

describe('LLMChess mod in a pane', () => {
	let chess: Stub;
	const isIdle = () => chess.status().includes('your move');
	beforeEach(() => {
		vi.stubEnv('HOME', mkdtempSync(join(tmpdir(), 'token-chess-home-')));
		chess = loadChess({hasPane: true});
	});

	it('opens the pane with focus on a bare /chess', async () => {
		await chess.run('');
		expect(chess.opened).toEqual([{id: 'board', focus: true}]);
		expect(chess.feed).toHaveLength(0);
		expect(chess.pane()).toContain('Your move');
	});

	it('draws in the pane when the TUI mounts after the mod loads', async () => {
		const late = loadChess({hasPane: true, isMountedLater: true});
		late.mount();
		await late.run('');
		expect(late.opened).toEqual([{id: 'board', focus: true}]);
		expect(late.feed).toHaveLength(0);
		expect(late.pane()).toContain('Your move');
	});

	it('toasts a win once, and says it in the footer', async () => {
		const file = defaultGameFile();
		mkdirSync(dirname(file), {recursive: true});
		writeFileSync(
			file,
			JSON.stringify({
				fens: [
					'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
					'rnbqkbnr/pppppppp/8/8/8/5P2/PPPPP1PP/RNBQKBNR b KQkq - 0 1',
					'rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq e6 0 2',
					'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2',
				],
				sanLog: ['f3', 'e5', 'g4'],
				player: 'b',
				level: 3,
				opponent: 'engine',
				resigned: false,
			}),
		);
		const loaded = loadChess({hasPane: true});
		await loaded.run('Qh4');
		await loaded.run('');
		expect(loaded.toasts).toEqual(['♚ You beat Opponent in 2 moves']);
		expect(loaded.status()).toContain('You beat Opponent in 2 moves');
	});

	it('leaves the keyboard at the prompt for /chess <move>', async () => {
		await chess.run('e4');
		expect(chess.opened).toEqual([{id: 'board', focus: false}]);
		expect(chess.feed).toHaveLength(0);
		await settled(() => /^e4 \S+$/.test(chess.sans()));
	});

	const openTyping = (): void => {
		chess.pick('≡ menu');
		chess.pick('Type a move');
	};

	it('shows one control under the board, and a short menu', () => {
		expect(chess.picks()).toContain('≡ menu');
		chess.pick('≡ menu');
		expect(chess.picks()).toEqual([
			'New game',
			'Settings',
			'Resign',
			'‹ back',
		]);
	});

	it('draws nothing beside the board', () => {
		const rank = chess.pane().split('\n').find(line => line.startsWith(' 8 '));
		expect(rank?.trimEnd().length).toBeLessThanOrEqual(43);
	});

	it('resigns from the menu after asking', async () => {
		chess.pick('≡ menu');
		chess.pick('Resign');
		chess.pick('‹ back');
		expect(chess.picks()).toContain('Resign');
		chess.pick('Resign');
		chess.pick('Yes, resign');
		await settled(() => chess.pane().includes('resignation'));
	});

	it('starts a new game as black from the menu', async () => {
		await chess.run('vs engine');
		chess.pick('≡ menu');
		chess.pick('New game');
		chess.pick('Black');
		await settled(() => chess.sans().length > 0 && isIdle());
	});

	it('shows your move and Thinking… before the engine answers', () => {
		chess.pick('e2');
		chess.pick('e4');
		expect(chess.pane()).toMatch(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] LLM is thinking… \d+\.\ds$/m);
		expect(chess.pane()).toContain('Waiting · You played e4');
		expect(chess.pane()).toContain('You played e4');
	});

	it('refuses a level change while the engine thinks', async () => {
		chess.pick('e2');
		chess.pick('e4');
		const reply = await chess.run('level 1');
		// With the board open, the answer goes on its one-line activity row.
		expect(reply).toBeUndefined();
		await settled(() => /^e4 \S+$/.test(chess.sans()) && isIdle());
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
		await settled(() => /^Nf3 \S+$/.test(chess.sans()) && isIdle());
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
		await settled(() => /^d4 \S+$/.test(chess.sans()) && isIdle());
		expect(chess.pane()).toContain('Choose a piece:');
	});

	it('holds the picker in place while thinking and after the game', async () => {
		chess.pick('e2');
		chess.pick('e4');
		expect(chess.picks()).toEqual(['Thinking…']);
		chess.pick('Thinking…');
		await settled(isIdle);
		await chess.run('resign');
		expect(chess.picks()).toEqual(['New game', 'Settings']);
		chess.pick('New game');
		chess.pick('White');
		await settled(() => chess.pane().includes('Choose a piece:'));
	});

	it('frees the board when a new game replaces one mid-search', async () => {
		await chess.run('vs engine');
		await chess.run('level 5');
		chess.pick('e2');
		chess.pick('e4');
		await chess.run('new');
		const reply = await chess.run('d4');
		expect(reply?.message).toBeUndefined();
		await settled(() => /^d4 \S+$/.test(chess.sans()) && isIdle());
	});

	it('lets the engine move first in a save left on its turn', async () => {
		const file = defaultGameFile();
		mkdirSync(dirname(file), {recursive: true});
		writeFileSync(
			file,
			JSON.stringify({
				fens: [
					'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
					'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
				],
				sanLog: ['e4'],
				player: 'w',
				level: 99,
				resigned: false,
			}),
		);
		const loaded = loadChess({hasPane: true});
		const reply = await loaded.run('e5');
		expect(reply).toBeUndefined();
		await settled(() => loaded.status().includes('your move'));
		expect(loaded.pane()).not.toContain('Level 99');
	});
});

describe('LLMChess against the session LLM', () => {
	let chess: Stub;
	const isIdle = () => chess.status().includes('your move');
	const said = (text: string): ModModelCompleteResult => ({
		isAnswered: true,
		text,
		model: 'test-model',
	});
	beforeEach(() => {
		vi.stubEnv('HOME', mkdtempSync(join(tmpdir(), 'llmchess-home-')));
		chess = loadChess({hasPane: true});
	});

	it('plays the LLM by default and shows its move, remark and name', async () => {
		chess.answer(said('**e5**\nYour move, human.'));
		chess.pick('e2');
		chess.pick('e4');
		await settled(() => chess.sans() === 'e4 e5' && isIdle());
		expect(chess.pane()).toContain('Test Model played e5');
		expect(chess.pane()).toContain('“Your move, human.”');
		expect(chess.asked()[0]?.prompt).toContain('You play black.');
		expect(chess.asked()[0]?.prompt).toContain('Legal moves:');
	});

	it('asks again once after an illegal answer', async () => {
		chess.answer(said('Ke2'), said('Nf6'));
		chess.pick('e2');
		chess.pick('e4');
		await settled(() => chess.sans() === 'e4 Nf6' && isIdle());
		expect(chess.asked()).toHaveLength(2);
		expect(chess.asked()[1]?.prompt).toContain('not one of the legal moves');
	});

	it('lets the engine play when the LLM fails twice, and says so', async () => {
		chess.answer(said('Ke2'), said('resign?'));
		chess.pick('e2');
		chess.pick('e4');
		await settled(() => /^e4 \S+$/.test(chess.sans()) && isIdle());
		expect(chess.pane()).toContain("didn't answer with a legal move");
		expect(chess.pane()).toMatch(/Opponent \S.* \(subbing in for Test Model\)/);
	});

	it('lets the engine play when the model is unavailable', async () => {
		chess.pick('e2');
		chess.pick('e4');
		await settled(() => /^e4 \S+$/.test(chess.sans()) && isIdle());
		expect(chess.pane()).toContain("model isn't available");
	});

	it('sets opponent and level in one pick from /chess settings', async () => {
		chess.choose('Built-in engine, level 5');
		const reply = await chess.run('settings');
		expect(chess.dialogs()[0]).toEqual([
			'Your session LLM',
			'Built-in engine, level 1',
			'Built-in engine, level 2',
			'Built-in engine, level 3',
			'Built-in engine, level 4',
			'Built-in engine, level 5',
		]);
		expect(reply?.message).toBe('Now playing the engine, level 5.');
		await chess.run('e4');
		await settled(() => /^e4 \S+$/.test(chess.sans()) && isIdle());
		expect(chess.asked()).toHaveLength(0);
		chess.choose('Your session LLM');
		chess.pick('≡ menu');
		chess.pick('Settings');
		await settled(() => chess.pane().includes("Now playing your session's LLM"));
	});

	it('leaves settings alone when the dialog is dismissed', async () => {
		chess.choose(undefined);
		const reply = await chess.run('settings');
		expect(reply?.message).toBe('Settings unchanged.');
	});

	it('still switches opponent from the prompt', async () => {
		await chess.run('vs engine');
		expect(chess.pane()).toContain('Now playing the engine');
	});

	it('cancels the LLM call when a new game replaces the board', async () => {
		chess.answer('hold');
		chess.pick('e2');
		chess.pick('e4');
		expect(chess.pane()).toContain('LLM is thinking…');
		await chess.run('new engine');
		expect(chess.asked()[0]?.signal?.aborted).toBe(true);
		const reply = await chess.run('d4');
		expect(reply?.message).toBeUndefined();
		await settled(() => /^d4 \S+$/.test(chess.sans()) && isIdle());
	});

	it('starts a game as black against the LLM, which opens', async () => {
		chess.answer(said('d4\nLet us begin.'));
		await chess.run('new black');
		await settled(() => chess.sans() === 'd4' && isIdle());
		expect(chess.asked()[0]?.prompt).toContain('You play white.');
		expect(chess.asked()[0]?.prompt).toContain('none, you move first');
	});

	it('keeps a game saved before the LLM opponent on the engine', async () => {
		const file = legacyGameFile();
		mkdirSync(dirname(file), {recursive: true});
		writeFileSync(
			file,
			JSON.stringify({
				fens: ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'],
				sanLog: [],
				player: 'w',
				level: 2,
				resigned: false,
			}),
		);
		const loaded = loadChess({hasPane: true});
		await loaded.run('e4');
		await settled(() => /^e4 \S+$/.test(loaded.sans()));
		expect(loaded.asked()).toHaveLength(0);
	});
});
