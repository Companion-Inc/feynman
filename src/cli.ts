import { loadEnvFile } from "node:process";

// Native replacement for dotenv/config: load a cwd .env when present.
try {
	loadEnvFile();
} catch {
	// No .env in the working directory - nothing to load.
}

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import {
	getUserName as getAlphaUserName,
	login as loginAlpha,
	logout as logoutAlpha,
} from "@companion-ai/alpha-hub/lib";
import { getValidToken as getValidAlphaToken } from "@companion-ai/alpha-hub/lib/auth";
import { SettingsManager } from "@earendil-works/pi-coding-agent";

import { verifyAlphaAuthStatus } from "./alpha-auth-status.js";
import { syncBundledAssets } from "./bootstrap/sync.js";
import { ensureFeynmanHome, getDefaultSessionDir, getFeynmanAgentDir, getFeynmanHome } from "./config/paths.js";
import { launchPiChat } from "./pi/launch.js";
import {
	installPackageSources,
	reconcileManagedCorePackageInstalls,
	updateConfiguredPackages,
} from "./pi/package-ops.js";
import { MAX_NATIVE_PACKAGE_NODE_MAJOR } from "./pi/package-presets.js";
import {
	CORE_PACKAGE_SOURCES,
	getOptionalPackagePresetSources,
	isOptionalPackagePresetSupported,
	listOptionalPackagePresetInstallTargets,
	listOptionalPackagePresets,
	normalizeOptionalPackagePresetName,
	resolvePackageUpdateSources,
} from "./pi/package-presets.js";
import {
	canonicalizeModelSpec,
	normalizeFeynmanSettings,
	normalizeThinkingLevel,
	parseModelSpec,
	type ThinkingLevel,
} from "./pi/settings.js";
import { applyFeynmanPackageManagerEnv } from "./pi/runtime.js";
import { getConfiguredServiceTier, normalizeServiceTier, setConfiguredServiceTier } from "./model/service-tier.js";
import {
	authenticateModelProvider,
	getCurrentModelSpec,
	isLocalModelProvider,
	loginModelProvider,
	logoutModelProvider,
	printModelList,
	setDefaultModelSpec,
} from "./model/commands.js";
import {
	buildModelStatusSnapshotFromRecords,
	getAuthenticatedModelRecords,
	isProClassModelSpec,
	getSupportedModelRecords,
} from "./model/catalog.js";
import { clearSearchConfig, printSearchStatus, setSearchProvider } from "./search/commands.js";
import type { PiWebSearchProvider } from "./pi/web-access.js";
import { fetchLatestFeynmanVersion, getFeynmanUpgradeLines, isNewerVersion } from "./system/self-update.js";
import { runDoctor, runStatus } from "./setup/doctor.js";
import { setupPreviewDependencies } from "./setup/preview.js";
import { runSetup } from "./setup/setup.js";
import {
	captureTelemetryEvent,
	emitTelemetryLog,
	getCliTelemetryMetadata,
	initializePostHogTelemetry,
	shutdownPostHogTelemetry,
	startTelemetrySpan,
	telemetryErrorProperties,
} from "./telemetry/posthog.js";
import { ASH, printAsciiHeader, printInfo, printPanel, printSection, RESET, SAGE } from "./ui/terminal.js";
import { createModelRuntime } from "./model/registry.js";
import {
	cliCommandSections,
	formatCliWorkflowUsage,
	legacyFlags,
	readPromptSpecs,
	topLevelCommandNames,
} from "../metadata/commands.mjs";

const TOP_LEVEL_COMMANDS = new Set(topLevelCommandNames);
const ALPHA_HUB_PACKAGE_PATH = ["@companion-ai", "alpha-hub"] as const;

function printHelpLine(usage: string, description: string): void {
	const width = 30;
	const padding = Math.max(1, width - usage.length);
	console.log(`  ${SAGE}${usage}${RESET}${" ".repeat(padding)}${ASH}${description}${RESET}`);
}

function printHelp(appRoot: string): void {
	const workflowCommands = readPromptSpecs(appRoot).filter(
		(command) => command.section === "Research Workflows" && command.topLevelCli,
	);

	printAsciiHeader([
		"Research-first agent shell built on Pi.",
		"Use `feynman setup` first if this is a new machine.",
	]);

	printSection("Getting Started");
	printInfo("feynman");
	printInfo("feynman setup");
	printInfo("feynman doctor");
	printInfo("feynman model");
	printInfo("feynman search status");

	printSection("Commands");
	for (const section of cliCommandSections) {
		for (const command of section.commands) {
			printHelpLine(command.usage, command.description);
		}
	}

	printSection("Research Workflows");
	for (const command of workflowCommands) {
		printHelpLine(formatCliWorkflowUsage(command), command.description);
	}

	printSection("Legacy Flags");
	for (const flag of legacyFlags) {
		printHelpLine(flag.usage, flag.description);
	}

	printSection("REPL");
	printInfo("Inside the REPL, slash workflows come from the live prompt-template and extension command set.");
}

export function resolveBundledAlphaCliPath(appRoot: string): string {
	let resolvedPackageAlpha: string | undefined;
	try {
		const requireFromApp = createRequire(resolve(appRoot, "package.json"));
		const packageEntryPath = requireFromApp.resolve("@companion-ai/alpha-hub");
		resolvedPackageAlpha = resolve(dirname(packageEntryPath), "..", "bin", "alpha");
	} catch {
		resolvedPackageAlpha = undefined;
	}
	const candidates = [
		resolvedPackageAlpha,
		resolve(appRoot, "node_modules", ...ALPHA_HUB_PACKAGE_PATH, "bin", "alpha"),
		resolve(appRoot, ".feynman", "npm", "node_modules", ...ALPHA_HUB_PACKAGE_PATH, "bin", "alpha"),
	].filter((candidate): candidate is string => Boolean(candidate));
	const found = candidates.find((candidate) => existsSync(candidate));
	if (!found) {
		throw new Error(`Bundled alphaXiv CLI not found. Checked: ${candidates.join(", ")}`);
	}
	return found;
}

type AlphaPassthroughArgs = {
	args: string[];
	cwd: string;
};

export function resolveAlphaPassthroughArgs(rawArgs: string[], defaultCwd = process.cwd()): AlphaPassthroughArgs | undefined {
	let cwd = defaultCwd;
	for (let index = 0; index < rawArgs.length; index += 1) {
		const arg = rawArgs[index];
		if (arg === "alpha") {
			return { args: rawArgs.slice(index + 1), cwd };
		}
		if (arg === "--cwd") {
			const next = rawArgs[index + 1];
			if (!next) {
				return undefined;
			}
			cwd = resolve(next);
			index += 1;
			continue;
		}
		if (arg?.startsWith("--cwd=")) {
			cwd = resolve(arg.slice("--cwd=".length));
			continue;
		}
		return undefined;
	}
	return undefined;
}

export async function runBundledAlphaCli(appRoot: string, args: string[], options: { cwd?: string } = {}): Promise<void> {
	const alphaCliPath = resolveBundledAlphaCliPath(appRoot);
	const child = spawn(process.execPath, [alphaCliPath, ...args], {
		cwd: options.cwd ?? process.cwd(),
		stdio: "inherit",
		env: process.env,
	});

	await new Promise<void>((resolvePromise, reject) => {
		child.on("error", reject);
		child.on("exit", (code, signal) => {
			if (signal) {
				process.exitCode = 1;
				console.error(`feynman alpha terminated because the alpha child exited with ${signal}.`);
				resolvePromise();
				return;
			}
			process.exitCode = code ?? 0;
			resolvePromise();
		});
	});
}

async function handleAlphaCommand(action: string | undefined): Promise<void> {
	if (action === "login") {
		const result = await loginAlpha();
		const name =
			result.userInfo &&
			typeof result.userInfo === "object" &&
			"name" in result.userInfo &&
			typeof result.userInfo.name === "string"
				? result.userInfo.name
				: getAlphaUserName();
		console.log(name ? `alphaXiv login complete: ${name}` : "alphaXiv login complete");
		return;
	}

	if (action === "logout") {
		logoutAlpha();
		console.log("alphaXiv auth cleared");
		return;
	}

	if (!action || action === "status") {
		const status = await verifyAlphaAuthStatus({ getValidToken: getValidAlphaToken });
		if (status.authenticated) {
			const name = status.name ?? getAlphaUserName();
			console.log(name ? `alphaXiv logged in as ${name}` : "alphaXiv logged in");
		} else {
			console.log("alphaXiv not logged in");
			process.exitCode = 1;
		}
		return;
	}

	throw new Error(`Unknown alpha command: ${action}`);
}

async function handleModelCommand(subcommand: string | undefined, args: string[], feynmanSettingsPath: string, feynmanAuthPath: string): Promise<void> {
	if (!subcommand || subcommand === "list") {
		await printModelList(feynmanSettingsPath, feynmanAuthPath);
		return;
	}

	if (subcommand === "login") {
		if (args[0]) {
			// Specific provider given - resolve OAuth vs API-key setup automatically
			await loginModelProvider(feynmanAuthPath, args[0], feynmanSettingsPath);
		} else {
			// No provider specified - show auth method choice
			await authenticateModelProvider(feynmanAuthPath, feynmanSettingsPath);
		}
		return;
	}

	if (subcommand === "logout") {
		await logoutModelProvider(feynmanAuthPath, args[0]);
		return;
	}

	if (subcommand === "set") {
		const spec = args[0];
		if (!spec) {
			throw new Error("Usage: feynman model set <provider/model|provider:model>");
		}
		await setDefaultModelSpec(feynmanSettingsPath, feynmanAuthPath, spec);
		return;
	}

	if (subcommand === "tier") {
		const requested = args[0];
		if (!requested) {
			console.log(getConfiguredServiceTier(feynmanSettingsPath) ?? "not set");
			return;
		}

		if (requested === "unset" || requested === "clear" || requested === "off") {
			setConfiguredServiceTier(feynmanSettingsPath, undefined);
			console.log("Cleared service tier override");
			return;
		}

		const tier = normalizeServiceTier(requested);
		if (!tier) {
			throw new Error("Usage: feynman model tier <auto|default|flex|priority|standard_only|unset>");
		}

		setConfiguredServiceTier(feynmanSettingsPath, tier);
		console.log(`Service tier set to ${tier}`);
		return;
	}

	throw new Error(`Unknown model command: ${subcommand}`);
}

async function handleUpdateCommand(
	workingDir: string,
	feynmanAgentDir: string,
	appRoot: string,
	feynmanVersion: string | undefined,
	source?: string,
): Promise<void> {
	const latestFeynmanVersionPromise = fetchLatestFeynmanVersion();
	try {
		const updateSources = source ? resolvePackageUpdateSources(source) : [undefined];
		const results = [];
		for (const updateSource of updateSources) {
			results.push(await updateConfiguredPackages(workingDir, feynmanAgentDir, updateSource));
		}

		const updated = results.flatMap((result) => result.updated);
		const skipped = results.flatMap((result) => result.skipped);

		if (updated.length === 0 && skipped.length === 0) {
			console.log("All packages up to date.");
			return;
		}

		for (const updatedSource of updated) {
			console.log(`Updated ${updatedSource}`);
		}
		for (const skippedSource of skipped) {
			console.log(`Skipped ${skippedSource} on Node ${process.versions.node} (native packages are only supported through Node ${MAX_NATIVE_PACKAGE_NODE_MAJOR}.x).`);
		}
		if (updated.length === 0) {
			return;
		}
		console.log("All packages up to date.");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes("No supported package manager found")) {
			console.log("No package manager is available for live package updates.");
			console.log("If you installed the standalone app, rerun the installer to get newer bundled packages.");
			return;
		}

		throw error;
	} finally {
		// `feynman update` covers Pi packages only; tell the user when the CLI
		// itself is behind so they are not left assuming everything is current
		// (issue #177).
		const latestVersion = await latestFeynmanVersionPromise;
		if (feynmanVersion && latestVersion && isNewerVersion(latestVersion, feynmanVersion)) {
			const standaloneBundle =
				!existsSync(resolve(appRoot, ".feynman", "runtime-workspace.tgz")) && existsSync(resolve(appRoot, ".feynman", "npm"));
			for (const line of getFeynmanUpgradeLines(latestVersion, feynmanVersion, { standaloneBundle })) {
				console.log(line);
			}
		}
	}
}

async function handlePackagesCommand(subcommand: string | undefined, args: string[], workingDir: string, feynmanAgentDir: string): Promise<void> {
	applyFeynmanPackageManagerEnv(feynmanAgentDir);
	const settingsManager = SettingsManager.create(workingDir, feynmanAgentDir);
	const configuredSources = new Set(
		settingsManager
			.getPackages()
			.map((entry) => (typeof entry === "string" ? entry : entry.source))
			.filter((entry): entry is string => typeof entry === "string"),
	);

	if (!subcommand || subcommand === "list") {
		printPanel("Feynman Packages", [
			"Core packages are installed by default to keep first-run setup fast.",
		]);
		printSection("Core");
		for (const source of CORE_PACKAGE_SOURCES) {
			printInfo(source);
		}
		printSection("Optional");
		const optionalPresets = listOptionalPackagePresets();
		if (optionalPresets.length === 0) {
			printInfo(`No optional package presets are available on ${process.platform}.`);
			return;
		}
		for (const preset of optionalPresets) {
			const installed = preset.sources.every((source) => configuredSources.has(source));
			printInfo(`${preset.name}${installed ? " (installed)" : ""}  ${preset.description}`);
		}
		printInfo(`Install with: feynman packages install <${listOptionalPackagePresetInstallTargets().join("|")}>`);
		return;
	}

	if (subcommand !== "install") {
		throw new Error(`Unknown packages command: ${subcommand}`);
	}

	const target = args[0];
	if (!target) {
		const installTargets = listOptionalPackagePresetInstallTargets();
		if (installTargets.length === 0) {
			throw new Error(`No optional package presets are available on ${process.platform}.`);
		}
		throw new Error(`Usage: feynman packages install <${installTargets.join("|")}>`);
	}

	const sources = getOptionalPackagePresetSources(target);
	if (!sources) {
		const normalizedPreset = normalizeOptionalPackagePresetName(target);
		if (normalizedPreset && !isOptionalPackagePresetSupported(normalizedPreset)) {
			console.log(`${normalizedPreset} is not available on this runtime.`);
			if (normalizedPreset === "session-search") {
				console.log(`Its sqlite-backed dependency is only supported through Node ${MAX_NATIVE_PACKAGE_NODE_MAJOR}.x.`);
			}
			return;
		}
		throw new Error(`Unknown package preset: ${target}`);
	}

	const pendingSources = sources.filter((source) => !configuredSources.has(source));
	for (const source of sources) {
		if (configuredSources.has(source)) {
			console.log(`${source} already installed`);
		}
	}

	if (pendingSources.length === 0) {
		console.log("Optional packages installed.");
		return;
	}

	try {
		const result = await installPackageSources(workingDir, feynmanAgentDir, pendingSources, { persist: true });
		for (const skippedSource of result.skipped) {
			console.log(`Skipped ${skippedSource} on Node ${process.versions.node} (native packages are only supported through Node ${MAX_NATIVE_PACKAGE_NODE_MAJOR}.x).`);
		}
		await settingsManager.flush();
		console.log("Optional packages installed.");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes("No supported package manager found")) {
			console.log("No package manager is available for optional package installs.");
			console.log("Install npm, pnpm, or bun, or rerun the standalone installer for bundled package updates.");
			return;
		}
		throw error;
	}
}

function handleSearchCommand(subcommand: string | undefined, args: string[]): void {
	if (!subcommand || subcommand === "status") {
		printSearchStatus();
		return;
	}

	if (subcommand === "set") {
		const provider = args[0] as PiWebSearchProvider | undefined;
		const validProviders: PiWebSearchProvider[] = ["auto", "perplexity", "exa", "gemini"];
		if (!provider || !validProviders.includes(provider)) {
			throw new Error("Usage: feynman search set <auto|perplexity|exa|gemini> [api-key]");
		}
		setSearchProvider(provider, args[1]);
		return;
	}

	if (subcommand === "clear") {
		clearSearchConfig();
		return;
	}

	throw new Error(`Unknown search command: ${subcommand}`);
}

function loadPackageVersion(appRoot: string): { version?: string } {
	try {
		return JSON.parse(readFileSync(resolve(appRoot, "package.json"), "utf8")) as { version?: string };
	} catch {
		return {};
	}
}

function getTelemetryCommandNames(appRoot: string): Set<string> {
	const names = new Set(topLevelCommandNames);
	try {
		for (const spec of readPromptSpecs(appRoot)) {
			if (spec.topLevelCli) names.add(spec.name);
		}
	} catch {
		// Telemetry labels are optional; command execution should keep going if prompt metadata is unavailable.
	}
	return names;
}

export function resolveInitialPrompt(
	command: string | undefined,
	rest: string[],
	oneShotPrompt: string | undefined,
	workflowCommands: Set<string>,
): string | undefined {
	if (oneShotPrompt) {
		return oneShotPrompt;
	}
	if (!command) {
		return undefined;
	}
	if (command === "chat") {
		return rest.length > 0 ? rest.join(" ") : undefined;
	}
	if (workflowCommands.has(command)) {
		return [`/${command}`, ...rest].join(" ").trim();
	}
	if (!TOP_LEVEL_COMMANDS.has(command)) {
		return [command, ...rest].join(" ");
	}
	return undefined;
}

export function resolvePiPromptOptions(
	command: string | undefined,
	rest: string[],
	oneShotPrompt: string | undefined,
	workflowCommands: Set<string>,
): { oneShotPrompt?: string; initialPrompt?: string } {
	const resolvedPrompt = resolveInitialPrompt(command, rest, oneShotPrompt, workflowCommands);
	if (!resolvedPrompt) {
		return {};
	}
	if (oneShotPrompt) {
		return { oneShotPrompt: resolvedPrompt };
	}
	return { initialPrompt: resolvedPrompt };
}

export function buildLocalModelWorkflowNotice(modelSpec: string, workflowName: string): string {
	return [
		`Warning: ${modelSpec} is a local provider.`,
		`Small local models often ignore /${workflowName}'s multi-step workflow and return a chat-only reply with no files under outputs/.`,
		"Use a stronger approved research model with `feynman model set <provider/model>` if this run produces no artifacts.",
	].join(" ");
}

export function appendWorkflowFlagPositionals(
	command: string | undefined,
	rest: string[],
	values: Record<string, string | boolean | undefined>,
): string[] {
	if (command !== "summarize") {
		return rest;
	}

	const appended = [...rest];
	for (const flag of ["window-size", "overlap", "tier1-threshold", "tier2-threshold"] as const) {
		const value = values[flag];
		if (typeof value === "string") {
			appended.push(`--${flag}`, value);
		}
	}
	return appended;
}

export function resolveThinkingConfig(rawValue: string | undefined): {
	defaultThinkingLevel: ThinkingLevel;
	launchThinkingLevel?: ThinkingLevel;
} {
	const explicitThinkingLevel = normalizeThinkingLevel(rawValue);
	return {
		defaultThinkingLevel: explicitThinkingLevel ?? "medium",
		launchThinkingLevel: explicitThinkingLevel,
	};
}

export async function shouldRunInteractiveSetup(
	explicitModelSpec: string | undefined,
	currentModelSpec: string | undefined,
	isInteractiveTerminal: boolean,
	authPath: string,
): Promise<boolean> {
	if (explicitModelSpec || !isInteractiveTerminal) {
		return false;
	}

	const status = buildModelStatusSnapshotFromRecords(
		await getSupportedModelRecords(authPath),
		await getAuthenticatedModelRecords(authPath),
		currentModelSpec,
	);
	return !status.currentValid;
}

export async function main(): Promise<void> {
	const here = dirname(fileURLToPath(import.meta.url));
	const appRoot = resolve(here, "..");
	const feynmanVersion = loadPackageVersion(appRoot).version;
	initializePostHogTelemetry({ appVersion: feynmanVersion, serviceName: "feynman-cli" });
	const commandTelemetry = getCliTelemetryMetadata(process.argv.slice(2), { knownCommands: getTelemetryCommandNames(appRoot) });
	const commandStartedAt = Date.now();
	const commandSpan = startTelemetrySpan("feynman.cli.command", commandTelemetry);
	captureTelemetryEvent("feynman_command_started", commandTelemetry);
	emitTelemetryLog("info", "feynman command started", commandTelemetry);
	try {
		await runMain({ here, appRoot, feynmanVersion });
		const durationMs = Date.now() - commandStartedAt;
		const exitCode = process.exitCode ?? 0;
		const completeProperties = {
			...commandTelemetry,
			duration_ms: durationMs,
			exit_code: exitCode,
		};
		commandSpan.end(exitCode === 0 ? "ok" : "error", completeProperties);
		captureTelemetryEvent(exitCode === 0 ? "feynman_command_completed" : "feynman_command_failed", completeProperties);
		emitTelemetryLog(exitCode === 0 ? "info" : "error", exitCode === 0 ? "feynman command completed" : "feynman command failed", completeProperties);
	} catch (error) {
		const durationMs = Date.now() - commandStartedAt;
		const failureProperties = {
			...commandTelemetry,
			duration_ms: durationMs,
			...telemetryErrorProperties(error),
		};
		commandSpan.recordException(error);
		commandSpan.end("error", failureProperties);
		captureTelemetryEvent("feynman_command_failed", failureProperties);
		emitTelemetryLog("error", "feynman command failed", failureProperties);
		throw error;
	} finally {
		await shutdownPostHogTelemetry();
	}
}

async function runMain(input: { here: string; appRoot: string; feynmanVersion: string | undefined }): Promise<void> {
	const { appRoot, feynmanVersion } = input;
	const bundledSettingsPath = resolve(appRoot, ".feynman", "settings.json");
	const feynmanHome = getFeynmanHome();
	const feynmanAgentDir = getFeynmanAgentDir(feynmanHome);

	ensureFeynmanHome(feynmanHome);
	syncBundledAssets(appRoot, feynmanAgentDir);

	const rawArgs = process.argv.slice(2);
	const alphaPassthrough = resolveAlphaPassthroughArgs(rawArgs);
	if (alphaPassthrough && alphaPassthrough.args[0] !== "status") {
		await runBundledAlphaCli(appRoot, alphaPassthrough.args, { cwd: alphaPassthrough.cwd });
		return;
	}

	const parseCliArgs = () =>
		parseArgs({
			args: process.argv.slice(2),
			allowPositionals: true,
			options: {
				cwd: { type: "string" },
				doctor: { type: "boolean" },
				help: { type: "boolean" },
				version: { type: "boolean" },
				"alpha-login": { type: "boolean" },
				"alpha-logout": { type: "boolean" },
				"alpha-status": { type: "boolean" },
				mode: { type: "string" },
				model: { type: "string" },
				"new-session": { type: "boolean" },
				prompt: { type: "string" },
				"service-tier": { type: "string" },
				"session-dir": { type: "string" },
				"setup-preview": { type: "boolean" },
				"tier1-threshold": { type: "string" },
				"tier2-threshold": { type: "string" },
				thinking: { type: "string" },
				overlap: { type: "string" },
				"window-size": { type: "string" },
			},
		});

	let parsedArgs: ReturnType<typeof parseCliArgs>;
	try {
		parsedArgs = parseCliArgs();
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && error.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`${message}\nRun \`feynman help\` to see available commands and flags.`);
		}
		throw error;
	}
	const { values, positionals } = parsedArgs;

	if (values.help) {
		printHelp(appRoot);
		return;
	}

	if (values.version) {
		if (feynmanVersion) {
			console.log(feynmanVersion);
			return;
		}
		throw new Error("Unable to determine the installed Feynman version.");
	}

	const workingDir = resolve(values.cwd ?? process.cwd());
	const sessionDir = resolve(values["session-dir"] ?? getDefaultSessionDir(feynmanHome));
	const feynmanSettingsPath = resolve(feynmanAgentDir, "settings.json");
	const feynmanAuthPath = resolve(feynmanAgentDir, "auth.json");
	const researchToolsExtensionPath = resolve(appRoot, "extensions", "research-tools.ts");
	const { defaultThinkingLevel, launchThinkingLevel } = resolveThinkingConfig(values.thinking ?? process.env.FEYNMAN_THINKING);

	await normalizeFeynmanSettings(feynmanSettingsPath, bundledSettingsPath, defaultThinkingLevel, feynmanAuthPath, {
		researchToolsExtensionPath,
	});
	reconcileManagedCorePackageInstalls(feynmanAgentDir, appRoot);

	if (values.doctor) {
		await runDoctor({
			settingsPath: feynmanSettingsPath,
			authPath: feynmanAuthPath,
			sessionDir,
			workingDir,
			appRoot,
		});
		return;
	}

	if (values["setup-preview"]) {
		const result = setupPreviewDependencies();
		console.log(result.message);
		return;
	}

	if (values["alpha-login"]) {
		await handleAlphaCommand("login");
		return;
	}

	if (values["alpha-logout"]) {
		await handleAlphaCommand("logout");
		return;
	}

	if (values["alpha-status"]) {
		await handleAlphaCommand("status");
		return;
	}

	const [command, ...rest] = positionals;
	if (command === "help") {
		printHelp(appRoot);
		return;
	}

	if (command === "setup") {
		if (rest[0] === "preview") {
			const result = setupPreviewDependencies();
			console.log(result.message);
			return;
		}
		if (rest[0]) {
			throw new Error(`Unknown setup command: ${rest[0]}`);
		}
		await runSetup({
			settingsPath: feynmanSettingsPath,
			bundledSettingsPath,
			authPath: feynmanAuthPath,
			workingDir,
			sessionDir,
			appRoot,
			defaultThinkingLevel,
			researchToolsExtensionPath,
		});
		return;
	}

	if (command === "doctor") {
		await runDoctor({
			settingsPath: feynmanSettingsPath,
			authPath: feynmanAuthPath,
			sessionDir,
			workingDir,
			appRoot,
		});
		return;
	}

	if (command === "status") {
		await runStatus({
			settingsPath: feynmanSettingsPath,
			authPath: feynmanAuthPath,
			sessionDir,
			workingDir,
			appRoot,
		});
		return;
	}

	if (command === "model") {
		await handleModelCommand(rest[0], rest.slice(1), feynmanSettingsPath, feynmanAuthPath);
		return;
	}

	if (command === "search") {
		handleSearchCommand(rest[0], rest.slice(1));
		return;
	}

	if (command === "packages") {
		await handlePackagesCommand(rest[0], rest.slice(1), workingDir, feynmanAgentDir);
		return;
	}

	if (command === "update") {
		await handleUpdateCommand(workingDir, feynmanAgentDir, appRoot, feynmanVersion, rest[0]);
		return;
	}

	if (command === "alpha") {
		if (rest[0] === "status") {
			await handleAlphaCommand("status");
			return;
		}
		await runBundledAlphaCli(appRoot, rest, { cwd: workingDir });
		return;
	}

	const requestedExplicitModelSpec = values.model ?? process.env.FEYNMAN_MODEL;
	let explicitModelSpec = requestedExplicitModelSpec;
	const explicitServiceTier = normalizeServiceTier(values["service-tier"] ?? process.env.FEYNMAN_SERVICE_TIER);
	const mode = values.mode;
	if (mode !== undefined && mode !== "text" && mode !== "json" && mode !== "rpc") {
		throw new Error("Unknown mode. Use text, json, or rpc.");
	}
	if ((values["service-tier"] ?? process.env.FEYNMAN_SERVICE_TIER) && !explicitServiceTier) {
		throw new Error("Unknown service tier. Use auto, default, flex, priority, or standard_only.");
	}
	if (explicitServiceTier) {
		process.env.FEYNMAN_SERVICE_TIER = explicitServiceTier;
	}
	if (requestedExplicitModelSpec) {
		if (isProClassModelSpec(requestedExplicitModelSpec)) {
			throw new Error(`Pro-class model disabled: ${requestedExplicitModelSpec}. Choose an approved research model.`);
		}
		const modelRuntime = await createModelRuntime(feynmanAuthPath);
		const canonicalModelSpec = canonicalizeModelSpec(requestedExplicitModelSpec, modelRuntime);
		if (!canonicalModelSpec) {
			throw new Error(`Unknown model: ${requestedExplicitModelSpec}`);
		}
		explicitModelSpec = canonicalModelSpec;
	}

	const currentModelSpec = getCurrentModelSpec(feynmanSettingsPath);
	if (await shouldRunInteractiveSetup(
		explicitModelSpec,
		currentModelSpec,
		Boolean(process.stdin.isTTY && process.stdout.isTTY),
		feynmanAuthPath,
	)) {
		await runSetup({
			settingsPath: feynmanSettingsPath,
			bundledSettingsPath,
			authPath: feynmanAuthPath,
			workingDir,
			sessionDir,
			appRoot,
			defaultThinkingLevel,
			researchToolsExtensionPath,
		});
		if (!getCurrentModelSpec(feynmanSettingsPath)) {
			return;
		}
		await normalizeFeynmanSettings(feynmanSettingsPath, bundledSettingsPath, defaultThinkingLevel, feynmanAuthPath, {
			researchToolsExtensionPath,
		});
	}

	const workflowCommandNames = new Set(readPromptSpecs(appRoot).filter((s) => s.topLevelCli).map((s) => s.name));
	const workflowRest = appendWorkflowFlagPositionals(command, rest, values);
	const promptOptions = resolvePiPromptOptions(command, workflowRest, values.prompt, workflowCommandNames);
	const resumeRecentSession =
		!values["new-session"] &&
		mode !== "rpc" &&
		mode !== "json" &&
		!promptOptions.oneShotPrompt &&
		!promptOptions.initialPrompt;
	let preLaunchNotice: string | undefined;
	if (command && workflowCommandNames.has(command) && mode !== "rpc" && mode !== "json" && process.stdout.isTTY) {
		const effectiveSpec = explicitModelSpec ?? getCurrentModelSpec(feynmanSettingsPath);
		const providerId = effectiveSpec?.split("/")[0] ?? "";
		if (effectiveSpec && isLocalModelProvider(feynmanAuthPath, providerId)) {
			preLaunchNotice = buildLocalModelWorkflowNotice(effectiveSpec, command);
		}
	}

	await launchPiChat({
		appRoot,
		workingDir,
		sessionDir,
		feynmanAgentDir,
		feynmanVersion,
		mode,
		thinkingLevel: launchThinkingLevel,
		explicitModelSpec,
		resumeRecentSession,
		preLaunchNotice,
		...promptOptions,
	});
}
