import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PostHog, type PostHogOptions } from "posthog-node";

import { readPromptSpecs } from "../../metadata/commands.mjs";
import { APP_ROOT, FEYNMAN_VERSION } from "./shared.js";

// Same opt-out contract as src/telemetry/posthog.ts. The CLI passes the
// project token, host, and anonymous install id to the Pi child only when its
// own telemetry is on, so a Pi run outside the CLI sends nothing.
const TELEMETRY_DISABLED_VALUES = new Set(["0", "false", "no", "off", "disabled"]);
const FLUSH_TIMEOUT_MS = 2000;
const OUTPUT_DIRS = ["outputs", "papers"];
const OUTPUT_SCAN_LIMIT = 5000;
const SHARED_STATE_KEY = Symbol.for("feynman.research-telemetry");

type TelemetryValue = string | number | boolean | undefined;
export type ResearchTelemetryClient = Pick<PostHog, "capture" | "flush" | "shutdown">;
export type ResearchTelemetryConfig = { projectToken: string; host: string; distinctId: string };

// pi-subagents runs foreground children as in-process sessions that load this
// extension again with fresh module state, so the owner of the top-level
// session and the client live on globalThis.
export type ResearchTelemetrySharedState = {
	client?: ResearchTelemetryClient;
	primary?: object;
	primarySessionId?: string;
};

type WorkflowRun = {
	workflow: string;
	startedAt: number;
	toolCalls: number;
	subagentCalls: number;
	stopReason?: string;
};

export function resolveResearchTelemetryConfig(env: NodeJS.ProcessEnv = process.env): ResearchTelemetryConfig | undefined {
	const setting = env.FEYNMAN_TELEMETRY ?? env.FEYNMAN_POSTHOG_TELEMETRY;
	if ((setting !== undefined && TELEMETRY_DISABLED_VALUES.has(setting.trim().toLowerCase())) || env.DO_NOT_TRACK === "1") {
		return undefined;
	}
	const projectToken = env.FEYNMAN_POSTHOG_KEY?.trim();
	const host = env.FEYNMAN_POSTHOG_HOST?.trim().replace(/\/+$/, "");
	const distinctId = env.FEYNMAN_TELEMETRY_DISTINCT_ID?.trim();
	return projectToken && host && distinctId ? { projectToken, host, distinctId } : undefined;
}

function createPostHogClient(config: ResearchTelemetryConfig): ResearchTelemetryClient {
	// One attempt per send; the first failure drops the rest of this process's
	// sends silently, matching the CLI's circuit breaker.
	let transportFailed = false;
	const fetchOnce: NonNullable<PostHogOptions["fetch"]> = async (url, options) => {
		if (!transportFailed) {
			try {
				const response = await fetch(url, options as RequestInit);
				if (response.status >= 200 && response.status < 400) return response;
			} catch {}
			transportFailed = true;
		}
		return new Response(null, { status: 204 });
	};
	const client = new PostHog(config.projectToken, {
		host: config.host,
		flushAt: 1,
		flushInterval: 0,
		isServer: false,
		disableGeoip: true,
		fetchRetryCount: 0,
		fetch: fetchOnce,
	});
	client.on("error", () => {});
	return client;
}

export function workflowName(text: string, workflows: ReadonlySet<string>): string {
	const name = /^\/([A-Za-z0-9_-]+)(?:\s|$)/.exec(text.trimStart())?.[1];
	return name && workflows.has(name) ? name : "chat";
}

export function wroteResearchOutput(cwd: string, since: number): boolean {
	let scanned = 0;
	for (const dir of OUTPUT_DIRS) {
		let entries: string[];
		try {
			entries = readdirSync(join(cwd, dir), { recursive: true, encoding: "utf8" });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (++scanned > OUTPUT_SCAN_LIMIT) return false;
			try {
				const stats = statSync(join(cwd, dir, entry));
				if (stats.isFile() && stats.mtimeMs >= since) return true;
			} catch {}
		}
	}
	return false;
}

function stopStatus(stopReason: string | undefined): "completed" | "error" | "aborted" {
	return stopReason === "error" || stopReason === "aborted" ? stopReason : "completed";
}

function readWorkflowNames(): Set<string> {
	try {
		return new Set(readPromptSpecs(APP_ROOT).map((spec) => spec.name));
	} catch {
		return new Set();
	}
}

export function registerResearchTelemetry(
	pi: ExtensionAPI,
	options: {
		env?: NodeJS.ProcessEnv;
		createClient?: (config: ResearchTelemetryConfig) => ResearchTelemetryClient;
		shared?: ResearchTelemetrySharedState;
		now?: () => number;
	} = {},
): void {
	const env = options.env ?? process.env;
	const config = resolveResearchTelemetryConfig(env);
	if (!config) return;
	const now = options.now ?? Date.now;
	const globalSlot = globalThis as { [SHARED_STATE_KEY]?: ResearchTelemetrySharedState };
	const shared = options.shared ?? (globalSlot[SHARED_STATE_KEY] ??= {});
	const workflows = readWorkflowNames();
	const owner = {};
	const baseProperties = {
		app_version: FEYNMAN_VERSION,
		node_version: process.versions.node,
		platform: process.platform,
		arch: process.arch,
		telemetry_source: "feynman",
		$process_person_profile: false,
	};

	let primary = false;
	let traceId: string | undefined;
	let pendingWorkflow: string | undefined;
	let run: WorkflowRun | undefined;
	let requestStartedAt: number | undefined;
	let httpStatus: number | undefined;

	const capture = (event: string, properties: Record<string, TelemetryValue>) => {
		try {
			shared.client ??= (options.createClient ?? createPostHogClient)(config);
			shared.client.capture({ distinctId: config.distinctId, event, properties: { ...baseProperties, ...properties } });
		} catch {}
	};

	const finishRun = (cwd: string, status: "completed" | "error" | "aborted") => {
		if (!run) return;
		const finished = run;
		run = undefined;
		capture("feynman_workflow_completed", {
			workflow: finished.workflow,
			status,
			tool_calls: finished.toolCalls,
			subagent_calls: finished.subagentCalls,
			output_written: wroteResearchOutput(cwd, finished.startedAt),
			duration_ms: now() - finished.startedAt,
		});
	};

	pi.on("session_start", (event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		primary = env.PI_SUBAGENT_CHILD !== "1" && shared.primary === undefined;
		if (primary) {
			shared.primary = owner;
			shared.primarySessionId = sessionId;
		}
		traceId = primary ? sessionId : (shared.primarySessionId ?? env.PI_SUBAGENT_PARENT_SESSION ?? sessionId);
		if (!primary) return;
		capture("feynman_session_started", {
			reason: event.reason,
			mode: ctx.mode,
			model_provider: ctx.model?.provider,
			model: ctx.model?.id,
		});
	});

	pi.on("input", (event) => {
		if (primary && !event.streamingBehavior) pendingWorkflow = workflowName(event.text, workflows);
	});

	pi.on("agent_start", () => {
		if (!primary || run) return;
		run = { workflow: pendingWorkflow ?? "chat", startedAt: now(), toolCalls: 0, subagentCalls: 0 };
		pendingWorkflow = undefined;
		capture("feynman_workflow_started", { workflow: run.workflow });
	});

	pi.on("tool_execution_end", (event) => {
		capture("feynman_tool_used", { tool: event.toolName, is_error: event.isError, subagent: !primary });
		if (!run) return;
		run.toolCalls += 1;
		if (event.toolName === "subagent") run.subagentCalls += 1;
	});

	pi.on("before_provider_request", () => {
		requestStartedAt = now();
	});

	pi.on("after_provider_response", (event) => {
		httpStatus = event.status;
	});

	pi.on("message_end", (event) => {
		const message = event.message;
		if (message.role !== "assistant") return;
		// PostHog LLM analytics schema, metadata only: no $ai_input or $ai_output_choices.
		capture("$ai_generation", {
			$ai_trace_id: traceId,
			$ai_model: message.model,
			$ai_provider: message.provider,
			$ai_input_tokens: message.usage.input,
			$ai_output_tokens: message.usage.output,
			$ai_cache_read_input_tokens: message.usage.cacheRead,
			$ai_cache_creation_input_tokens: message.usage.cacheWrite,
			// Pi reports input tokens with cache reads and writes already subtracted.
			$ai_cache_reporting_exclusive: true,
			$ai_latency: requestStartedAt === undefined ? undefined : (now() - requestStartedAt) / 1000,
			$ai_http_status: httpStatus,
			$ai_is_error: message.stopReason === "error",
			$ai_stop_reason: message.stopReason,
			subagent: !primary,
		});
		requestStartedAt = undefined;
		httpStatus = undefined;
		if (run) run.stopReason = message.stopReason;
	});

	pi.on("agent_settled", (_event, ctx) => {
		finishRun(ctx.cwd, stopStatus(run?.stopReason));
	});

	pi.on("session_shutdown", async (event, ctx) => {
		finishRun(ctx.cwd, "aborted");
		if (shared.primary === owner) {
			shared.primary = undefined;
			shared.primarySessionId = undefined;
		}
		const client = shared.client;
		if (!client) return;
		const quitting = primary && event.reason === "quit";
		if (quitting) shared.client = undefined;
		let timer: NodeJS.Timeout | undefined;
		const timeout = new Promise<void>((resolve) => {
			timer = setTimeout(resolve, FLUSH_TIMEOUT_MS);
			timer.unref?.();
		});
		try {
			await Promise.race([quitting ? client.shutdown(FLUSH_TIMEOUT_MS) : client.flush(), timeout]);
		} catch {
		} finally {
			clearTimeout(timer);
		}
	});
}
