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

export interface ModUi {
	setStatus(text: string | null): Disposable;
}

export interface ModApi {
	readonly ui: ModUi;
	hooks(hooks: ModHooks): Disposable;
	on(event: 'run_start' | 'run_end', handler: () => void): Disposable;
	addCommand(command: ModCommand): Disposable;
	addRenderer(
		customType: string,
		render: (data: unknown) => readonly string[],
	): Disposable;
	showEntry(customType: string, data?: unknown): void;
}
