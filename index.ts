// token-chess: play chess in the Command Code TUI while the agent works.
//
//   /chess         the board opens in a pane above the prompt; type moves in it
//   /chess e4      the same move from the prompt, the pane updates in place
//
// Pane input and mod slash commands both run while a turn is in flight, so a
// game goes on beside the agent's work. The footer status keeps the game state
// in view, and the engine yields to the event loop while it thinks so the
// stream never stalls. Hosts without panes get a board in the feed each turn.

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
	capturedPieces,
	type Game,
	materialLead,
	moveLines,
	moveListText,
	newGame,
	outcomeOf,
	playMove,
	toPgn,
	undoTurn,
} from './src/game.js';
import type {ModApi, PaneNode} from './src/mod-api.js';
import {isInCheck} from './src/moves.js';
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
	GLYPHS,
	renderBoard,
	renderPanel,
	wrapText,
} from './src/render.js';
import {explainIllegal, parseMove} from './src/san.js';
import {defaultGameFile, loadGame, saveGame} from './src/store.js';

const RENDERER = 'token-chess';
const PANE = 'board';
const PIECE = '♙';
const PANE_MOVES = 4;
// A pane drops empty lines, so a gap between sections is one space.
const BLANK = ' ';

const WAIT = 'wait';
const UNDO = 'undo';
const NEW = 'new';
const LEVEL = 'level';
const RESIGN = 'resign';
const RESIGN_YES = 'resign-yes';
const TYPE = 'type';
const PGN = 'pgn';

type Stage = 'piece' | 'target' | 'menu' | 'side' | 'level' | 'resign';

interface Reply {
	readonly message?: string;
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
		return `${check}${dim('engine is thinking…')}`;
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
			`token-chess · you play ${colorName(game.player)} · level ${game.level} · move ${position.fullmove}`,
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
	const prompt = thinking ? 'Thinking…' : bold('Your move');
	return `${check}${prompt}${lastMoveText(game)}`;
}

function materialText(game: Game): string {
	const lead = materialLead(game);
	if (lead === 0) return '';
	return lead > 0 ? `You're up ${lead}` : `You're down ${-lead}`;
}

function glyphs(letters: readonly string[]): string {
	return letters.map(letter => GLYPHS[letter] ?? '').join('');
}

// Recent moves, then what each side has taken and who is ahead.
function sideLines(game: Game): readonly string[] {
	const taken = capturedPieces(game, opponent(game.player));
	const lost = capturedPieces(game, game.player);
	const material = materialText(game);
	const tally = [
		...(taken.length > 0 ? [`Taken ${glyphs(taken)}`] : []),
		...(lost.length > 0 ? [`Lost  ${glyphs(lost)}`] : []),
		...(material ? [material] : []),
	];
	return [
		...moveLines(game, PANE_MOVES),
		...(tally.length > 0 ? [BLANK, ...tally.map(line => dim(line))] : []),
	];
}

function statusText(game: Game, thinking: boolean): string {
	if (thinking) return `${PIECE} chess · thinking…`;
	const outcome = outcomeOf(game);
	if (outcome.kind !== 'ongoing')
		return `${PIECE} chess · ${describeOutcome(outcome)}`;
	const last = game.sanLog[game.sanLog.length - 1];
	const lastText = last ? ` · last ${last}` : '';
	const turn =
		currentPosition(game).turn === game.player
			? 'your move'
			: 'engine to move';
	return `${PIECE} chess · ${turn}${lastText}`;
}

export default function tokenChess(cmd: ModApi): void {
	const file = defaultGameFile();
	const hasPane = cmd.ui.capabilities?.surface === true;
	let game = loadGame(file);
	let thinking = false;
	let searches = 0;
	// The answer to the last thing typed in the pane, until the next one.
	let notice = '';
	let pick: Pick | undefined;
	let isTyping = false;

	function currentPick(current: Game): Pick {
		return pick?.game === current
			? pick
			: {game: current, stage: 'piece', page: 0};
	}

	function currentGame(): Game {
		game ??= newGame({player: 'w', level: DEFAULT_LEVEL});
		return game;
	}

	function paint(current: Game): void {
		cmd.ui.setStatus(statusText(current, thinking));
		if (hasPane) cmd.ui.refreshWidgets();
	}

	function show(current: Game): void {
		saveGame(file, current);
		paint(current);
		if (!hasPane) cmd.showEntry(RENDERER, boardView(current));
	}

	async function engineTurn(current: Game): Promise<void> {
		const position = currentPosition(current);
		if (position.turn === current.player) return show(current);
		if (outcomeOf(current).kind !== 'ongoing') return show(current);
		const level = LEVELS[current.level - 1] ?? LEVELS[DEFAULT_LEVEL - 1];
		if (!level) return show(current);
		const search = ++searches;
		thinking = true;
		paint(current);
		const result = await chooseMove(position, level, current.positions);
		if (search === searches) thinking = false;
		// A /chess new or resign while the engine thought replaced the game:
		// this reply belongs to a board that no longer exists.
		if (game && game !== current) return paint(game);
		if (!result) return show(current);
		game = playMove(current, result.move);
		show(game);
	}

	// Leaves any search running to finish unheard: its game is gone.
	function abandonSearch(): void {
		searches++;
		thinking = false;
	}

	async function startNew(
		action: Extract<Action, {kind: 'new'}>,
	): Promise<Reply> {
		abandonSearch();
		game = newGame({
			player: action.player,
			level: game?.level ?? DEFAULT_LEVEL,
		});
		await engineTurn(game);
		return {};
	}

	async function move(text: string): Promise<Reply> {
		const current = currentGame();
		if (thinking)
			return {message: 'The engine is still thinking. One moment.'};
		if (outcomeOf(current).kind !== 'ongoing')
			return {message: 'This game is over. /chess new starts another.'};
		// Only a hand-edited save leaves the engine to move with none thinking.
		if (currentPosition(current).turn !== current.player) {
			void engineTurn(current);
			return {message: 'The engine is to move. One moment.'};
		}
		const chosen = parseMove(currentPosition(current), text);
		if (!chosen)
			return {message: explainIllegal(currentPosition(current), text)};
		// The pane shows your move at once; the feed prints one board per
		// turn, after the engine's reply, and the footer covers the wait.
		game = playMove(current, chosen);
		await engineTurn(game);
		return {};
	}

	async function run(action: Action): Promise<Reply> {
		if (action.kind === 'help') return {message: HELP};
		if (action.kind === 'invalid') return {message: action.message};
		if (action.kind === 'new') return startNew(action);
		if (action.kind === 'move') return move(action.text);
		if (action.kind === 'pgn') return copyPgn(currentGame());
		const current = currentGame();
		if (action.kind === 'level') {
			if (thinking)
				return {message: 'Wait for the engine to finish its move.'};
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
			if (thinking)
				return {message: 'Wait for the engine to finish its move.'};
			game = undoTurn(current);
			if (game === current)
				return {message: 'Nothing of yours to take back.'};
		}
		show(game ?? current);
		return {};
	}

	// Copies the game for any chess site; where nothing can copy, the PGN
	// itself is the answer.
	async function copyPgn(current: Game): Promise<Reply> {
		const pgn = toPgn(current, new Date());
		const copied = await cmd.ui.copy(pgn);
		if (copied.isCopied) return {message: 'PGN copied to the clipboard.'};
		return {message: pgn};
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
		if (value === UNDO) return void runInPane({kind: 'undo'});
		if (value === PGN) return void runInPane({kind: 'pgn'});
		if (value === RESIGN) return goTo({...inMenu, stage: 'resign'});
		if (value === RESIGN_YES) return void runInPane({kind: 'resign'});
		if (value === NEW) return goTo({...inMenu, stage: 'side'});
		if (value === 'w' || value === 'b')
			return void runInPane({kind: 'new', player: value});
		if (value === LEVEL) return goTo({...inMenu, stage: 'level'});
		if (state.stage === 'level')
			return void runInPane({kind: 'level', level: Number(value)});
		if (value === TYPE) {
			isTyping = true;
			return goTo(atPieces);
		}
		if (state.stage === 'target')
			return void runInPane({kind: 'move', text: value});
		goTo({game: current, stage: 'target', from: value, page: 0});
	}

	// An empty Enter leaves typing for the picker again.
	function submitTyped(text: string): void {
		if (text.trim() !== '') return void runInPane(parseAction(text));
		isTyping = false;
		cmd.ui.refreshWidgets();
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
				dim('Engine to move'),
				select('wait', [{label: 'Thinking…', value: WAIT}]),
			];
		if (stage === 'menu')
			return [
				dim('Menu'),
				select(
					`menu-${page}`,
					pageOf({
						options: [
							{label: 'Undo', value: UNDO},
							{label: 'New game', value: NEW},
							{label: `Level ${current.level}`, value: LEVEL},
							{label: 'Resign', value: RESIGN},
							{label: 'Type a move', value: TYPE},
							{label: 'Copy PGN', value: PGN},
						],
						page,
						width,
						tail: [BACK_OPTION],
					}),
				),
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
		if (stage === 'level')
			return [
				dim('Engine level:'),
				select(
					'level',
					[
						...Array.from({length: MAX_LEVEL}, (_, index) => ({
							label: String(index + 1),
							value: String(index + 1),
						})),
						BACK_OPTION,
					],
					String(current.level),
				),
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
					{label: 'Copy PGN', value: PGN},
				]),
			];
		if (isTyping)
			return [
				dim('Type a move, or press Enter alone for the picker'),
				{
					type: 'input',
					key: 'move',
					placeholder: 'e4, Nf3, O-O',
					value: '',
					onSubmit: submitTyped,
				},
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
		return [
			paneHeadline(current, thinking),
			BLANK,
			...renderPanel({
				view: pickedView(current, currentPick(current).from),
				side: sideLines(current),
				width,
			}),
			BLANK,
			...(notice ? [...wrapText(notice, width), BLANK] : []),
			...controlNodes(current, width),
		];
	}

	cmd.addRenderer(RENDERER, data => renderBoard(data as BoardView));

	if (hasPane) {
		cmd.ui.pane({
			id: PANE,
			title: 'Chess',
			render: ({width}) => renderPane(width),
		});
		cmd.addShortcut('alt+c', {
			description: 'Open the chess board and play in it',
			handler: () => cmd.ui.openPane(PANE, {focus: true}),
		});
	}

	cmd.addCommand({
		name: 'chess',
		description: 'Play chess against a local engine while the agent works',
		argumentHint:
			'<move> | new [black] | undo | level <1-5> | resign | help',
		handler: async ({args}) => {
			const action = parseAction(args);
			notice = '';
			if (hasPane) cmd.ui.openPane(PANE, {focus: action.kind === 'show'});
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
