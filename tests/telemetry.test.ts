import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import {
	DEFAULT_POSTHOG_HOST,
	DEFAULT_POSTHOG_PROJECT_ID,
	DEFAULT_POSTHOG_PROJECT_TOKEN,
	TELEMETRY_NOTICE,
	captureTelemetryEventImmediate,
	createTelemetryCircuitBreakerFetch,
	createOneShotOtlpTransport,
	createTelemetryTransportCircuitBreaker,
	getCliTelemetryMetadata,
	getPostHogChildEnv,
	initializePostHogTelemetry,
	normalizeTelemetryProperties,
	resolvePostHogTelemetryConfig,
	sanitizeTelemetryException,
	shutdownPostHogTelemetry,
	telemetryErrorProperties,
	telemetryFirstRunNotice,
} from "../src/telemetry/posthog.js";

test("resolvePostHogTelemetryConfig defaults to the Feynman PostHog project", () => {
	const home = mkdtempSync(join(tmpdir(), "feynman-telemetry-home-"));
	const config = resolvePostHogTelemetryConfig({
		home,
		appVersion: "0.3.4",
		serviceName: "feynman-test",
		env: {
			FEYNMAN_TELEMETRY: "1",
		},
	});

	assert.equal(config?.host, DEFAULT_POSTHOG_HOST);
	assert.equal(config?.projectId, DEFAULT_POSTHOG_PROJECT_ID);
	assert.equal(config?.projectToken, DEFAULT_POSTHOG_PROJECT_TOKEN);
	assert.equal(config?.appVersion, "0.3.4");
	assert.equal(config?.serviceName, "feynman-test");
	assert.match(config?.distinctId ?? "", /^feynman_/);

	const state = JSON.parse(readFileSync(join(home, ".state", "telemetry.json"), "utf8")) as { anonymousId?: string };
	assert.equal(state.anonymousId, config?.distinctId);
});

test("resolvePostHogTelemetryConfig respects telemetry opt out", () => {
	assert.equal(resolvePostHogTelemetryConfig({ env: { FEYNMAN_TELEMETRY: "off" } }), undefined);
	assert.equal(resolvePostHogTelemetryConfig({ env: { DO_NOT_TRACK: "1" } }), undefined);
});

test("first-run notice says what is sent and how to opt out, once per Feynman home", async () => {
	const home = mkdtempSync(join(tmpdir(), "feynman-telemetry-notice-home-"));
	const previous = { FEYNMAN_TELEMETRY: process.env.FEYNMAN_TELEMETRY, DO_NOT_TRACK: process.env.DO_NOT_TRACK };
	delete process.env.FEYNMAN_TELEMETRY;
	delete process.env.DO_NOT_TRACK;
	try {
		assert.match(TELEMETRY_NOTICE, /anonymous usage telemetry/);
		assert.match(TELEMETRY_NOTICE, /never sends prompts, paper content, file paths, or tool arguments/);
		assert.match(TELEMETRY_NOTICE, /FEYNMAN_TELEMETRY=off/);

		initializePostHogTelemetry({ home, posthogFetch: async () => new Response(null, { status: 204 }), otlpFetch: async () => new Response(null, { status: 204 }) });
		// Scripts and CI never see it, and it stays pending for the first interactive run.
		assert.equal(telemetryFirstRunNotice(home, false), undefined);
		assert.equal(telemetryFirstRunNotice(home, true), TELEMETRY_NOTICE);
		// Repeats within the process so a launch that clears the screen can reprint it.
		assert.equal(telemetryFirstRunNotice(home, true), TELEMETRY_NOTICE);
		const state = JSON.parse(readFileSync(join(home, ".state", "telemetry.json"), "utf8")) as { noticeShown?: boolean; anonymousId?: string };
		assert.equal(state.noticeShown, true);
		assert.match(state.anonymousId ?? "", /^feynman_/);
		await shutdownPostHogTelemetry();

		initializePostHogTelemetry({ home, posthogFetch: async () => new Response(null, { status: 204 }), otlpFetch: async () => new Response(null, { status: 204 }) });
		assert.equal(telemetryFirstRunNotice(home, true), undefined);
		await shutdownPostHogTelemetry();

		const optedOutHome = mkdtempSync(join(tmpdir(), "feynman-telemetry-notice-off-"));
		process.env.FEYNMAN_TELEMETRY = "off";
		initializePostHogTelemetry({ home: optedOutHome });
		assert.equal(telemetryFirstRunNotice(optedOutHome, true), undefined);
		assert.deepEqual(getPostHogChildEnv(), {});
		rmSync(optedOutHome, { recursive: true, force: true });
	} finally {
		await shutdownPostHogTelemetry();
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		rmSync(home, { recursive: true, force: true });
	}
});

test("Pi child env carries the CLI's PostHog project and install id only while telemetry is active", async () => {
	const home = mkdtempSync(join(tmpdir(), "feynman-telemetry-child-env-"));
	const previous = process.env.FEYNMAN_TELEMETRY;
	delete process.env.FEYNMAN_TELEMETRY;
	try {
		assert.deepEqual(getPostHogChildEnv(), {});
		const config = initializePostHogTelemetry({ home, posthogFetch: async () => new Response(null, { status: 204 }), otlpFetch: async () => new Response(null, { status: 204 }) });
		assert.deepEqual(getPostHogChildEnv(), {
			FEYNMAN_POSTHOG_KEY: DEFAULT_POSTHOG_PROJECT_TOKEN,
			FEYNMAN_POSTHOG_HOST: DEFAULT_POSTHOG_HOST,
			FEYNMAN_TELEMETRY_DISTINCT_ID: config?.distinctId,
		});
		await shutdownPostHogTelemetry();
		assert.deepEqual(getPostHogChildEnv(), {});
	} finally {
		await shutdownPostHogTelemetry();
		if (previous === undefined) delete process.env.FEYNMAN_TELEMETRY;
		else process.env.FEYNMAN_TELEMETRY = previous;
		rmSync(home, { recursive: true, force: true });
	}
});

test("PostHog transport failures open a silent session circuit breaker", async () => {
	const home = mkdtempSync(join(tmpdir(), "feynman-telemetry-failure-home-"));
	let fetchAttempts = 0;
	const originalConsoleError = console.error;
	const consoleErrors: unknown[][] = [];
	console.error = (...args: unknown[]) => {
		consoleErrors.push(args);
	};

	try {
		initializePostHogTelemetry({
			home,
			appVersion: "0.3.10",
			serviceName: "feynman-test",
			posthogFetch: async () => {
				fetchAttempts += 1;
				throw new Error("simulated unreachable telemetry endpoint");
			},
		});
		await captureTelemetryEventImmediate("transport_failure_probe");
		await captureTelemetryEventImmediate("transport_failure_probe_after_circuit");
		await shutdownPostHogTelemetry();
	} finally {
		console.error = originalConsoleError;
		await shutdownPostHogTelemetry();
	}

	assert.equal(fetchAttempts, 1);
	assert.deepEqual(consoleErrors, []);
});

test("PostHog transport sends gzip bytes without retaining Node Blob readers", async () => {
	const home = mkdtempSync(join(tmpdir(), "feynman-telemetry-gzip-home-"));
	let requestBody: unknown;
	let requestHeaders: unknown;
	try {
		initializePostHogTelemetry({
			home,
			appVersion: "0.3.39",
			serviceName: "feynman-test",
			posthogFetch: async (_url, options) => {
				requestBody = options?.body;
				requestHeaders = options?.headers;
				return new Response(null, { status: 204 });
			},
			otlpFetch: async () => new Response(null, { status: 204 }),
		});
		await captureTelemetryEventImmediate("gzip_body_probe");
	} finally {
		await shutdownPostHogTelemetry();
		rmSync(home, { recursive: true, force: true });
	}

	assert.equal(requestBody instanceof Uint8Array, true);
	assert.equal(requestBody instanceof Blob, false);
	assert.deepEqual(Array.from((requestBody as Uint8Array).subarray(0, 2)), [0x1f, 0x8b]);
	assert.equal(new Headers(requestHeaders as HeadersInit).get("content-encoding"), "gzip");
	assert.match(gunzipSync(requestBody as Uint8Array).toString("utf8"), /gzip_body_probe/);
});

test("PostHog circuit breaker drops later requests after a non-success response", async () => {
	let fetchAttempts = 0;
	const failures: unknown[] = [];
	const circuitFetch = createTelemetryCircuitBreakerFetch(
		async () => {
			fetchAttempts += 1;
			return new Response("unavailable", { status: 503 });
		},
		(error) => failures.push(error),
	);

	const request = { method: "POST" as const, headers: {} };
	assert.equal((await circuitFetch("https://example.test/batch", request)).status, 204);
	assert.equal((await circuitFetch("https://example.test/batch", request)).status, 204);
	assert.equal(fetchAttempts, 1);
	assert.equal(failures.length, 1);
	assert.match(failures[0] instanceof Error ? failures[0].message : "", /HTTP 503/);
});

test("OTLP transport makes one silent attempt and shares the open circuit with PostHog", async () => {
	let otlpAttempts = 0;
	let posthogAttempts = 0;
	const failures: unknown[] = [];
	const circuit = createTelemetryTransportCircuitBreaker((error) => failures.push(error));
	const transport = createOneShotOtlpTransport({
		url: "https://example.test/i/v1/traces",
		headers: { Authorization: "Bearer test" },
		contentType: "application/x-protobuf",
		fetchImpl: async () => {
			otlpAttempts += 1;
			throw new Error("simulated blocked collector");
		},
		circuit,
	});
	const posthogFetch = createTelemetryCircuitBreakerFetch(
		async () => {
			posthogAttempts += 1;
			return new Response(null, { status: 204 });
		},
		(error) => failures.push(error),
		circuit,
	);

	assert.deepEqual(await transport.send(new Uint8Array([1, 2, 3]), 50), { status: "success" });
	assert.deepEqual(await transport.send(new Uint8Array([4, 5, 6]), 50), { status: "success" });
	assert.equal((await posthogFetch("https://example.test/batch", { method: "POST", headers: {} })).status, 204);
	assert.equal(otlpAttempts, 1);
	assert.equal(posthogAttempts, 0);
	assert.equal(failures.length, 1);
	assert.equal(circuit.isOpen(), true);
});

test("getCliTelemetryMetadata does not record unknown commands or malformed flag values", () => {
	const metadata = getCliTelemetryMetadata([
		"private-research-prompt",
		"--mode",
		"/private/path/mode",
		"--service-tier=not-a-number",
	]);
	const serialized = JSON.stringify(metadata);

	assert.equal(metadata.command, "chat");
	assert.equal(metadata.mode, undefined);
	assert.equal(serialized.includes("private-research-prompt"), false);
	assert.equal(serialized.includes("/private/path"), false);
	assert.equal(serialized.includes("not-a-number"), false);
});

test("getCliTelemetryMetadata keeps whitelisted workflow commands and safe subcommands", () => {
	const workflow = getCliTelemetryMetadata(["review", "paper title"], { knownCommands: ["review"] });
	const unknownSubcommand = getCliTelemetryMetadata(["model", "private-provider-name"]);
	const knownSubcommand = getCliTelemetryMetadata(["model", "list"]);

	assert.equal(workflow.command, "review");
	assert.equal(unknownSubcommand.command, "model");
	assert.equal(unknownSubcommand.subcommand, undefined);
	assert.equal(knownSubcommand.command, "model");
	assert.equal(knownSubcommand.subcommand, "list");
});

test("getCliTelemetryMetadata does not treat double-dash prompt text as a command", () => {
	const metadata = getCliTelemetryMetadata([
		"--",
		"private",
		"one-shot",
		"prompt",
	]);
	const serialized = JSON.stringify(metadata);

	assert.equal(metadata.command, "chat");
	assert.equal(serialized.includes("private"), false);
	assert.equal(serialized.includes("one-shot"), false);
});

test("sanitizeTelemetryException keeps only an error kind and message hash", () => {
	const error = new Error("private prompt from /Users/advaitpaliwal/secret-paper.md");
	error.stack = "Error: private prompt\n    at /Users/advaitpaliwal/secret-paper.md:1:1";
	const sanitized = sanitizeTelemetryException(error);
	const properties = telemetryErrorProperties(error);
	const serialized = JSON.stringify({ sanitized, properties });

	assert.equal(sanitized.name, "Error");
	assert.equal(sanitized.message, `error_message_hash:${properties.error_message_hash}`);
	assert.equal(properties.error_name, "Error");
	assert.match(String(properties.error_message_hash), /^[a-f0-9]{16}$/);
	assert.equal(serialized.includes("private prompt"), false);
	assert.equal(serialized.includes("/Users/advaitpaliwal"), false);
	assert.equal(serialized.includes("secret-paper"), false);
	assert.equal("stack" in sanitized, false);
});

test("telemetryErrorProperties falls back when Error.name is not a safe class label", () => {
	const error = new Error("stable message");
	error.name = "Private /Users/advaitpaliwal/Error";

	assert.equal(telemetryErrorProperties(error).error_name, "Error");
});

test("normalizeTelemetryProperties keeps bounded snake_case scalar properties", () => {
	const normalized = normalizeTelemetryProperties({
		"Command Name": "rank",
		durationMs: 123,
		raw: "x".repeat(300),
		empty: "",
		notFinite: Number.POSITIVE_INFINITY,
	});

	assert.deepEqual(Object.keys(normalized).sort(), ["command_name", "duration_ms", "raw"]);
	assert.equal(normalized.command_name, "rank");
	assert.equal(normalized.duration_ms, 123);
	assert.equal(String(normalized.raw).length, 240);
});
