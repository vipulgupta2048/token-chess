// token-chess: play chess in the Command Code TUI while the agent works.
//
//   /chess e4      you move, the engine replies, the board prints in the feed
//
// Mod slash commands run while a turn is in flight, so a game goes on beside
// the agent's work. The footer status keeps the game state in view, and the
// engine yields to the event loop while it thinks so the stream never stalls.

import {type Action, HELP, parseAction} from './src/command.js';
import {chooseMove, type EngineResult, LEVELS} from './src/engine.js';
import {
	colorName,
	currentPosition,
	describeOutcome,
	type Game,
	moveListText,
	newGame,
	outcomeOf,
	playMove,
	undoTurn,
} from './src/game.js';
import type {ModApi} from './src/mod-api.js';
import {isInCheck, legalMoves} from './src/moves.js';
import {toFen} from './src/position.js';
import {type BoardView, bold, dim, renderBoard} from './src/render.js';
import {parseMove, toSan} from './src/san.js';
import {defaultGameFile, loadGame, saveGame} from './src/store.js';

const RENDERER = 'token-chess';
const DEFAULT_LEVEL = 3;
const PIECE = '♙';

interface Reply {
	readonly message?: string;
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

function formatNodes(nodes: number): string {
	if (nodes < 1000) return String(nodes);
	return `${(nodes / 1000).toFixed(1)}k`;
}

function boardView(game: Game, engine: EngineResult | undefined): BoardView {
	const position = currentPosition(game);
	const moves = moveListText(game, 10);
	const engineNote = engine
		? dim(
				` · engine depth ${engine.depth}, ${formatNodes(engine.nodes)} nodes`,
			)
		: '';
	return {
		fen: toFen(position),
		player: game.player,
		highlight: lastMoveSquares(game),
		heading: dim(
			`token-chess · you play ${colorName(game.player)} · level ${game.level} · move ${position.fullmove}`,
		),
		notes: [...(moves ? [`${moves}${engineNote}`] : []), promptLine(game)],
	};
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

function legalList(game: Game): string {
	const position = currentPosition(game);
	return legalMoves(position)
		.map(move => toSan(position, move))
		.join(' ');
}

export default function tokenChess(cmd: ModApi): void {
	const file = defaultGameFile();
	let game = loadGame(file);
	let thinking = false;

	function show(current: Game, engine?: EngineResult): void {
		saveGame(file, current);
		cmd.ui.setStatus(statusText(current, thinking));
		cmd.showEntry(RENDERER, boardView(current, engine));
	}

	async function engineTurn(current: Game): Promise<void> {
		const position = currentPosition(current);
		if (position.turn === current.player) return show(current);
		if (outcomeOf(current).kind !== 'ongoing') return show(current);
		const level = LEVELS[current.level - 1] ?? LEVELS[DEFAULT_LEVEL - 1];
		if (!level) return show(current);
		thinking = true;
		cmd.ui.setStatus(statusText(current, thinking));
		const result = await chooseMove(position, level);
		thinking = false;
		if (!result) return show(current);
		// A /chess new or undo while the engine thought replaced the game:
		// this reply belongs to a board that no longer exists.
		if (game !== current) return;
		game = playMove(current, result.move);
		show(game, result);
	}

	async function startNew(
		action: Extract<Action, {kind: 'new'}>,
	): Promise<Reply> {
		game = newGame({
			player: action.player,
			level: game?.level ?? DEFAULT_LEVEL,
		});
		await engineTurn(game);
		return {};
	}

	async function move(text: string): Promise<Reply> {
		const current = game ?? newGame({player: 'w', level: DEFAULT_LEVEL});
		game = current;
		if (thinking)
			return {message: 'The engine is still thinking. One moment.'};
		if (outcomeOf(current).kind !== 'ongoing')
			return {message: 'This game is over. /chess new starts another.'};
		const chosen = parseMove(currentPosition(current), text);
		if (!chosen)
			return {
				message: `${text} is not legal here. Legal moves: ${legalList(current)}`,
			};
		// One board per turn: it prints after the engine's reply (or right
		// away when this move ended the game); the footer covers the wait.
		game = playMove(current, chosen);
		await engineTurn(game);
		return {};
	}

	async function run(action: Action): Promise<Reply> {
		if (action.kind === 'help') return {message: HELP};
		if (action.kind === 'invalid') return {message: action.message};
		if (action.kind === 'new') return startNew(action);
		if (action.kind === 'move') return move(action.text);
		const current = game ?? newGame({player: 'w', level: DEFAULT_LEVEL});
		game = current;
		if (action.kind === 'level') {
			game = {...current, level: action.level};
			saveGame(file, game);
			return {message: `Engine level set to ${action.level}.`};
		}
		if (action.kind === 'resign') {
			if (outcomeOf(current).kind !== 'ongoing')
				return {message: 'This game is already over.'};
			game = {...current, resigned: true};
		}
		if (action.kind === 'undo') {
			if (thinking)
				return {message: 'Wait for the engine to finish its move.'};
			game = undoTurn(current);
			if (game === current)
				return {message: 'Nothing of yours to take back.'};
		}
		show(game);
		return {};
	}

	cmd.addRenderer(RENDERER, data => renderBoard(data as BoardView));

	cmd.addCommand({
		name: 'chess',
		description: 'Play chess against a local engine while the agent works',
		argumentHint:
			'<move> | new [black] | undo | level <1-5> | resign | help',
		handler: async ({args}) => {
			const reply = await run(parseAction(args));
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
