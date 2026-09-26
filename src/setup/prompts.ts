import {
	type CANCEL_SYMBOL,
	confirm as clackConfirm,
	intro as clackIntro,
	isCancel,
	multiselect as clackMultiselect,
	outro as clackOutro,
	select as clackSelect,
	text as clackText,
	type Option,
} from "@clack/prompts";

export class SetupCancelledError extends Error {
	constructor(message = "setup cancelled") {
		super(message);
		this.name = "SetupCancelledError";
	}
}

export type PromptSelectOption<T = string> = {
	value: T;
	label: string;
	hint?: string;
};

export function nonInteractiveTerminalMessage(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string {
	return [
		"feynman setup requires an interactive terminal.",
		platform === "win32" && env.MSYSTEM
			? "Git Bash's default window is not one Node can prompt in: run `winpty feynman setup`, or use PowerShell or Windows Terminal."
			: "Run it yourself in a terminal window, not through a script or an AI coding agent.",
		"To skip the prompts, set your provider's API key variable (for example OPENAI_API_KEY or ANTHROPIC_API_KEY) and run `feynman model set <provider/model>`.",
	].join("\n");
}

function ensureInteractiveTerminal(): void {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new Error(nonInteractiveTerminalMessage());
	}
}

function guardCancelled<T>(value: T | typeof CANCEL_SYMBOL): T {
	if (isCancel(value)) {
		throw new SetupCancelledError();
	}

	return value;
}

export function isInteractiveTerminal(): boolean {
	return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export async function promptIntro(title: string): Promise<void> {
	ensureInteractiveTerminal();
	clackIntro(title);
}

export async function promptOutro(message: string): Promise<void> {
	ensureInteractiveTerminal();
	clackOutro(message);
}

export async function promptText(
	question: string,
	defaultValue = "",
	placeholder?: string,
	signal?: AbortSignal,
): Promise<string> {
	ensureInteractiveTerminal();

	const value = guardCancelled(
		await clackText({
			message: question,
			initialValue: defaultValue || undefined,
			placeholder: placeholder ?? (defaultValue || undefined),
			signal,
		}),
	);

	const normalized = String(value ?? "").trim();
	return normalized || defaultValue;
}

export async function promptSelect<T>(
	question: string,
	options: PromptSelectOption<T>[],
	initialValue?: T,
	signal?: AbortSignal,
): Promise<T> {
	ensureInteractiveTerminal();

	const selection = guardCancelled(
		await clackSelect({
			message: question,
			options: options.map((option) => ({
				value: option.value,
				label: option.label,
				hint: option.hint,
			})) as Option<T>[],
			initialValue,
			signal,
		}),
	);

	return selection;
}

export async function promptChoice(question: string, choices: string[], defaultIndex = 0): Promise<number> {
	const options = choices.map((choice, index) => ({
		value: index,
		label: choice,
	}));
	return promptSelect(question, options, Math.max(0, Math.min(defaultIndex, choices.length - 1)));
}

export async function promptConfirm(question: string, initialValue = true): Promise<boolean> {
	ensureInteractiveTerminal();

	return guardCancelled(
		await clackConfirm({
			message: question,
			initialValue,
		}),
	);
}

export async function promptMultiSelect<T>(
	question: string,
	options: PromptSelectOption<T>[],
	initialValues: T[] = [],
): Promise<T[]> {
	ensureInteractiveTerminal();

	const selection = guardCancelled(
		await clackMultiselect({
			message: question,
			options: options.map((option) => ({
				value: option.value,
				label: option.label,
				hint: option.hint,
			})) as Option<T>[],
			initialValues,
			required: false,
		}),
	);

	return selection;
}
