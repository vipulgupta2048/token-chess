// LLMChess: play chess against your session's LLM in the Command Code TUI
// while the agent works, with a built-in engine beside it.
//
//   /chess         the board opens in a pane above the prompt; play in it
//   /chess e4      the same move from the prompt, the pane updates in place
//
// Pane input and mod slash commands both run while a turn is in flight, so a
// game goes on beside the agent's work. The LLM answers through one model call
// outside the agent's transcript; the engine plays whenever the LLM can't, and
// yields to the event loop while it thinks so the stream never stalls. The
// footer keeps the game in view. Hosts without panes get a board in the feed.

import {
	type Action,
	DEFAULT_LEVEL,
	HELP,
	MAX_LEVEL,
	parseAction,
} from './src/command.js';
import {chooseMove, LEVELS} from './src/engine.js';
import {
	colorName,
	currentPosition,
	describeOutcome,
	type Game,
	moveListText,
	newGame,
	type Opponent,
	outcomeOf,
	playMove,
	undoTurn,
} from './src/game.js';
import {type LlmReply, llmPrompt, readReply, retryPrompt} from './src/llm.js';
import type {ModApi, ModModelCompleteResult, PaneNode} from './src/mod-api.js';
import {isInCheck, type Move} from './src/moves.js';
import {
	BACK,
	BACK_OPTION,
	MENU,
	MENU_OPTION,
	MORE,
	movesFrom,
	pageOf,
	pieceOptions,
	targetOptions,
} from './src/picker.js';
import {opponent, parseSquare, toFen} from './src/position.js';
import {
	type BoardView,
	bold,
	dim,
	renderBoard,
	renderBoardLines,
	wrapText,
} from './src/render.js';
import {explainIllegal, parseMove} from './src/san.js';
import {
	defaultGameFile,
	legacyGameFile,
	loadGame,
	saveGame,
} from './src/store.js';

const NAME = 'LLMChess';
const RENDERER = 'llmchess';
const PANE = 'board';
// An LLM move that takes longer than this goes to the engine instead.
const LLM_TIMEOUT_MS = 60_000;
// Room for a move and a short remark, and for a reasoning model's preamble.
const LLM_MAX_TOKENS = 400;
const PIECE = '♙';
// A pane drops empty lines, so a gap between sections is one space.
const BLANK = ' ';

const WAIT = 'wait';
const NEW = 'new';
const RESIGN = 'resign';
const RESIGN_YES = 'resign-yes';
const SETTINGS = 'settings';

const ENGINE_LEVELS: readonly string[] = [
	'Easiest: looks one move ahead.',
	'Easy.',
	'The default: sees short tactics and mates in two.',
	'Strong.',
	'Strongest, a couple of seconds a move.',
];

type Stage = 'piece' | 'target' | 'menu' | 'side' | 'resign';

interface Reply {
	readonly message?: string;
}

// The LLM's answer for one turn: a move, or why the engine plays instead.
interface LlmTurn extends LlmReply {
	readonly problem?: string;
}

function rivalName(game: Game): string {
	return game.opponent === 'llm' ? 'LLM' : 'Engine';
}

// Where the arrow-key control is. It belongs to one game state, so any move,
// from anywhere, puts it back to choosing a piece.
interface Pick {
	readonly game: Game;
	readonly stage: Stage;
	readonly from?: string;
	readonly page: number;
}

function lastMoveSquares(game: Game): readonly number[] {
	const before = game.positions[game.positions.length - 2];
	const after = game.positions[game.positions.length - 1];
	if (!before || !after) return [];
	const changed: number[] = [];
	for (let square = 0; square < 64; square++) {
		if (before.board[square] !== after.board[square]) changed.push(square);
	}
	return changed;
}

function promptLine(game: Game): string {
	const outcome = outcomeOf(game);
	if (outcome.kind !== 'ongoing')
		return `${bold(describeOutcome(outcome))} ${dim('· /chess new to play again')}`;
	const position = currentPosition(game);
	const check = isInCheck(position) ? `${bold('Check!')} ` : '';
	if (position.turn !== game.player)
		return `${check}${dim(`${rivalName(game)} is thinking…`)}`;
	const examples =
		game.player === 'w' ? 'e4, Nf3, O-O or e2e4' : 'e5, Nf6, O-O or e7e5';
	return `${check}Your move ${dim(`· /chess ${examples}`)}`;
}

function boardView(game: Game): BoardView {
	const position = currentPosition(game);
	const moves = moveListText(game, 10);
	const king = position.turn === 'w' ? 'K' : 'k';
	return {
		fen: toFen(position),
		player: game.player,
		highlight: lastMoveSquares(game),
		...(isInCheck(position) ? {checked: position.board.indexOf(king)} : {}),
		heading: dim(
			`${NAME} · you play ${colorName(game.player)} against the ${rivalName(game)} · move ${position.fullmove}`,
		),
		notes: [...(moves ? [moves] : []), promptLine(game)],
	};
}

// The board with the picked piece lit and where it can go marked: dots on
// empty squares, the same light on anything it captures.
function pickedView(game: Game, from: string | undefined): BoardView {
	const view = boardView(game);
	if (!from) return view;
	const moves = movesFrom(currentPosition(game), from);
	return {
		...view,
		highlight: [
			parseSquare(from),
			...moves.filter(move => move.captured !== '').map(move => move.to),
		],
		dots: moves.filter(move => move.captured === '').map(move => move.to),
	};
}

function capitalized(word: string): string {
	return (word[0] ?? '').toUpperCase() + word.slice(1);
}

function lastMoveText(game: Game): string {
	const last = game.sanLog[game.sanLog.length - 1];
	if (!last) return '';
	const mover = opponent(currentPosition(game).turn);
	return dim(` · ${capitalized(colorName(mover))} played ${last}`);
}

// The line over the board: what the game needs from you right now.
function paneHeadline(game: Game, thinking: boolean): string {
	const outcome = outcomeOf(game);
	if (outcome.kind !== 'ongoing')
		return `${bold(capitalized(describeOutcome(outcome)))}${lastMoveText(game)}`;
	const check = isInCheck(currentPosition(game)) ? bold('Check! ') : '';
	const prompt = thinking
		? `${rivalName(game)} is thinking…`
		: bold('Your move');
	return `${check}${prompt}${lastMoveText(game)}`;
}

function statusText(game: Game, thinking: boolean): string {
	if (thinking) return `${PIECE} ${NAME} · ${rivalName(game)} thinking…`;
	const outcome = outcomeOf(game);
	if (outcome.kind !== 'ongoing')
		return `${PIECE} ${NAME} · ${describeOutcome(outcome)}`;
	const last = game.sanLog[game.sanLog.length - 1];
	const lastText = last ? ` · last ${last}` : '';
	const turn =
		currentPosition(game).turn === game.player
			? 'your move'
			: `${rivalName(game)} to move`;
	return `${PIECE} ${NAME} · ${turn}${lastText}`;
}

function problemFor(params: {
	answer: ModModelCompleteResult;
	isTimedOut: boolean;
}): string {
	const {answer, isTimedOut} = params;
	if (isTimedOut)
		return 'The LLM took over a minute, so the engine played instead.';
	if (answer.isAnswered) return '';
	if (answer.reason === 'unavailable')
		return "Your session's model isn't available yet, so the engine played instead.";
	return 'The LLM call failed, so the engine played instead.';
}

export default function llmChess(cmd: ModApi): void {
	const file = defaultGameFile();
	// Mods load before the TUI mounts, so `surface` is still false at load:
	// read it when drawing, not once up front.
	const hasPane = (): boolean => cmd.ui.capabilities?.surface === true;
	let game = loadGame(file) ?? loadGame(legacyGameFile());
	let thinking = false;
	let searches = 0;
	// The pending opponent turn, so a new game or resignation can cancel it.
	let pending: AbortController | undefined;
	// The model that answered last, named in the pane once known.
	let model: string | undefined;
	// The LLM's remark with its last move, until the next move.
	let remark: {readonly game: Game; readonly text: string} | undefined;
	// The answer to the last thing typed in the pane, until the next one.
	let notice = '';
	let pick: Pick | undefined;

	function currentPick(current: Game): Pick {
		return pick?.game === current
			? pick
			: {game: current, stage: 'piece', page: 0};
	}

	function currentGame(): Game {
		game ??= newGame({player: 'w', level: DEFAULT_LEVEL, opponent: 'llm'});
		return game;
	}

	function paint(current: Game): void {
		cmd.ui.setStatus(statusText(current, thinking));
		if (hasPane()) cmd.ui.refreshWidgets();
	}

	function show(current: Game): void {
		saveGame(file, current);
		paint(current);
		if (!hasPane()) cmd.showEntry(RENDERER, boardView(current));
	}

	async function engineMove(current: Game): Promise<Move | undefined> {
		const level = LEVELS[current.level - 1] ?? LEVELS[DEFAULT_LEVEL - 1];
		if (!level) return undefined;
		const position = currentPosition(current);
		return (await chooseMove(position, level, current.positions))?.move;
	}

	// One model call, with a retry when the answer isn't a legal move. Any
	// failure comes back as the reason the engine plays this move instead.
	async function askLlm(
		current: Game,
		controller: AbortController,
	): Promise<LlmTurn> {
		if (!cmd.model)
			return {
				problem:
					"This Command Code can't call its model from a mod, so the engine played instead.",
			};
		let isTimedOut = false;
		const timer = setTimeout(() => {
			isTimedOut = true;
			controller.abort();
		}, LLM_TIMEOUT_MS);
		try {
			const ask = (prompt: {system: string; prompt: string}) =>
				cmd.model?.complete({
					...prompt,
					maxOutputTokens: LLM_MAX_TOKENS,
					signal: controller.signal,
				});
			const first = llmPrompt(current);
			let answer = await ask(first);
			for (let attempt = 0; attempt < 2; attempt++) {
				if (!answer?.isAnswered)
					return {
						problem: answer
							? problemFor({answer, isTimedOut})
							: 'The LLM call failed, so the engine played instead.',
					};
				model = answer.model;
				const reply = readReply(current, answer.text);
				if (reply.move) return reply;
				if (attempt === 0)
					answer = await ask(retryPrompt({first, answer: answer.text}));
			}
			return {
				problem:
					"The LLM didn't answer with a legal move, so the engine played instead.",
			};
		} finally {
			clearTimeout(timer);
		}
	}

	// Plays the opponent's reply, if it is their turn. Returns why the engine
	// stood in for the LLM, when it did.
	async function opponentTurn(current: Game): Promise<string | undefined> {
		const position = currentPosition(current);
		if (position.turn === current.player) return void show(current);
		if (outcomeOf(current).kind !== 'ongoing') return void show(current);
		const search = ++searches;
		const controller = new AbortController();
		pending = controller;
		thinking = true;
		paint(current);
		const isStale = (): boolean => game !== undefined && game !== current;
		const asked: LlmTurn =
			current.opponent === 'llm' ? await askLlm(current, controller) : {};
		const chosen = isStale()
			? undefined
			: (asked.move ?? (await engineMove(current)));
		if (search === searches) {
			thinking = false;
			pending = undefined;
		}
		// A /chess new or resign while the opponent thought replaced the game:
		// this reply belongs to a board that no longer exists.
		if (game && isStale()) return void paint(game);
		if (!chosen) return void show(current);
		const next = playMove(current, chosen);
		game = next;
		remark = asked.remark ? {game: next, text: asked.remark} : undefined;
		show(next);
		return asked.problem;
	}

	// Leaves any opponent turn running to finish unheard: its game is gone.
	function abandonSearch(): void {
		searches++;
		thinking = false;
		pending?.abort();
		pending = undefined;
	}

	async function startNew(
		action: Extract<Action, {kind: 'new'}>,
	): Promise<Reply> {
		abandonSearch();
		game = newGame({
			player: action.player,
			level: game?.level ?? DEFAULT_LEVEL,
			opponent: action.opponent ?? game?.opponent ?? 'llm',
		});
		const problem = await opponentTurn(game);
		return problem ? {message: problem} : {};
	}

	async function move(text: string): Promise<Reply> {
		const current = currentGame();
		if (thinking)
			return {
				message: `The ${rivalName(current)} is still thinking. One moment.`,
			};
		if (outcomeOf(current).kind !== 'ongoing')
			return {message: 'This game is over. /chess new starts another.'};
		// Only a hand-edited save leaves the opponent to move with none thinking.
		if (currentPosition(current).turn !== current.player) {
			void opponentTurn(current);
			return {message: 'Your opponent is to move. One moment.'};
		}
		const chosen = parseMove(currentPosition(current), text);
		if (!chosen)
			return {message: explainIllegal(currentPosition(current), text)};
		// The pane shows your move at once; the feed prints one board per
		// turn, after the opponent's reply, and the footer covers the wait.
		game = playMove(current, chosen);
		const problem = await opponentTurn(game);
		return problem ? {message: problem} : {};
	}

	async function run(action: Action): Promise<Reply> {
		if (action.kind === 'help') return {message: HELP};
		if (action.kind === 'invalid') return {message: action.message};
		if (action.kind === 'new') return startNew(action);
		if (action.kind === 'move') return move(action.text);
		if (action.kind === 'settings') return openSettings(currentGame());
		const current = currentGame();
		const waitMessage = `Wait for the ${rivalName(current)} to finish its move.`;
		if (action.kind === 'opponent') {
			if (thinking) return {message: waitMessage};
			game = {...current, opponent: action.opponent};
			saveGame(file, game);
			paint(game);
			return {
				message:
					action.opponent === 'llm'
						? "Now playing your session's LLM."
						: `Now playing the engine, level ${current.level}.`,
			};
		}
		if (action.kind === 'level') {
			if (thinking) return {message: waitMessage};
			game = {...current, level: action.level};
			saveGame(file, game);
			paint(game);
			return {message: `Engine level set to ${action.level}.`};
		}
		if (action.kind === 'resign') {
			if (outcomeOf(current).kind !== 'ongoing')
				return {message: 'This game is already over.'};
			abandonSearch();
			game = {...current, resigned: true};
		}
		if (action.kind === 'undo') {
			if (thinking) return {message: waitMessage};
			game = undoTurn(current);
			if (game === current)
				return {message: 'Nothing of yours to take back.'};
		}
		show(game ?? current);
		return {};
	}

	// One pick in Command Code's own dialog sets who you play and how strong
	// the engine is: the LLM, or the engine at one of its levels.
	async function openSettings(current: Game): Promise<Reply> {
		if (thinking)
			return {message: `Wait for the ${rivalName(current)} to finish its move.`};
		const choices = [
			{
				label: 'Your session LLM',
				description: `${model ?? 'The model this session uses'}. The engine at level ${current.level} stands in when it can't move.`,
				opponent: 'llm' as const,
				level: current.level,
			},
			...Array.from({length: MAX_LEVEL}, (_, index) => ({
				label: `Built-in engine, level ${index + 1}`,
				description: ENGINE_LEVELS[index] ?? '',
				opponent: 'engine' as const,
				level: index + 1,
			})),
		].map(choice =>
			choice.opponent === current.opponent &&
			(choice.opponent === 'llm' || choice.level === current.level)
				? {...choice, description: `Current. ${choice.description}`}
				: choice,
		);
		const picked = await cmd.ui.select({
			title: 'Play against',
			options: choices.map(({label, description}) => ({label, description})),
		});
		const choice = choices.find(item => item.label === picked);
		if (!choice) return {message: 'Settings unchanged.'};
		const latest = game ?? current;
		game = {...latest, opponent: choice.opponent, level: choice.level};
		saveGame(file, game);
		paint(game);
		return {
			message:
				choice.opponent === 'llm'
					? "Now playing your session's LLM."
					: `Now playing the engine, level ${choice.level}.`,
		};
	}

	// Everything from inside the pane answers inside the pane.
	async function runInPane(action: Action): Promise<void> {
		notice = '';
		const reply = await run(action);
		notice = reply.message ?? '';
		cmd.ui.refreshWidgets();
	}

	function goTo(next: Pick): void {
		pick = next;
		notice = '';
		cmd.ui.refreshWidgets();
	}

	// Option values never collide: squares, coordinate moves and these words.
	function choose(current: Game, value: string): void {
		const state = currentPick(current);
		const inMenu = {game: current, stage: 'menu', page: 0} as const;
		const atPieces = {game: current, stage: 'piece', page: 0} as const;
		if (value === WAIT) return;
		if (value === MORE) return goTo({...state, page: state.page + 1});
		if (value === MENU) return goTo(inMenu);
		if (value === BACK)
			return goTo(
				state.stage === 'target' || state.stage === 'menu'
					? atPieces
					: inMenu,
			);
		if (value === SETTINGS) return void runInPane({kind: 'settings'});
		if (value === RESIGN) return goTo({...inMenu, stage: 'resign'});
		if (value === RESIGN_YES) return void runInPane({kind: 'resign'});
		if (value === NEW) return goTo({...inMenu, stage: 'side'});
		if (value === 'w' || value === 'b')
			return void runInPane({kind: 'new', player: value});
		if (state.stage === 'target')
			return void runInPane({kind: 'move', text: value});
		goTo({game: current, stage: 'target', from: value, page: 0});
	}

	// One control at a time, always at the same spot, so focus stays on it; a
	// new key per stage starts its highlight on the first option.
	function controlNodes(current: Game, width: number): readonly PaneNode[] {
		const select = (
			key: string,
			options: readonly {label: string; value: string}[],
			value?: string,
		): PaneNode => ({
			type: 'select',
			key,
			options,
			...(value ? {value} : {}),
			onSelect: chosen => choose(current, chosen),
		});
		const {stage, from, page} = currentPick(current);
		if (thinking)
			return [
				dim(`${rivalName(current)} to move`),
				select('wait', [{label: 'Thinking…', value: WAIT}]),
			];
		if (stage === 'menu')
			return [
				dim('Menu'),
				select('menu', [
					{label: 'New game', value: NEW},
					{label: 'Settings', value: SETTINGS},
					{label: 'Resign', value: RESIGN},
					BACK_OPTION,
				]),
			];
		if (stage === 'side')
			return [
				dim('New game. Play as:'),
				select('side', [
					{label: 'White', value: 'w'},
					{label: 'Black', value: 'b'},
					BACK_OPTION,
				]),
			];
		if (stage === 'resign')
			return [
				dim('Resign this game?'),
				select('resign', [
					{label: 'Yes, resign', value: RESIGN_YES},
					BACK_OPTION,
				]),
			];
		if (outcomeOf(current).kind !== 'ongoing')
			return [
				dim('Game over'),
				select('over', [
					{label: 'New game', value: NEW},
					{label: 'Settings', value: SETTINGS},
				]),
			];
		const position = currentPosition(current);
		const options = from
			? targetOptions(position, from)
			: pieceOptions(position);
		return [
			dim(`${from ? `Move ${from} to` : 'Choose a piece'}: ←/→ then Enter`),
			select(
				`pick-${current.sanLog.length}-${from ?? 'piece'}-${page}`,
				pageOf({
					options,
					page,
					width,
					tail: [from ? BACK_OPTION : MENU_OPTION],
				}),
			),
		];
	}

	function renderPane(width: number): readonly PaneNode[] {
		const current = currentGame();
		const said =
			remark?.game === current
				? wrapText(`${rivalName(current)}: "${remark.text}"`, width).map(
						line => dim(line),
					)
				: [];
		return [
			paneHeadline(current, thinking),
			...said,
			BLANK,
			...renderBoardLines(pickedView(current, currentPick(current).from)),
			BLANK,
			...(notice ? [...wrapText(notice, width), BLANK] : []),
			...controlNodes(current, width),
		];
	}

	cmd.addRenderer(RENDERER, data => renderBoard(data as BoardView));

	// Hosts older than panes have no `capabilities`. Any newer host gets the
	// pane registered up front, ready for when the TUI draws it.
	if (cmd.ui.capabilities) {
		cmd.ui.pane({
			id: PANE,
			title: NAME,
			render: ({width}) => renderPane(width),
		});
		cmd.addShortcut('alt+c', {
			description: 'Open the chess board and play in it',
			handler: () => cmd.ui.openPane(PANE, {focus: true}),
		});
	}

	cmd.addCommand({
		name: 'chess',
		description:
			'Play chess against your session LLM, or a built-in engine, while the agent works',
		argumentHint:
			'<move> | new [black] | settings | undo | resign | help',
		handler: async ({args}) => {
			const action = parseAction(args);
			notice = '';
			if (hasPane() && action.kind !== 'settings')
				cmd.ui.openPane(PANE, {focus: action.kind === 'show'});
			const reply = await run(action);
			return reply.message ? {message: reply.message} : undefined;
		},
	});

	// A game left in progress shows in the footer from the start of the
	// session; while the agent works, the footer offers a game if there is none.
	cmd.hooks({
		onSessionStart: () => {
			if (game) cmd.ui.setStatus(statusText(game, thinking));
		},
	});
	cmd.on('run_start', () => {
		cmd.ui.setStatus(
			game
				? statusText(game, thinking)
				: `${PIECE} /chess to play while you wait`,
		);
	});
	cmd.on('run_end', () => {
		if (!game) cmd.ui.setStatus(null);
	});
}
