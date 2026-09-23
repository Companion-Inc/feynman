import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, resolve } from "node:path";

import {
	BROWSER_FALLBACK_PATHS,
	MERMAID_FALLBACK_PATHS,
	PANDOC_FALLBACK_PATHS,
	resolveExecutable,
	type ResolvedExecutables,
} from "../system/executables.js";
import { getPostHogOtelEnv, isTelemetryDisabled } from "../telemetry/posthog.js";

// Pi packages shipped as Feynman dependencies and loaded from their install
// paths through settings.json `packages` (Pi's documented local-path source).
export const BUNDLED_PI_PACKAGES = ["pi-subagents", "pi-web-access", "pi-docparser", "pi-btw", "pi-otel"] as const;

export type PiRuntimeOptions = {
	appRoot: string;
	workingDir: string;
	sessionDir: string;
	feynmanAgentDir: string;
	feynmanVersion?: string;
	mode?: "text" | "json" | "rpc";
	thinkingLevel?: string;
	explicitModelSpec?: string;
	resumeRecentSession?: boolean;
	piArgs?: string[];
	oneShotPrompt?: string;
	initialPrompt?: string;
	preLaunchNotice?: string;
};

export function resolvePackageRoot(appRoot: string, packageName: string): string | undefined {
	const lookupPaths = createRequire(resolve(appRoot, "package.json")).resolve.paths(packageName) ?? [];
	return lookupPaths
		.map((nodeModulesPath) => resolve(nodeModulesPath, packageName))
		.find((packageRoot) => existsSync(resolve(packageRoot, "package.json")));
}

export function resolvePiCliPath(appRoot: string): string | undefined {
	const piRoot = resolvePackageRoot(appRoot, "@earendil-works/pi-coding-agent");
	if (!piRoot) return undefined;
	const bin = (JSON.parse(readFileSync(resolve(piRoot, "package.json"), "utf8")) as { bin?: Record<string, string> }).bin?.pi;
	return bin ? resolve(piRoot, bin) : undefined;
}

export function getFeynmanPackageSources(appRoot: string): string[] {
	// pi-otel only carries Feynman telemetry; without its PostHog env it would
	// probe a local collector and warn on stderr.
	const packageNames = isTelemetryDisabled() ? BUNDLED_PI_PACKAGES.filter((name) => name !== "pi-otel") : BUNDLED_PI_PACKAGES;
	return [
		appRoot,
		...packageNames.map((packageName) => resolvePackageRoot(appRoot, packageName))
			.filter((packageRoot): packageRoot is string => Boolean(packageRoot)),
	];
}

export function getFeynmanCommandShimDir(feynmanAgentDir: string): string {
	return resolve(dirname(feynmanAgentDir), "bin");
}

export function getFeynmanCliBinPath(appRoot: string): string {
	return resolve(appRoot, "bin", "feynman.js");
}

function shellSingleQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

export function ensureFeynmanCommandShim(appRoot: string, feynmanAgentDir: string): string {
	const shimDir = getFeynmanCommandShimDir(feynmanAgentDir);
	const shimPath = resolve(shimDir, "feynman");
	const feynmanBinPath = getFeynmanCliBinPath(appRoot);
	const script = [
		"#!/bin/sh",
		'FEYNMAN_NODE="${FEYNMAN_NODE_EXECUTABLE:-node}"',
		'FEYNMAN_BIN="${FEYNMAN_BIN_PATH:-}"',
		'if [ -z "$FEYNMAN_BIN" ]; then',
		`\tFEYNMAN_BIN=${shellSingleQuote(feynmanBinPath)}`,
		"fi",
		'exec "$FEYNMAN_NODE" "$FEYNMAN_BIN" "$@"',
		"",
	].join("\n");

	mkdirSync(shimDir, { recursive: true });
	writeFileSync(shimPath, script, { encoding: "utf8", mode: 0o755 });
	chmodSync(shimPath, 0o755);
	return shimPath;
}

export function ensureFeynmanWorkspaceScaffold(
	workingDir: string,
	createDirectory: typeof mkdirSync = mkdirSync,
): boolean {
	for (const relPath of [
		"outputs/.plans",
		"outputs/.drafts",
		"papers",
		"notes",
	]) {
		try {
			createDirectory(resolve(workingDir, relPath), { recursive: true });
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
				return false;
			}
			throw error;
		}
	}
	return true;
}

export function validatePiInstallation(appRoot: string): string[] {
	const missing: string[] = [];
	const piCliPath = resolvePiCliPath(appRoot);
	if (!piCliPath || !existsSync(piCliPath)) missing.push("@earendil-works/pi-coding-agent");
	for (const packageName of BUNDLED_PI_PACKAGES) {
		if (!resolvePackageRoot(appRoot, packageName)) missing.push(packageName);
	}
	for (const path of [resolve(appRoot, "extensions", "research-tools.ts"), resolve(appRoot, "prompts")]) {
		if (!existsSync(path)) missing.push(path);
	}
	return missing;
}

export function buildPiArgs(options: PiRuntimeOptions): string[] {
	const args = ["--session-dir", options.sessionDir];
	const systemPromptPath = resolve(options.appRoot, ".feynman", "SYSTEM.md");
	if (existsSync(systemPromptPath)) {
		args.push("--system-prompt", systemPromptPath);
	}
	if (options.mode) {
		args.push("--mode", options.mode);
	}
	if (options.explicitModelSpec) {
		args.push("--model", options.explicitModelSpec);
	}
	if (options.thinkingLevel) {
		args.push("--thinking", options.thinkingLevel);
	}
	if (options.resumeRecentSession) {
		args.push("--continue");
	}
	args.push(...(options.piArgs ?? []));
	if (options.oneShotPrompt) {
		args.push("-p", "--", options.oneShotPrompt);
	} else if (options.initialPrompt) {
		args.push("--", options.initialPrompt);
	}
	return args;
}

export function buildPiEnv(options: PiRuntimeOptions, executables?: ResolvedExecutables): NodeJS.ProcessEnv {
	const binPath = [getFeynmanCommandShimDir(options.feynmanAgentDir), resolve(options.appRoot, "node_modules", ".bin")].join(delimiter);
	const pandocPath = process.env.PANDOC_PATH ?? executables?.pandoc ?? resolveExecutable("pandoc", PANDOC_FALLBACK_PATHS);
	const mermaidPath = process.env.MERMAID_CLI_PATH ?? executables?.mermaid ?? resolveExecutable("mmdc", MERMAID_FALLBACK_PATHS);
	const browserPath =
		process.env.PUPPETEER_EXECUTABLE_PATH ?? executables?.browser ?? resolveExecutable("google-chrome", BROWSER_FALLBACK_PATHS);
	return {
		...process.env,
		...getPostHogOtelEnv("feynman-pi", options.feynmanVersion),
		PATH: `${binPath}${delimiter}${process.env.PATH ?? ""}`,
		FEYNMAN_VERSION: options.feynmanVersion,
		FEYNMAN_NODE_EXECUTABLE: process.execPath,
		FEYNMAN_BIN_PATH: getFeynmanCliBinPath(options.appRoot),
		PI_CODING_AGENT_DIR: options.feynmanAgentDir,
		PANDOC_PATH: pandocPath,
		PI_HARDWARE_CURSOR: process.env.PI_HARDWARE_CURSOR ?? "1",
		PI_SKIP_VERSION_CHECK: process.env.PI_SKIP_VERSION_CHECK ?? "1",
		MERMAID_CLI_PATH: mermaidPath,
		PUPPETEER_EXECUTABLE_PATH: browserPath,
	};
}
