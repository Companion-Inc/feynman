import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

import { PostHog, type PostHogOptions } from "posthog-node";

import { getFeynmanHome, getFeynmanStateDir } from "../config/paths.js";

export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
export const DEFAULT_POSTHOG_PROJECT_ID = "623906";
export const DEFAULT_POSTHOG_PROJECT_TOKEN = "phc_owCZbr7c4mchCuVN5JXA6uBByjbT2kFVXSbmpUyAgEva";
const TELEMETRY_STATE_FILE = "telemetry.json";
const TELEMETRY_DISABLED_VALUES = new Set(["0", "false", "no", "off", "disabled"]);
const TELEMETRY_KEY_PATTERN = /^[A-Za-z0-9_$./-]+$/;
export const TELEMETRY_NOTICE = [
	"Attention: Feynman collects anonymous usage telemetry: commands, workflows, tool names, models, token counts, and errors.",
	"Errors include their message and stack trace, with your home folder shown as ~. It never sends prompts, model output, paper content, or tool arguments.",
	"To opt out, set FEYNMAN_TELEMETRY=off. Learn more: https://www.feynman.is/docs/getting-started/configuration#telemetry",
].join("\n");

export type TelemetryPrimitive = string | number | boolean | null | undefined;
export type TelemetryProperties = Record<string, TelemetryPrimitive>;

export type PostHogTelemetryConfig = {
	enabled: boolean;
	host: string;
	projectId: string;
	projectToken: string;
	distinctId: string;
	appVersion?: string;
};

type TelemetryState = {
	anonymousId?: string;
	noticeShown?: boolean;
};

let posthogClient: PostHog | undefined;
let activeConfig: PostHogTelemetryConfig | undefined;
let telemetryInitialized = false;
let telemetryStartWarningPrinted = false;
let telemetryTransportFailed = false;
let telemetryNoticeThisProcess: string | undefined;

type PostHogFetch = NonNullable<PostHogOptions["fetch"]>;
/** One silent attempt per session: after the first failure, later requests are dropped. */
export function createTelemetryCircuitBreakerFetch(
	fetchImpl: PostHogFetch,
	onTransportFailure: (error: unknown) => void,
): PostHogFetch {
	let open = false;
	return async (url, options) => {
		if (!open) {
			try {
				const response = await fetchImpl(url, options);
				if (response.status >= 200 && response.status < 400) return response;
				throw new Error(`PostHog transport returned HTTP ${response.status}`);
			} catch (error) {
				open = true;
				onTransportFailure(error);
			}
		}
		return new Response(null, { status: 204 });
	};
}

function disableTelemetryAfterTransportFailure(error: unknown): void {
	if (telemetryTransportFailed) return;
	telemetryTransportFailed = true;
	activeConfig = undefined;
	if (process.env.FEYNMAN_DEBUG === "1" && !telemetryStartWarningPrinted) {
		telemetryStartWarningPrinted = true;
		process.stderr.write(
			`[feynman] Telemetry disabled for this session after a transport failure (${error instanceof Error ? error.message : "unknown error"}).\n`,
		);
	}
}

export function isTelemetryDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
	const setting = env.FEYNMAN_TELEMETRY ?? env.FEYNMAN_POSTHOG_TELEMETRY;
	return (setting !== undefined && TELEMETRY_DISABLED_VALUES.has(setting.trim().toLowerCase())) || env.DO_NOT_TRACK === "1";
}

function normalizeHost(value: string | undefined): string {
	const trimmed = value?.trim();
	return trimmed ? trimmed.replace(/\/+$/, "") : DEFAULT_POSTHOG_HOST;
}

function readTelemetryState(path: string): TelemetryState {
	if (!existsSync(path)) return {};
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as TelemetryState;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

function getAnonymousDistinctId(home = getFeynmanHome()): string {
	const stateDir = getFeynmanStateDir(home);
	const statePath = resolve(stateDir, TELEMETRY_STATE_FILE);
	const state = readTelemetryState(statePath);
	if (typeof state.anonymousId === "string" && state.anonymousId.startsWith("feynman_")) {
		return state.anonymousId;
	}

	const anonymousId = `feynman_${randomUUID()}`;
	mkdirSync(dirname(statePath), { recursive: true });
	writeFileSync(statePath, JSON.stringify({ ...state, anonymousId }, null, 2) + "\n", "utf8");
	return anonymousId;
}

/**
 * Returns the first-run telemetry notice once per Feynman home, and again for
 * the rest of this process so a launch that clears the screen can reprint it.
 * Only interactive terminals get it: scripts and CI (where Windows PowerShell
 * treats any stderr as an error) never see it, and it stays pending for the
 * first interactive run.
 */
export function telemetryFirstRunNotice(
	home = getFeynmanHome(),
	interactive = process.stderr.isTTY === true,
): string | undefined {
	if (telemetryNoticeThisProcess || !activeConfig) return telemetryNoticeThisProcess;
	if (!interactive) return undefined;
	const statePath = resolve(getFeynmanStateDir(home), TELEMETRY_STATE_FILE);
	const state = readTelemetryState(statePath);
	if (state.noticeShown) return undefined;
	try {
		mkdirSync(dirname(statePath), { recursive: true });
		writeFileSync(statePath, JSON.stringify({ ...state, noticeShown: true }, null, 2) + "\n", "utf8");
	} catch {
		return undefined;
	}
	telemetryNoticeThisProcess = TELEMETRY_NOTICE;
	return telemetryNoticeThisProcess;
}

/** Env the Pi child needs for the research extension to send under the same install id. */
export function getPostHogChildEnv(): Record<string, string> {
	if (!activeConfig) return {};
	return {
		FEYNMAN_POSTHOG_KEY: activeConfig.projectToken,
		FEYNMAN_POSTHOG_HOST: activeConfig.host,
		FEYNMAN_TELEMETRY_DISTINCT_ID: activeConfig.distinctId,
	};
}

export function resolvePostHogTelemetryConfig(options: {
	appVersion?: string;
	env?: NodeJS.ProcessEnv;
	home?: string;
} = {}): PostHogTelemetryConfig | undefined {
	const env = options.env ?? process.env;
	if (isTelemetryDisabled(env)) return undefined;

	const configuredProjectToken = (env.FEYNMAN_POSTHOG_KEY ?? env.POSTHOG_KEY)?.trim();
	const projectToken = configuredProjectToken || DEFAULT_POSTHOG_PROJECT_TOKEN;
	if (!projectToken) return undefined;

	return {
		enabled: true,
		host: normalizeHost(env.FEYNMAN_POSTHOG_HOST ?? env.POSTHOG_HOST),
		projectId: (env.FEYNMAN_POSTHOG_PROJECT_ID ?? DEFAULT_POSTHOG_PROJECT_ID).trim(),
		projectToken,
		distinctId: env.FEYNMAN_TELEMETRY_DISTINCT_ID?.trim() || getAnonymousDistinctId(options.home),
		appVersion: options.appVersion,
	};
}


function normalizeTelemetryKey(key: string): string | undefined {
	const normalized = key
		.trim()
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.replace(/[^A-Za-z0-9_$./-]+/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_+|_+$/g, "")
		.toLowerCase();
	if (!normalized || !TELEMETRY_KEY_PATTERN.test(normalized)) return undefined;
	return normalized.slice(0, 80);
}

// Error text is sent as-is (home folder shown as ~) so failures can be debugged.
const RAW_TEXT_KEYS = new Set(["error_message", "pi_stderr"]);
const RAW_TEXT_LIMIT = 4000;

export function redactTelemetryText(text: string, home = homedir()): string {
	let redacted = text;
	if (home) {
		for (const variant of new Set([home, home.replace(/\\/g, "/")])) redacted = redacted.split(variant).join("~");
	}
	return redacted.length > RAW_TEXT_LIMIT ? `...${redacted.slice(-RAW_TEXT_LIMIT)}` : redacted;
}

function normalizeTelemetryValue(value: TelemetryPrimitive, raw = false): string | number | boolean | null | undefined {
	if (value === undefined) return undefined;
	if (value === null || typeof value === "boolean") return value;
	if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
	if (raw) return value.trim() ? redactTelemetryText(value.trim()) : undefined;
	const trimmed = value.replace(/\s+/g, " ").trim();
	if (!trimmed) return undefined;
	return trimmed.length > 240 ? `${trimmed.slice(0, 237)}...` : trimmed;
}

export function normalizeTelemetryProperties(properties: TelemetryProperties = {}): Record<string, string | number | boolean | null> {
	const normalized: Record<string, string | number | boolean | null> = {};
	for (const [key, value] of Object.entries(properties)) {
		const normalizedKey = normalizeTelemetryKey(key);
		const normalizedValue = normalizeTelemetryValue(value, RAW_TEXT_KEYS.has(normalizedKey ?? ""));
		if (!normalizedKey || normalizedValue === undefined) continue;
		normalized[normalizedKey] = normalizedValue;
	}
	return normalized;
}

function baseTelemetryProperties(config: PostHogTelemetryConfig): Record<string, string | number | boolean | null> {
	return normalizeTelemetryProperties({
		app_version: config.appVersion,
		node_version: process.versions.node,
		platform: process.platform,
		arch: process.arch,
		project_id: config.projectId,
		telemetry_source: "feynman",
		$process_person_profile: false,
	});
}

function telemetryErrorName(error: unknown): string {
	if (!(error instanceof Error)) return typeof error;
	return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(error.name) ? error.name : "Error";
}

export function telemetryErrorProperties(error: unknown): TelemetryProperties {
	const message = error instanceof Error ? error.message : String(error);
	return {
		error_name: telemetryErrorName(error),
		error_message: message,
	};
}

export function initializePostHogTelemetry(options: {
	appVersion?: string;
	home?: string;
	posthogFetch?: PostHogFetch;
} = {}): PostHogTelemetryConfig | undefined {
	if (telemetryInitialized) return activeConfig;
	telemetryInitialized = true;
	telemetryTransportFailed = false;

	const config = resolvePostHogTelemetryConfig(options);
	activeConfig = config;
	if (!config) return undefined;

	posthogClient = new PostHog(config.projectToken, {
		host: config.host,
		flushAt: 1,
		flushInterval: 0,
		isServer: false,
		disableGeoip: true,
		fetchRetryCount: 0,
		fetch: createTelemetryCircuitBreakerFetch(
			options.posthogFetch ?? ((url, fetchOptions) => fetch(url, fetchOptions as RequestInit)),
			disableTelemetryAfterTransportFailure,
		),
	});
	posthogClient.on("error", () => {
		if (process.env.FEYNMAN_DEBUG === "1" && !telemetryStartWarningPrinted) {
			telemetryStartWarningPrinted = true;
			process.stderr.write("[feynman] PostHog telemetry transport reported an error.\n");
		}
	});
	return config;
}

export function captureTelemetryEvent(event: string, properties: TelemetryProperties = {}): void {
	if (!activeConfig || !posthogClient) return;
	posthogClient.capture({
		distinctId: activeConfig.distinctId,
		event,
		properties: {
			...baseTelemetryProperties(activeConfig),
			...normalizeTelemetryProperties(properties),
		},
	});
}

/** Send an error with its stack trace to PostHog error tracking. */
export async function captureTelemetryException(error: unknown, properties: TelemetryProperties = {}): Promise<void> {
	if (!activeConfig || !posthogClient) return;
	const source = error instanceof Error ? error : new Error(String(error));
	const redacted = new Error(redactTelemetryText(source.message));
	redacted.name = source.name;
	redacted.stack = source.stack ? redactTelemetryText(source.stack) : undefined;
	// The immediate variant is awaited, so the event is sent before the CLI exits.
	await posthogClient.captureExceptionImmediate(redacted, activeConfig.distinctId, {
		...baseTelemetryProperties(activeConfig),
		...normalizeTelemetryProperties(properties),
	});
}

export async function captureTelemetryEventImmediate(event: string, properties: TelemetryProperties = {}): Promise<void> {
	if (!activeConfig || !posthogClient) return;
	await posthogClient.captureImmediate({
		distinctId: activeConfig.distinctId,
		event,
		properties: {
			...baseTelemetryProperties(activeConfig),
			...normalizeTelemetryProperties(properties),
		},
	});
}

export async function shutdownPostHogTelemetry(): Promise<void> {
	const client = posthogClient;
	posthogClient = undefined;
	activeConfig = undefined;
	telemetryInitialized = false;
	telemetryTransportFailed = false;
	telemetryNoticeThisProcess = undefined;
	try {
		await client?.shutdown(3000);
	} catch {}
}

function flagValue(args: string[], flag: string): string | undefined {
	const prefix = `${flag}=`;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]!;
		if (arg === flag) return args[index + 1];
		if (arg.startsWith(prefix)) return arg.slice(prefix.length);
	}
	return undefined;
}

function safeEnumFlagValue<T extends string>(args: string[], flag: string, allowed: readonly T[]): T | undefined {
	const value = flagValue(args, flag);
	if (value === undefined) return undefined;
	return allowed.includes(value as T) ? (value as T) : undefined;
}

function hasFlag(args: string[], flag: string): boolean {
	return args.includes(flag) || args.some((arg) => arg.startsWith(`${flag}=`));
}

const FLAGS_WITH_VALUES = new Set([
	"--cwd",
	"--mode",
	"--model",
	"--prompt",
	"--service-tier",
	"--session-dir",
	"--tier1-threshold",
	"--tier2-threshold",
	"--thinking",
	"--overlap",
	"--window-size",
]);

function positionalArgs(args: string[]): string[] {
	const positionals: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]!;
		if (arg === "--") {
			break;
		}
		if (arg.startsWith("--")) {
			const [flag] = arg.split("=", 1);
			if (!arg.includes("=") && FLAGS_WITH_VALUES.has(flag!)) index += 1;
			continue;
		}
		if (arg.startsWith("-")) continue;
		positionals.push(arg);
	}
	return positionals;
}

const DEFAULT_COMMAND_NAMES = new Set([
	"alpha",
	"chat",
	"doctor",
	"help",
	"model",
	"packages",
	"search",
	"setup",
	"status",
	"update",
]);

const SAFE_SUBCOMMANDS: Record<string, Set<string>> = {
	alpha: new Set(["login", "logout", "status", "search", "get", "ask", "code", "annotate"]),
	model: new Set(["list", "login", "logout", "set", "tier"]),
	packages: new Set(["list", "install", "update"]),
	search: new Set(["status", "set", "clear"]),
	setup: new Set(["preview"]),
};

function resolveTelemetryCommand(args: string[], positionals: string[], knownCommands: ReadonlySet<string>): string {
	const first = positionals[0];
	if (first && knownCommands.has(first)) return first;
	if (hasFlag(args, "--version")) return "version";
	if (hasFlag(args, "--help")) return "help";
	if (hasFlag(args, "--doctor")) return "doctor";
	return "chat";
}

export function getCliTelemetryMetadata(args: string[], options: { knownCommands?: Iterable<string> } = {}): TelemetryProperties {
	const positionals = positionalArgs(args);
	const knownCommands = new Set([...DEFAULT_COMMAND_NAMES, ...(options.knownCommands ?? [])]);
	const command = resolveTelemetryCommand(args, positionals, knownCommands);
	const subcommand = positionals[1] && SAFE_SUBCOMMANDS[command]?.has(positionals[1])
		? positionals[1]
		: undefined;

	return {
		command,
		subcommand,
		mode: safeEnumFlagValue(args, "--mode", ["text", "json", "rpc"]),
		has_prompt: Boolean(flagValue(args, "--prompt")),
		has_model_override: Boolean(flagValue(args, "--model")),
		has_service_tier_override: Boolean(flagValue(args, "--service-tier")),
		new_session: hasFlag(args, "--new-session"),
	};
}
