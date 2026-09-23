import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
	registerResearchTelemetry,
	resolveResearchTelemetryConfig,
	workflowName,
	type ResearchTelemetryClient,
	type ResearchTelemetrySharedState,
} from "../extensions/research-tools/telemetry.js";

type Captured = { distinctId: string; event: string; properties: Record<string, unknown> };
type Handler = (event: Record<string, unknown>, ctx: unknown) => unknown;

const TELEMETRY_ENV = {
	FEYNMAN_POSTHOG_KEY: "phc_test",
	FEYNMAN_POSTHOG_HOST: "https://posthog.test/",
	FEYNMAN_TELEMETRY_DISTINCT_ID: "feynman_test-install",
};
const SECRET_PROMPT = "retrieval augmented generation for CRISPR off-target prediction";
const SECRET_PATH = "outputs/crispr-secret-brief.md";

function fakePi() {
	const handlers = new Map<string, Handler[]>();
	const pi = {
		on(event: string, handler: Handler) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
	} as unknown as ExtensionAPI;
	const emit = async (event: Record<string, unknown> & { type: string }, ctx: unknown) => {
		for (const handler of handlers.get(event.type) ?? []) await handler(event, ctx);
	};
	return { pi, handlers, emit };
}

function fakeClient() {
	const captured: Captured[] = [];
	const lifecycle: string[] = [];
	const client = {
		capture(message: Captured) {
			captured.push(message);
		},
		async flush() {
			lifecycle.push("flush");
		},
		async shutdown() {
			lifecycle.push("shutdown");
		},
	} as unknown as ResearchTelemetryClient;
	return { client, captured, lifecycle };
}

function ctx(cwd: string, sessionId: string) {
	return {
		cwd,
		mode: "print",
		model: { provider: "ferrylane-openai", id: "gpt-5.6-luna" },
		sessionManager: { getSessionId: () => sessionId },
	};
}

function assistant(stopReason: string) {
	return {
		role: "assistant",
		content: [{ type: "text", text: SECRET_PROMPT }],
		api: "openai-responses",
		provider: "ferrylane-openai",
		model: "gpt-5.6-luna",
		usage: { input: 1200, output: 80, cacheRead: 300, cacheWrite: 0, totalTokens: 1580, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason,
		timestamp: 0,
	};
}

test("research telemetry is off unless the CLI passed its config and no opt-out is set", () => {
	assert.equal(resolveResearchTelemetryConfig({}), undefined);
	assert.equal(resolveResearchTelemetryConfig({ ...TELEMETRY_ENV, FEYNMAN_TELEMETRY: "off" }), undefined);
	assert.equal(resolveResearchTelemetryConfig({ ...TELEMETRY_ENV, FEYNMAN_POSTHOG_TELEMETRY: "0" }), undefined);
	assert.equal(resolveResearchTelemetryConfig({ ...TELEMETRY_ENV, DO_NOT_TRACK: "1" }), undefined);
	assert.deepEqual(resolveResearchTelemetryConfig(TELEMETRY_ENV), {
		projectToken: "phc_test",
		host: "https://posthog.test",
		distinctId: "feynman_test-install",
	});

	for (const env of [{}, { ...TELEMETRY_ENV, FEYNMAN_TELEMETRY: "off" }, { ...TELEMETRY_ENV, DO_NOT_TRACK: "1" }]) {
		const { pi, handlers } = fakePi();
		let clients = 0;
		registerResearchTelemetry(pi, { env, shared: {}, createClient: () => {
			clients += 1;
			return fakeClient().client;
		} });
		assert.equal(handlers.size, 0);
		assert.equal(clients, 0);
	}
});

test("workflowName reports Feynman workflow slash commands and nothing else", () => {
	const workflows = new Set(["deepresearch", "lit"]);
	assert.equal(workflowName(`/deepresearch ${SECRET_PROMPT}`, workflows), "deepresearch");
	assert.equal(workflowName("/lit", workflows), "lit");
	assert.equal(workflowName("/literature", workflows), "chat");
	assert.equal(workflowName("/skill:paper-eval x", workflows), "chat");
	assert.equal(workflowName(SECRET_PROMPT, workflows), "chat");
});

test("research telemetry sends metadata-only product and $ai_generation events", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "feynman-research-telemetry-"));
	const startedAt = Date.now();
	let clock = startedAt;
	const { pi, emit } = fakePi();
	const { client, captured, lifecycle } = fakeClient();
	const shared: ResearchTelemetrySharedState = {};
	try {
		registerResearchTelemetry(pi, { env: TELEMETRY_ENV, shared, createClient: () => client, now: () => clock });
		const context = ctx(cwd, "session-parent");

		await emit({ type: "session_start", reason: "startup" }, context);
		await emit({ type: "input", text: `/deepresearch ${SECRET_PROMPT}`, source: "interactive" }, context);
		await emit({ type: "agent_start" }, context);
		await emit({ type: "before_provider_request", payload: { input: SECRET_PROMPT } }, context);
		clock += 1_500;
		await emit({ type: "after_provider_response", status: 200, headers: {} }, context);
		await emit({ type: "message_end", message: assistant("toolUse") }, context);
		mkdirSync(join(cwd, "outputs"), { recursive: true });
		writeFileSync(join(cwd, SECRET_PATH), SECRET_PROMPT);
		await emit({ type: "tool_execution_end", toolCallId: "t1", toolName: "write", result: { content: SECRET_PROMPT }, isError: false }, context);
		await emit({ type: "tool_execution_end", toolCallId: "t2", toolName: "subagent", result: {}, isError: true }, context);
		clock += 500;
		await emit({ type: "message_end", message: assistant("stop") }, context);
		await emit({ type: "message_end", message: { role: "user", content: SECRET_PROMPT, timestamp: 0 } }, context);
		clock += 1_000;
		await emit({ type: "agent_settled" }, context);
		await emit({ type: "session_shutdown", reason: "quit" }, context);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}

	assert.deepEqual(captured.map(({ event }) => event), [
		"feynman_session_started",
		"feynman_workflow_started",
		"$ai_generation",
		"feynman_tool_used",
		"feynman_tool_used",
		"$ai_generation",
		"feynman_workflow_completed",
	]);
	assert.ok(captured.every(({ distinctId }) => distinctId === "feynman_test-install"));
	const byEvent = (name: string) => captured.filter(({ event }) => event === name).map(({ properties }) => properties);

	assert.deepEqual(byEvent("feynman_session_started")[0], {
		app_version: byEvent("feynman_session_started")[0]!.app_version,
		node_version: process.versions.node,
		platform: process.platform,
		arch: process.arch,
		telemetry_source: "feynman",
		$process_person_profile: false,
		reason: "startup",
		mode: "print",
		model_provider: "ferrylane-openai",
		model: "gpt-5.6-luna",
	});
	assert.equal(byEvent("feynman_workflow_started")[0]!.workflow, "deepresearch");
	assert.deepEqual(
		byEvent("feynman_tool_used").map(({ tool, is_error, subagent }) => ({ tool, is_error, subagent })),
		[{ tool: "write", is_error: false, subagent: false }, { tool: "subagent", is_error: true, subagent: false }],
	);

	const [firstGeneration, secondGeneration] = byEvent("$ai_generation");
	assert.equal(firstGeneration!.$ai_trace_id, "session-parent");
	assert.equal(firstGeneration!.$ai_model, "gpt-5.6-luna");
	assert.equal(firstGeneration!.$ai_provider, "ferrylane-openai");
	assert.equal(firstGeneration!.$ai_input_tokens, 1200);
	assert.equal(firstGeneration!.$ai_output_tokens, 80);
	assert.equal(firstGeneration!.$ai_cache_read_input_tokens, 300);
	assert.equal(firstGeneration!.$ai_cache_creation_input_tokens, 0);
	assert.equal(firstGeneration!.$ai_cache_reporting_exclusive, true);
	assert.equal(firstGeneration!.$ai_latency, 1.5);
	assert.equal(firstGeneration!.$ai_http_status, 200);
	assert.equal(firstGeneration!.$ai_is_error, false);
	assert.equal(firstGeneration!.$ai_stop_reason, "toolUse");
	assert.equal(secondGeneration!.$ai_latency, undefined);
	assert.equal(secondGeneration!.$ai_http_status, undefined);

	const completed = byEvent("feynman_workflow_completed")[0]!;
	assert.equal(completed.workflow, "deepresearch");
	assert.equal(completed.status, "completed");
	assert.equal(completed.tool_calls, 2);
	assert.equal(completed.subagent_calls, 1);
	assert.equal(completed.output_written, true);
	assert.equal(completed.duration_ms, 3_000);

	const serialized = JSON.stringify(captured);
	for (const forbidden of [SECRET_PROMPT, "crispr", cwd, "$ai_input\"", "$ai_output_choices", "$ai_error", "$ai_base_url"]) {
		assert.equal(serialized.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
	}
	assert.deepEqual(lifecycle, ["shutdown"]);
	assert.equal(shared.client, undefined);
	assert.equal(shared.primary, undefined);
});

test("in-process subagent sessions send only generations and tool use under the parent trace", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "feynman-research-telemetry-child-"));
	const shared: ResearchTelemetrySharedState = {};
	const { client, captured, lifecycle } = fakeClient();
	const parent = fakePi();
	const child = fakePi();
	try {
		registerResearchTelemetry(parent.pi, { env: TELEMETRY_ENV, shared, createClient: () => client });
		registerResearchTelemetry(child.pi, { env: TELEMETRY_ENV, shared, createClient: () => client });
		await parent.emit({ type: "session_start", reason: "startup" }, ctx(cwd, "session-parent"));
		await parent.emit({ type: "input", text: "/lit topic", source: "interactive" }, ctx(cwd, "session-parent"));
		await parent.emit({ type: "agent_start" }, ctx(cwd, "session-parent"));

		const childCtx = ctx(cwd, "session-child");
		await child.emit({ type: "session_start", reason: "startup" }, childCtx);
		await child.emit({ type: "input", text: "/deepresearch nested", source: "interactive" }, childCtx);
		await child.emit({ type: "agent_start" }, childCtx);
		await child.emit({ type: "message_end", message: assistant("error") }, childCtx);
		await child.emit({ type: "tool_execution_end", toolCallId: "c1", toolName: "web_search", result: {}, isError: false }, childCtx);
		await child.emit({ type: "agent_settled" }, childCtx);
		await child.emit({ type: "session_shutdown", reason: "quit" }, childCtx);

		await parent.emit({ type: "agent_settled" }, ctx(cwd, "session-parent"));
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}

	assert.deepEqual(captured.map(({ event }) => event), [
		"feynman_session_started",
		"feynman_workflow_started",
		"$ai_generation",
		"feynman_tool_used",
		"feynman_workflow_completed",
	]);
	const generation = captured[2]!.properties;
	assert.equal(generation.$ai_trace_id, "session-parent");
	assert.equal(generation.$ai_is_error, true);
	assert.equal(generation.subagent, true);
	assert.equal(captured[3]!.properties.subagent, true);
	const completed = captured[4]!.properties;
	assert.equal(completed.workflow, "lit");
	assert.equal(completed.tool_calls, 0);
	assert.equal(completed.output_written, false);
	// A child session's shutdown flushes the shared client without closing it.
	assert.deepEqual(lifecycle, ["flush"]);
	assert.ok(shared.client);
});

test("quitting mid-run reports the workflow as aborted", async () => {
	const { pi, emit } = fakePi();
	const { client, captured } = fakeClient();
	registerResearchTelemetry(pi, { env: TELEMETRY_ENV, shared: {}, createClient: () => client });
	const context = ctx(tmpdir(), "session-quit");
	await emit({ type: "session_start", reason: "resume" }, context);
	await emit({ type: "input", text: "hello", source: "rpc" }, context);
	await emit({ type: "agent_start" }, context);
	await emit({ type: "session_shutdown", reason: "quit" }, context);

	const completed = captured.find(({ event }) => event === "feynman_workflow_completed")!.properties;
	assert.equal(completed.workflow, "chat");
	assert.equal(completed.status, "aborted");
});
