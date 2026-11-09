// The slice of Command Code's `ModApi` this mod uses, declared locally so the
// project typechecks on its own. Command Code passes the full API at load
// time; these members match the documented signatures.

export interface Disposable {
	dispose(): void;
}

export interface ModCommandResult {
	readonly prompt?: string;
	readonly message?: string;
}

export interface ModCommandContext {
	readonly args: string;
}

export interface ModCommand {
	readonly name: string;
	readonly description?: string;
	readonly argumentHint?: string;
	readonly handler: (
		ctx: ModCommandContext,
	) => Promise<ModCommandResult | undefined>;
}

export interface ModHooks {
	readonly onSessionStart?: () => void;
}

export interface InputElement {
	readonly type: 'input';
	readonly key: string;
	readonly placeholder?: string;
	readonly value?: string;
	readonly onSubmit: (text: string) => void;
}

export interface SelectElement {
	readonly type: 'select';
	readonly key: string;
	readonly options: readonly {
		readonly label: string;
		readonly value: string;
	}[];
	readonly value?: string;
	readonly onSelect: (value: string) => void;
}

export type PaneNode = string | InputElement | SelectElement;

export interface ModPane {
	readonly id: string;
	readonly title: string;
	readonly render: (params: {width: number}) => readonly PaneNode[];
}

export interface ModUi {
	// Absent on hosts older than panes and widgets.
	readonly capabilities?: {readonly surface: boolean};
	setStatus(text: string | null): Disposable;
	pane(pane: ModPane): Disposable;
	openPane(id: string, options?: {focus?: boolean}): void;
	refreshWidgets(): void;
	copy(
		text: string,
	): Promise<{readonly isCopied: boolean; readonly reason?: string}>;
}

export interface ModShortcut {
	readonly description?: string;
	readonly handler: () => void;
}

export interface ModApi {
	readonly ui: ModUi;
	hooks(hooks: ModHooks): Disposable;
	on(event: 'run_start' | 'run_end', handler: () => void): Disposable;
	addCommand(command: ModCommand): Disposable;
	addShortcut(keys: string, shortcut: ModShortcut): Disposable;
	addRenderer(
		customType: string,
		render: (data: unknown) => readonly string[],
	): Disposable;
	showEntry(customType: string, data?: unknown): void;
}
