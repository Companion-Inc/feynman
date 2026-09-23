import { randomUUID, createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { trace, SpanStatusCode, type Attributes, type Span } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import {
	OTLPExporterBase,
	createOtlpNetworkExportDelegate,
	type IExporterTransport,
} from "@opentelemetry/otlp-exporter-base";
import { createOtlpHttpExporterMetrics } from "@opentelemetry/otlp-exporter-base/node-http";
import {
	JsonLogsSerializer,
	LogsExporterMetricsHelper,
	ProtobufTraceSerializer,
	TraceExporterMetricsHelper,
	type IExporterMetricsHelper,
	type ISerializer,
} from "@opentelemetry/otlp-transformer";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
	BatchLogRecordProcessor,
	LoggerProvider,
	type ReadableLogRecord,
} from "@opentelemetry/sdk-logs";
import { BatchSpanProcessor, type ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { PostHog, type PostHogOptions } from "posthog-node";

import { getFeynmanHome, getFeynmanStateDir } from "../config/paths.js";

export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
export const DEFAULT_POSTHOG_PROJECT_ID = "623906";
export const DEFAULT_POSTHOG_PROJECT_TOKEN = "phc_owCZbr7c4mchCuVN5JXA6uBByjbT2kFVXSbmpUyAgEva";
const TELEMETRY_STATE_FILE = "telemetry.json";
const TELEMETRY_DISABLED_VALUES = new Set(["0", "false", "no", "off", "disabled"]);
const TELEMETRY_KEY_PATTERN = /^[A-Za-z0-9_$./-]+$/;
const CHILD_TELEMETRY_ENV_KEYS = [
	"FEYNMAN_POSTHOG_HOST",
	"FEYNMAN_POSTHOG_KEY",
	"FEYNMAN_POSTHOG_PROJECT_ID",
	"OTEL_EXPORTER_OTLP_ENDPOINT",
	"OTEL_EXPORTER_OTLP_HEADERS",
	"OTEL_EXPORTER_OTLP_PROTOCOL",
	"OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
	"OTEL_EXPORTER_OTLP_TRACES_HEADERS",
	"OTEL_EXPORTER_OTLP_TRACES_PROTOCOL",
	"OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
	"OTEL_EXPORTER_OTLP_LOGS_HEADERS",
	"OTEL_EXPORTER_OTLP_LOGS_PROTOCOL",
	"OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
	"OTEL_EXPORTER_OTLP_METRICS_HEADERS",
	"OTEL_EXPORTER_OTLP_METRICS_PROTOCOL",
	"OTEL_RESOURCE_ATTRIBUTES",
	"OTEL_NODE_RESOURCE_DETECTORS",
	"OTEL_TRACES_EXPORTER",
	"OTEL_LOGS_EXPORTER",
	"OTEL_METRICS_EXPORTER",
	"OTEL_LOG_LEVEL",
	"PI_OTEL_DISABLED",
	"PI_OTEL_CAPTURE_CONTENT",
	"PI_OTEL_LOGS",
	"PI_OTEL_METRICS",
	"PI_OTEL_SERVICE_NAME",
	"PI_OTEL_SERVICE_VERSION",
	"OTEL_SERVICE_NAME",
	"OTEL_SERVICE_VERSION",
] as const;

export type TelemetryPrimitive = string | number | boolean | null | undefined;
export type TelemetryProperties = Record<string, TelemetryPrimitive>;

export type PostHogTelemetryConfig = {
	enabled: boolean;
	host: string;
	projectId: string;
	projectToken: string;
	distinctId: string;
	appVersion?: string;
	serviceName: string;
};

type TelemetryState = {
	anonymousId?: string;
};

let posthogClient: PostHog | undefined;
let tracerProvider: NodeTracerProvider | undefined;
let loggerProvider: LoggerProvider | undefined;
let activeConfig: PostHogTelemetryConfig | undefined;
let telemetryInitialized = false;
let telemetryStartWarningPrinted = false;
let telemetryTransportFailed = false;

type PostHogFetch = NonNullable<PostHogOptions["fetch"]>;
type TelemetryFetch = (
	url: string | URL,
	init?: RequestInit,
) => Promise<Response>;

export type TelemetryTransportCircuitBreaker = {
	tryStart(): boolean;
	completeSuccess(): void;
	completeFailure(error: unknown): void;
	isOpen(): boolean;
};

export function createTelemetryTransportCircuitBreaker(
	onTransportFailure: (error: unknown) => void,
): TelemetryTransportCircuitBreaker {
	let circuitOpen = false;
	return {
		tryStart() {
			return !circuitOpen;
		},
		completeSuccess() {},
		completeFailure(error) {
			if (circuitOpen) return;
			circuitOpen = true;
			onTransportFailure(error);
		},
		isOpen() {
			return circuitOpen;
		},
	};
}

function successfulTelemetryDropResponse(): Response {
	return new Response(null, { status: 204 });
}

export function createTelemetryCircuitBreakerFetch(
	fetchImpl: PostHogFetch,
	onTransportFailure: (error: unknown) => void,
	circuit = createTelemetryTransportCircuitBreaker(onTransportFailure),
): PostHogFetch {
	return async (url, options) => {
		if (!circuit.tryStart()) {
			return successfulTelemetryDropResponse();
		}

		try {
			const response = await fetchImpl(url, options);
			if (response.status >= 200 && response.status < 400) {
				circuit.completeSuccess();
				return response;
			}

			circuit.completeFailure(new Error(`PostHog transport returned HTTP ${response.status}`));
			return successfulTelemetryDropResponse();
		} catch (error) {
			circuit.completeFailure(error);
			return successfulTelemetryDropResponse();
		}
	};
}

export function createOneShotOtlpTransport(options: {
	url: string;
	headers: Record<string, string>;
	contentType: string;
	fetchImpl: TelemetryFetch;
	circuit: TelemetryTransportCircuitBreaker;
}): IExporterTransport {
	return {
		async send(data, timeoutMillis) {
			if (!options.circuit.tryStart()) {
				return { status: "success" };
			}

			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), timeoutMillis);
			timeout.unref?.();
			try {
				const response = await options.fetchImpl(options.url, {
					method: "POST",
					headers: {
						...options.headers,
						"Content-Type": options.contentType,
					},
					body: Buffer.from(data),
					signal: controller.signal,
				});
				if (response.status < 200 || response.status >= 400) {
					throw new Error(`OTLP transport returned HTTP ${response.status}`);
				}

				options.circuit.completeSuccess();
				return { status: "success" };
			} catch (error) {
				// The exporter reports success after opening the shared circuit so
				// OpenTelemetry processors do not relay optional telemetry failures
				// through their global error handler.
				options.circuit.completeFailure(error);
				return { status: "success" };
			} finally {
				clearTimeout(timeout);
			}
		},
		shutdown() {},
	};
}

function createOneShotOtlpExporter<Internal, ResponsePayload>(options: {
	url: string;
	headers: Record<string, string>;
	contentType: string;
	fetchImpl: TelemetryFetch;
	circuit: TelemetryTransportCircuitBreaker;
	timeoutMillis: number;
	componentType: string;
	serializer: ISerializer<Internal, ResponsePayload>;
	metricsHelper: IExporterMetricsHelper<Internal>;
}): OTLPExporterBase<Internal> {
	const metrics = createOtlpHttpExporterMetrics(
		options.componentType,
		options.metricsHelper,
		options.url,
		undefined,
	);
	const transport = createOneShotOtlpTransport(options);
	return new OTLPExporterBase(
		createOtlpNetworkExportDelegate(
			{
				timeoutMillis: options.timeoutMillis,
				concurrencyLimit: 1,
				compression: "none",
			},
			options.serializer,
			metrics,
			transport,
		),
	);
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

function isTelemetryDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
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

export function resolvePostHogTelemetryConfig(options: {
	appVersion?: string;
	serviceName?: string;
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
		serviceName: options.serviceName ?? "feynman-cli",
	};
}

export function buildPostHogOtelEnv(config: Pick<PostHogTelemetryConfig, "host" | "projectToken" | "projectId">, serviceName: string): NodeJS.ProcessEnv {
	return {
		...clearPostHogOtelEnv(),
		FEYNMAN_POSTHOG_HOST: config.host,
		FEYNMAN_POSTHOG_KEY: config.projectToken,
		FEYNMAN_POSTHOG_PROJECT_ID: config.projectId,
		// Used by the bundled pi-otel extension, which reads only the base OTLP
		// endpoint and appends /v1/traces.
		OTEL_EXPORTER_OTLP_ENDPOINT: `${config.host}/i`,
		OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${config.projectToken}`,
		OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
		PI_OTEL_CAPTURE_CONTENT: "metadata_only",
		// The default process/host detectors export the command line (which
		// carries the user prompt), host name, and user name.
		OTEL_NODE_RESOURCE_DETECTORS: "none",
		PI_OTEL_LOGS: "0",
		PI_OTEL_METRICS: "0",
		OTEL_SERVICE_NAME: serviceName,
	};
}
export function clearPostHogOtelEnv(): NodeJS.ProcessEnv {
	return Object.fromEntries(CHILD_TELEMETRY_ENV_KEYS.map((key) => [key, undefined]));
}

export function getPostHogOtelEnv(serviceName: string, appVersion?: string): NodeJS.ProcessEnv {
	const config = resolvePostHogTelemetryConfig({ serviceName, appVersion });
	// Without Feynman telemetry, pi-otel would otherwise probe a local collector.
	return config ? buildPostHogOtelEnv(config, serviceName) : { ...clearPostHogOtelEnv(), PI_OTEL_DISABLED: "1" };
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

function normalizeTelemetryValue(value: TelemetryPrimitive): string | number | boolean | null | undefined {
	if (value === undefined) return undefined;
	if (value === null || typeof value === "boolean") return value;
	if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
	const trimmed = value.replace(/\s+/g, " ").trim();
	if (!trimmed) return undefined;
	return trimmed.length > 240 ? `${trimmed.slice(0, 237)}...` : trimmed;
}

export function normalizeTelemetryProperties(properties: TelemetryProperties = {}): Record<string, string | number | boolean | null> {
	const normalized: Record<string, string | number | boolean | null> = {};
	for (const [key, value] of Object.entries(properties)) {
		const normalizedKey = normalizeTelemetryKey(key);
		const normalizedValue = normalizeTelemetryValue(value);
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

function toOtelAttributes(properties: TelemetryProperties = {}): Attributes {
	const normalized = normalizeTelemetryProperties(properties);
	const attributes: Attributes = {};
	for (const [key, value] of Object.entries(normalized)) {
		if (value === null) continue;
		attributes[key] = value;
	}
	return attributes;
}

export function stableTelemetryHash(value: string | undefined): string | undefined {
	if (!value) return undefined;
	return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function telemetryErrorName(error: unknown): string {
	if (!(error instanceof Error)) return typeof error;
	return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(error.name) ? error.name : "Error";
}

export function telemetryErrorProperties(error: unknown): TelemetryProperties {
	const message = error instanceof Error ? error.message : String(error);
	return {
		error_name: telemetryErrorName(error),
		error_message_hash: stableTelemetryHash(message),
	};
}

export function sanitizeTelemetryException(error: unknown): { name: string; message: string } {
	const properties = telemetryErrorProperties(error);
	return {
		name: String(properties.error_name ?? "unknown"),
		message: `error_message_hash:${properties.error_message_hash ?? "unknown"}`,
	};
}

export function initializePostHogTelemetry(options: {
	appVersion?: string;
	serviceName?: string;
	home?: string;
	posthogFetch?: PostHogFetch;
	otlpFetch?: TelemetryFetch;
} = {}): PostHogTelemetryConfig | undefined {
	if (telemetryInitialized) return activeConfig;
	telemetryInitialized = true;
	telemetryTransportFailed = false;

	const config = resolvePostHogTelemetryConfig(options);
	activeConfig = config;
	if (!config) return undefined;

	try {
		const resource = resourceFromAttributes({
			[ATTR_SERVICE_NAME]: config.serviceName,
			...(config.appVersion ? { [ATTR_SERVICE_VERSION]: config.appVersion } : {}),
		});
		const circuit = createTelemetryTransportCircuitBreaker(disableTelemetryAfterTransportFailure);
		const defaultTelemetryFetch: TelemetryFetch = (url, fetchOptions) =>
			fetch(url, fetchOptions);
		const otlpFetch = options.otlpFetch ?? defaultTelemetryFetch;

		tracerProvider = new NodeTracerProvider({
			resource,
			spanProcessors: [
				new BatchSpanProcessor(
					createOneShotOtlpExporter<ReadableSpan[], unknown>({
						url: `${config.host}/i/v1/traces`,
						headers: { Authorization: `Bearer ${config.projectToken}` },
						contentType: "application/x-protobuf",
						fetchImpl: otlpFetch,
						circuit,
						timeoutMillis: 750,
						componentType: "otlp_http_span_exporter",
						serializer: ProtobufTraceSerializer,
						metricsHelper: TraceExporterMetricsHelper,
					}),
					{ scheduledDelayMillis: 250, exportTimeoutMillis: 3000 },
				),
			],
		});
		tracerProvider.register();

		loggerProvider = new LoggerProvider({
			resource,
			processors: [
				new BatchLogRecordProcessor({
					exporter: createOneShotOtlpExporter<ReadableLogRecord[], unknown>({
						url: `${config.host}/i/v1/logs`,
						headers: { Authorization: `Bearer ${config.projectToken}` },
						contentType: "application/json",
						fetchImpl: otlpFetch,
						circuit,
						timeoutMillis: 750,
						componentType: "otlp_http_log_exporter",
						serializer: JsonLogsSerializer,
						metricsHelper: LogsExporterMetricsHelper,
					}),
					scheduledDelayMillis: 250,
					exportTimeoutMillis: 3000,
				}),
			],
		});
		logs.setGlobalLoggerProvider(loggerProvider);

		const defaultPostHogFetch: PostHogFetch = (url, fetchOptions) =>
			fetch(url, fetchOptions as RequestInit);
		posthogClient = new PostHog(config.projectToken, {
			host: config.host,
			flushAt: 1,
			flushInterval: 0,
			isServer: false,
			disableGeoip: true,
			fetchRetryCount: 0,
			fetch: createTelemetryCircuitBreakerFetch(
				options.posthogFetch ?? defaultPostHogFetch,
				disableTelemetryAfterTransportFailure,
				circuit,
			),
		});
		posthogClient.on("error", () => {
			if (process.env.FEYNMAN_DEBUG === "1" && !telemetryStartWarningPrinted) {
				telemetryStartWarningPrinted = true;
				process.stderr.write("[feynman] PostHog telemetry transport reported an error.\n");
			}
		});
		return config;
	} catch (error) {
		if (process.env.FEYNMAN_DEBUG === "1" && !telemetryStartWarningPrinted) {
			telemetryStartWarningPrinted = true;
			process.stderr.write(
				`[feynman] PostHog telemetry disabled after initialization failed (${error instanceof Error ? error.message : "unknown error"}).\n`,
			);
		}
		activeConfig = undefined;
		posthogClient = undefined;
		tracerProvider = undefined;
		loggerProvider = undefined;
		return undefined;
	}
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

export function emitTelemetryLog(
	severityText: "trace" | "debug" | "info" | "warn" | "error",
	body: string,
	properties: TelemetryProperties = {},
): void {
	if (!activeConfig || !loggerProvider) return;
	const severityNumber = severityText === "error"
		? SeverityNumber.ERROR
		: severityText === "warn"
			? SeverityNumber.WARN
			: severityText === "debug"
				? SeverityNumber.DEBUG
				: severityText === "trace"
					? SeverityNumber.TRACE
					: SeverityNumber.INFO;
	logs.getLogger("feynman").emit({
		severityText,
		severityNumber,
		body,
		attributes: {
			...toOtelAttributes(baseTelemetryProperties(activeConfig)),
			...toOtelAttributes(properties),
		},
	});
}

export type ActiveTelemetrySpan = {
	setAttributes(properties: TelemetryProperties): void;
	recordException(error: unknown): void;
	end(status?: "ok" | "error", properties?: TelemetryProperties): void;
};

function createNoopSpan(): ActiveTelemetrySpan {
	return {
		setAttributes() {},
		recordException() {},
		end() {},
	};
}

export function startTelemetrySpan(name: string, properties: TelemetryProperties = {}): ActiveTelemetrySpan {
	if (!activeConfig || !tracerProvider) return createNoopSpan();
	const span: Span = trace.getTracer("feynman").startSpan(name, {
		attributes: {
			...toOtelAttributes(baseTelemetryProperties(activeConfig)),
			...toOtelAttributes(properties),
		},
	});
	let ended = false;
	return {
		setAttributes(nextProperties) {
			if (ended) return;
			span.setAttributes(toOtelAttributes(nextProperties));
		},
		recordException(error) {
			if (ended) return;
			span.recordException(sanitizeTelemetryException(error));
			span.setAttributes(toOtelAttributes(telemetryErrorProperties(error)));
		},
		end(status = "ok", nextProperties = {}) {
			if (ended) return;
			ended = true;
			if (Object.keys(nextProperties).length > 0) {
				span.setAttributes(toOtelAttributes(nextProperties));
			}
			if (status === "error") {
				span.setStatus({ code: SpanStatusCode.ERROR });
			} else {
				span.setStatus({ code: SpanStatusCode.OK });
			}
			span.end();
		},
	};
}

export async function shutdownPostHogTelemetry(): Promise<void> {
	const client = posthogClient;
	const traces = tracerProvider;
	const loggers = loggerProvider;
	posthogClient = undefined;
	tracerProvider = undefined;
	loggerProvider = undefined;
	activeConfig = undefined;
	telemetryInitialized = false;
	telemetryTransportFailed = false;

	await Promise.allSettled([
		client?.shutdown(3000),
		traces?.shutdown(),
		loggers?.shutdown(),
	]);
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
