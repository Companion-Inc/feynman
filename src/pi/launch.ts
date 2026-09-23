import { spawn } from "node:child_process";
import { constants } from "node:os";

import {
	buildPiArgs,
	buildPiEnv,
	ensureFeynmanCommandShim,
	ensureFeynmanWorkspaceScaffold,
	type PiRuntimeOptions,
	resolvePiCliPath,
} from "./runtime.js";
import { resolveAllExecutables } from "../system/executables.js";

export function exitCodeFromSignal(signal: NodeJS.Signals): number {
	const signalNumber = constants.signals[signal];
	return typeof signalNumber === "number" ? 128 + signalNumber : 1;
}

export async function runPi(
	options: PiRuntimeOptions,
	args: string[],
	env: NodeJS.ProcessEnv,
	stdin: "inherit" | "ignore" = "inherit",
): Promise<number> {
	const piCliPath = resolvePiCliPath(options.appRoot);
	if (!piCliPath) {
		throw new Error("Pi CLI not found. Reinstall Feynman.");
	}
	const child = spawn(process.execPath, [piCliPath, ...args], {
		cwd: options.workingDir,
		stdio: [stdin, "inherit", "inherit"],
		env,
	});

	return await new Promise<number>((resolvePromise, reject) => {
		child.on("error", reject);
		child.on("exit", (code, signal) => {
			if (signal) {
				console.error(`feynman terminated because the Pi child exited with ${signal}.`);
				resolvePromise(exitCodeFromSignal(signal));
				return;
			}
			resolvePromise(code ?? 0);
		});
	});
}

export async function launchPiChat(options: PiRuntimeOptions): Promise<void> {
	if (process.stdout.isTTY && options.mode !== "rpc") {
		process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
	}

	if (options.preLaunchNotice) {
		process.stdout.write(`${options.preLaunchNotice}\n`);
	}

	const executables = await resolveAllExecutables();
	ensureFeynmanCommandShim(options.appRoot, options.feynmanAgentDir);
	ensureFeynmanWorkspaceScaffold(options.workingDir);
	// Outside RPC mode Pi reads piped stdin until EOF and prepends it to the
	// prompt, so an open but idle stdin from a non-TTY parent would hang an
	// explicit prompt forever.
	const explicitPrompt = Boolean(options.oneShotPrompt || options.initialPrompt);
	const stdin = explicitPrompt && options.mode !== "rpc" && !process.stdin.isTTY ? "ignore" : "inherit";
	process.exitCode = await runPi(options, buildPiArgs(options), buildPiEnv(options, executables), stdin);
}
