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

function ensureInteractiveTerminal(): void {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new Error("feynman setup requires an interactive terminal.");
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
