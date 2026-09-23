import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
	BUNDLED_PI_PACKAGES,
	buildPiArgs,
	buildPiEnv,
	ensureFeynmanCommandShim,
	ensureFeynmanWorkspaceScaffold,
	getFeynmanCommandShimDir,
	getFeynmanPackageSources,
	resolvePackageRoot,
	resolvePiCliPath,
	validatePiInstallation,
} from "../src/pi/runtime.js";
import { resolveBundledAlphaCliPath } from "../src/cli.js";

test("buildPiArgs includes configured runtime paths and prompt", () => {
	const args = buildPiArgs({
		appRoot: "/repo/feynman",
		workingDir: "/workspace",
		sessionDir: "/sessions",
		feynmanAgentDir: "/home/.feynman/agent",
		mode: "rpc",
		initialPrompt: "hello",
		explicitModelSpec: "openai:gpt-test",
		thinkingLevel: "medium",
	});

	assert.deepEqual(args, [
		"--session-dir",
		"/sessions",
		"--mode",
		"rpc",
		"--model",
		"openai:gpt-test",
		"--thinking",
		"medium",
		"--",
		"hello",
	]);
});

test("buildPiArgs places the delimiter after all options for dash-leading prompts", () => {
	const oneShotArgs = buildPiArgs({
		appRoot: "/repo/feynman",
		workingDir: "/workspace",
		sessionDir: "/sessions",
		feynmanAgentDir: "/home/.feynman/agent",
		mode: "text",
		explicitModelSpec: "openai:gpt-test",
		oneShotPrompt: "--answer briefly",
	});
	assert.deepEqual(oneShotArgs.slice(-5), [
		"--model",
		"openai:gpt-test",
		"-p",
		"--",
		"--answer briefly",
	]);
	assert.ok(oneShotArgs.indexOf("--model") < oneShotArgs.indexOf("--"));

	const initialArgs = buildPiArgs({
		appRoot: "/repo/feynman",
		workingDir: "/workspace",
		sessionDir: "/sessions",
		feynmanAgentDir: "/home/.feynman/agent",
		mode: "rpc",
		initialPrompt: "- summarize these results",
	});
	assert.deepEqual(initialArgs.slice(-2), ["--", "- summarize these results"]);
	assert.ok(initialArgs.indexOf("--mode") < initialArgs.indexOf("--"));
});

test("buildPiArgs omits thinking arg when launch thinking is not explicit", () => {
	const args = buildPiArgs({
		appRoot: "/repo/feynman",
		workingDir: "/workspace",
		sessionDir: "/sessions",
		feynmanAgentDir: "/home/.feynman/agent",
		mode: "rpc",
		initialPrompt: "hello",
	});

	assert.equal(args.includes("--thinking"), false);
});

test("buildPiArgs passes --continue when resuming the recent persisted session", () => {
	const args = buildPiArgs({
		appRoot: "/repo/feynman",
		workingDir: "/workspace",
		sessionDir: "/sessions",
		feynmanAgentDir: "/home/.feynman/agent",
		mode: "text",
		resumeRecentSession: true,
	});

	assert.ok(args.includes("--continue"));
	assert.equal(args.includes("--new-session"), false);
	assert.equal(args.includes("--"), false);
});

test("buildPiArgs forwards Pi session flags and loads SYSTEM.md by path", () => {
	const args = buildPiArgs({
		appRoot: process.cwd(),
		workingDir: "/workspace",
		sessionDir: "/sessions",
		feynmanAgentDir: "/home/.feynman/agent",
		piArgs: ["--fork", "abc123"],
		initialPrompt: "hello",
	});

	assert.deepEqual(args, [
		"--session-dir",
		"/sessions",
		"--system-prompt",
		join(process.cwd(), ".feynman", "SYSTEM.md"),
		"--fork",
		"abc123",
		"--",
		"hello",
	]);
});

test("buildPiEnv wires Feynman paths into the Pi environment", () => {
	const previousUppercasePrefix = process.env.NPM_CONFIG_PREFIX;
	const previousLowercasePrefix = process.env.npm_config_prefix;
	const previousOtelServiceName = process.env.OTEL_SERVICE_NAME;
	const previousOtelServiceVersion = process.env.OTEL_SERVICE_VERSION;
	const previousOtelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
	const previousOtelHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS;
	const previousOtelProtocol = process.env.OTEL_EXPORTER_OTLP_PROTOCOL;
	const previousPiOtelServiceName = process.env.PI_OTEL_SERVICE_NAME;
	const previousPiOtelServiceVersion = process.env.PI_OTEL_SERVICE_VERSION;
	const previousTelemetrySetting = process.env.FEYNMAN_TELEMETRY;
	const previousTelemetryDistinctId = process.env.FEYNMAN_TELEMETRY_DISTINCT_ID;
	const previousPostHogKey = process.env.FEYNMAN_POSTHOG_KEY;
	const previousPostHogHost = process.env.FEYNMAN_POSTHOG_HOST;
	const previousPostHogProjectId = process.env.FEYNMAN_POSTHOG_PROJECT_ID;
	const previousDoNotTrack = process.env.DO_NOT_TRACK;
	process.env.NPM_CONFIG_PREFIX = "/tmp/global-prefix";
	process.env.npm_config_prefix = "/tmp/global-prefix-lower";
	delete process.env.OTEL_SERVICE_NAME;
	delete process.env.OTEL_SERVICE_VERSION;
	process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://private-collector.example/v1/traces";
	process.env.OTEL_EXPORTER_OTLP_HEADERS = "Authorization=Bearer private-token";
	process.env.OTEL_EXPORTER_OTLP_PROTOCOL = "grpc";
	delete process.env.PI_OTEL_SERVICE_NAME;
	delete process.env.PI_OTEL_SERVICE_VERSION;
	process.env.FEYNMAN_TELEMETRY = "1";
	process.env.FEYNMAN_TELEMETRY_DISTINCT_ID = "feynman_test";
	delete process.env.FEYNMAN_POSTHOG_KEY;
	delete process.env.FEYNMAN_POSTHOG_HOST;
	delete process.env.FEYNMAN_POSTHOG_PROJECT_ID;
	delete process.env.DO_NOT_TRACK;

	const env = buildPiEnv({
		appRoot: "/repo/feynman",
		workingDir: "/workspace",
		sessionDir: "/sessions",
		feynmanAgentDir: "/home/.feynman/agent",
		feynmanVersion: "0.1.5",
	});

	try {
		assert.equal(env.FEYNMAN_BIN_PATH, "/repo/feynman/bin/feynman.js");
		assert.equal(env.PI_CODING_AGENT_DIR, "/home/.feynman/agent");
		assert.equal(env.NPM_CONFIG_PREFIX, "/tmp/global-prefix");
		assert.equal(env.npm_config_prefix, "/tmp/global-prefix-lower");
		for (const key of ["FEYNMAN_CODING_AGENT_DIR", "FEYNMAN_PI_CLI_PATH", "FEYNMAN_NPM_PREFIX", "FEYNMAN_SESSION_DIR", "FEYNMAN_MEMORY_DIR"]) {
			assert.equal(env[key], undefined, key);
		}
		assert.equal(env.FEYNMAN_POSTHOG_HOST, "https://us.i.posthog.com");
		assert.match(env.FEYNMAN_POSTHOG_KEY ?? "", /^phc_/);
		assert.equal(env.FEYNMAN_POSTHOG_PROJECT_ID, "623906");
		assert.equal(env.OTEL_EXPORTER_OTLP_ENDPOINT, "https://us.i.posthog.com/i");
		assert.match(env.OTEL_EXPORTER_OTLP_HEADERS ?? "", /^Authorization=Bearer phc_/);
		assert.equal(env.OTEL_EXPORTER_OTLP_PROTOCOL, "http/protobuf");
		assert.equal(env.OTEL_NODE_RESOURCE_DETECTORS, "none");
		assert.equal(env.PI_OTEL_CAPTURE_CONTENT, "metadata_only");
		assert.equal(env.PI_OTEL_LOGS, "0");
		assert.equal(env.PI_OTEL_METRICS, "0");
		assert.equal(env.OTEL_SERVICE_NAME, "feynman-pi");
		assert.equal(env.OTEL_SERVICE_VERSION, undefined);
		assert.equal(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT, undefined);
		assert.ok(env.PATH?.startsWith("/home/.feynman/bin:/repo/feynman/node_modules/.bin:"));
	} finally {
		if (previousUppercasePrefix === undefined) {
			delete process.env.NPM_CONFIG_PREFIX;
		} else {
			process.env.NPM_CONFIG_PREFIX = previousUppercasePrefix;
		}
		if (previousLowercasePrefix === undefined) {
			delete process.env.npm_config_prefix;
		} else {
			process.env.npm_config_prefix = previousLowercasePrefix;
		}
		if (previousOtelServiceName === undefined) {
			delete process.env.OTEL_SERVICE_NAME;
		} else {
			process.env.OTEL_SERVICE_NAME = previousOtelServiceName;
		}
		if (previousOtelServiceVersion === undefined) {
			delete process.env.OTEL_SERVICE_VERSION;
		} else {
			process.env.OTEL_SERVICE_VERSION = previousOtelServiceVersion;
		}
		if (previousOtelEndpoint === undefined) {
			delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
		} else {
			process.env.OTEL_EXPORTER_OTLP_ENDPOINT = previousOtelEndpoint;
		}
		if (previousOtelHeaders === undefined) {
			delete process.env.OTEL_EXPORTER_OTLP_HEADERS;
		} else {
			process.env.OTEL_EXPORTER_OTLP_HEADERS = previousOtelHeaders;
		}
		if (previousOtelProtocol === undefined) {
			delete process.env.OTEL_EXPORTER_OTLP_PROTOCOL;
		} else {
			process.env.OTEL_EXPORTER_OTLP_PROTOCOL = previousOtelProtocol;
		}
		if (previousPiOtelServiceName === undefined) {
			delete process.env.PI_OTEL_SERVICE_NAME;
		} else {
			process.env.PI_OTEL_SERVICE_NAME = previousPiOtelServiceName;
		}
		if (previousPiOtelServiceVersion === undefined) {
			delete process.env.PI_OTEL_SERVICE_VERSION;
		} else {
			process.env.PI_OTEL_SERVICE_VERSION = previousPiOtelServiceVersion;
		}
		if (previousTelemetrySetting === undefined) {
			delete process.env.FEYNMAN_TELEMETRY;
		} else {
			process.env.FEYNMAN_TELEMETRY = previousTelemetrySetting;
		}
		if (previousTelemetryDistinctId === undefined) {
			delete process.env.FEYNMAN_TELEMETRY_DISTINCT_ID;
		} else {
			process.env.FEYNMAN_TELEMETRY_DISTINCT_ID = previousTelemetryDistinctId;
		}
		if (previousPostHogKey === undefined) {
			delete process.env.FEYNMAN_POSTHOG_KEY;
		} else {
			process.env.FEYNMAN_POSTHOG_KEY = previousPostHogKey;
		}
		if (previousPostHogHost === undefined) {
			delete process.env.FEYNMAN_POSTHOG_HOST;
		} else {
			process.env.FEYNMAN_POSTHOG_HOST = previousPostHogHost;
		}
		if (previousPostHogProjectId === undefined) {
			delete process.env.FEYNMAN_POSTHOG_PROJECT_ID;
		} else {
			process.env.FEYNMAN_POSTHOG_PROJECT_ID = previousPostHogProjectId;
		}
		if (previousDoNotTrack === undefined) {
			delete process.env.DO_NOT_TRACK;
		} else {
			process.env.DO_NOT_TRACK = previousDoNotTrack;
		}
	}
});

test("buildPiEnv clears inherited telemetry collectors when Feynman telemetry is disabled", () => {
	const savedEnv = {
		FEYNMAN_TELEMETRY: process.env.FEYNMAN_TELEMETRY,
		FEYNMAN_POSTHOG_KEY: process.env.FEYNMAN_POSTHOG_KEY,
		FEYNMAN_POSTHOG_HOST: process.env.FEYNMAN_POSTHOG_HOST,
		FEYNMAN_POSTHOG_PROJECT_ID: process.env.FEYNMAN_POSTHOG_PROJECT_ID,
		OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
		OTEL_EXPORTER_OTLP_HEADERS: process.env.OTEL_EXPORTER_OTLP_HEADERS,
		OTEL_EXPORTER_OTLP_PROTOCOL: process.env.OTEL_EXPORTER_OTLP_PROTOCOL,
		OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
		OTEL_EXPORTER_OTLP_TRACES_HEADERS: process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS,
			OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL,
			OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT,
			OTEL_EXPORTER_OTLP_LOGS_HEADERS: process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS,
			OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: process.env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL,
			OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
			OTEL_EXPORTER_OTLP_METRICS_HEADERS: process.env.OTEL_EXPORTER_OTLP_METRICS_HEADERS,
			OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: process.env.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL,
			OTEL_RESOURCE_ATTRIBUTES: process.env.OTEL_RESOURCE_ATTRIBUTES,
			OTEL_TRACES_EXPORTER: process.env.OTEL_TRACES_EXPORTER,
			OTEL_LOGS_EXPORTER: process.env.OTEL_LOGS_EXPORTER,
			OTEL_METRICS_EXPORTER: process.env.OTEL_METRICS_EXPORTER,
			OTEL_LOG_LEVEL: process.env.OTEL_LOG_LEVEL,
			PI_OTEL_DISABLED: process.env.PI_OTEL_DISABLED,
			PI_OTEL_CAPTURE_CONTENT: process.env.PI_OTEL_CAPTURE_CONTENT,
			PI_OTEL_LOGS: process.env.PI_OTEL_LOGS,
			PI_OTEL_METRICS: process.env.PI_OTEL_METRICS,
			PI_OTEL_SERVICE_NAME: process.env.PI_OTEL_SERVICE_NAME,
			PI_OTEL_SERVICE_VERSION: process.env.PI_OTEL_SERVICE_VERSION,
			OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME,
			OTEL_SERVICE_VERSION: process.env.OTEL_SERVICE_VERSION,
		};
	process.env.FEYNMAN_TELEMETRY = "off";
	process.env.FEYNMAN_POSTHOG_KEY = "private-feynman-posthog-key";
	process.env.FEYNMAN_POSTHOG_HOST = "https://private-posthog.example";
	process.env.FEYNMAN_POSTHOG_PROJECT_ID = "private-project";
	process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://private-collector.example/v1/traces";
	process.env.OTEL_EXPORTER_OTLP_HEADERS = "Authorization=Bearer private-token";
	process.env.OTEL_EXPORTER_OTLP_PROTOCOL = "grpc";
	process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = "https://private-collector.example/v1/traces";
	process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS = "Authorization=Bearer private-trace-token";
		process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL = "grpc";
		process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = "https://private-collector.example/v1/logs";
		process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS = "Authorization=Bearer private-log-token";
		process.env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL = "grpc";
		process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = "https://private-collector.example/v1/metrics";
		process.env.OTEL_EXPORTER_OTLP_METRICS_HEADERS = "Authorization=Bearer private-metrics-token";
		process.env.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL = "grpc";
		process.env.OTEL_RESOURCE_ATTRIBUTES = "private.path=%2FUsers%2Fadvaitpaliwal%2Fsecret";
		process.env.OTEL_TRACES_EXPORTER = "otlp";
		process.env.OTEL_LOGS_EXPORTER = "otlp";
		process.env.OTEL_METRICS_EXPORTER = "otlp";
		process.env.OTEL_LOG_LEVEL = "all";
		process.env.PI_OTEL_DISABLED = "1";
		process.env.PI_OTEL_CAPTURE_CONTENT = "all";
		process.env.PI_OTEL_LOGS = "1";
		process.env.PI_OTEL_METRICS = "1";
		process.env.PI_OTEL_SERVICE_NAME = "private-pi-service";
		process.env.PI_OTEL_SERVICE_VERSION = "private-pi-version";
		process.env.OTEL_SERVICE_NAME = "private-service";
		process.env.OTEL_SERVICE_VERSION = "private-version";

	try {
		const env = buildPiEnv({
			appRoot: "/repo/feynman",
			workingDir: "/workspace",
			sessionDir: "/sessions",
			feynmanAgentDir: "/home/.feynman/agent",
			feynmanVersion: "0.3.4",
		});

		for (const key of [
			"FEYNMAN_POSTHOG_KEY",
			"FEYNMAN_POSTHOG_HOST",
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
				"OTEL_TRACES_EXPORTER",
				"OTEL_LOGS_EXPORTER",
				"OTEL_METRICS_EXPORTER",
				"OTEL_LOG_LEVEL",
				"PI_OTEL_CAPTURE_CONTENT",
				"PI_OTEL_LOGS",
				"PI_OTEL_METRICS",
				"PI_OTEL_SERVICE_NAME",
				"PI_OTEL_SERVICE_VERSION",
				"OTEL_SERVICE_NAME",
				"OTEL_SERVICE_VERSION",
			]) {
			assert.equal(env[key], undefined, key);
		}
		assert.equal(env.FEYNMAN_TELEMETRY, "off");
		assert.equal(env.PI_OTEL_DISABLED, "1");
	} finally {
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	}
});

test("ensureFeynmanCommandShim creates a repo-local feynman launcher", () => {
	const appRoot = mkdtempSync(join(tmpdir(), "feynman-shim-app-"));
	const homeRoot = mkdtempSync(join(tmpdir(), "feynman-shim-home-"));
	const feynmanAgentDir = join(homeRoot, "agent");
	const feynmanBinPath = join(appRoot, "bin", "feynman.js");

	mkdirSync(dirname(feynmanBinPath), { recursive: true });
	writeFileSync(
		feynmanBinPath,
		"console.log(JSON.stringify({ argv: process.argv.slice(2), bin: process.argv[1] }));\n",
		"utf8",
	);

	const shimPath = ensureFeynmanCommandShim(appRoot, feynmanAgentDir);
	const result = spawnSync(shimPath, ["alpha", "status"], {
		encoding: "utf8",
		env: {
			...process.env,
			FEYNMAN_NODE_EXECUTABLE: process.execPath,
		},
	});

	assert.equal(getFeynmanCommandShimDir(feynmanAgentDir), join(homeRoot, "bin"));
	assert.equal(shimPath, join(homeRoot, "bin", "feynman"));
	assert.equal(result.status, 0);
	assert.deepEqual(JSON.parse(result.stdout), { argv: ["alpha", "status"], bin: feynmanBinPath });
});

test("ensureFeynmanWorkspaceScaffold creates default artifact directories", () => {
	const workingDir = mkdtempSync(join(tmpdir(), "feynman-workspace-scaffold-"));

	assert.equal(ensureFeynmanWorkspaceScaffold(workingDir), true);

	for (const relPath of ["outputs/.plans", "outputs/.drafts", "papers", "notes"]) {
		assert.equal(existsSync(join(workingDir, relPath)), true, relPath);
	}
});

test("ensureFeynmanWorkspaceScaffold does not block read-only research sessions", () => {
	const workingDir = mkdtempSync(join(tmpdir(), "feynman-workspace-readonly-"));
	const permissionError = Object.assign(new Error("read-only filesystem"), { code: "EROFS" });

	assert.equal(ensureFeynmanWorkspaceScaffold(workingDir, () => {
		throw permissionError;
	}), false);
});

test("buildPiEnv uses pre-resolved executable paths when provided", () => {
	const env = buildPiEnv(
		{
			appRoot: "/repo/feynman",
			workingDir: "/workspace",
			sessionDir: "/sessions",
			feynmanAgentDir: "/home/.feynman/agent",
		},
		{
			pandoc: "/opt/test/bin/pandoc",
			mermaid: "/opt/test/bin/mmdc",
			browser: "/opt/test/bin/chrome",
		},
	);

	assert.equal(env.PANDOC_PATH, "/opt/test/bin/pandoc");
	assert.equal(env.MERMAID_CLI_PATH, "/opt/test/bin/mmdc");
	assert.equal(env.PUPPETEER_EXECUTABLE_PATH, "/opt/test/bin/chrome");
});

test("stock Pi and every bundled Pi package resolve from the installed dependency tree", () => {
	const cliPath = resolvePiCliPath(process.cwd());
	assert.ok(cliPath && existsSync(cliPath));
	assert.deepEqual(validatePiInstallation(process.cwd()), []);
	assert.deepEqual(getFeynmanPackageSources(process.cwd()), [
		process.cwd(),
		...BUNDLED_PI_PACKAGES.map((name) => join(process.cwd(), "node_modules", name)),
	]);
});

test("resolvePackageRoot follows Node lookup for hoisted installs", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-hoisted-"));
	const appRoot = join(root, "node_modules", "@companion-ai", "feynman");
	const hoisted = join(root, "node_modules", "pi-web-access");
	mkdirSync(appRoot, { recursive: true });
	mkdirSync(hoisted, { recursive: true });
	writeFileSync(join(appRoot, "package.json"), JSON.stringify({ name: "@companion-ai/feynman" }));
	writeFileSync(join(hoisted, "package.json"), JSON.stringify({ name: "pi-web-access" }));

	assert.equal(resolvePackageRoot(appRoot, "pi-web-access"), hoisted);
	assert.equal(resolvePackageRoot(appRoot, "pi-subagents"), undefined);
	assert.ok(validatePiInstallation(appRoot).includes("pi-subagents"));
});

test("resolveBundledAlphaCliPath resolves hoisted package installs before bundled fallbacks", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-alpha-cli-hoisted-"));
	const appRoot = join(root, "node_modules", "@companion-ai", "feynman");
	const hoistedAlpha = join(root, "node_modules", "@companion-ai", "alpha-hub", "bin", "alpha");

	mkdirSync(join(appRoot), { recursive: true });
	writeFileSync(join(appRoot, "package.json"), JSON.stringify({ name: "@companion-ai/feynman" }));
	mkdirSync(dirname(hoistedAlpha), { recursive: true });
	mkdirSync(join(root, "node_modules", "@companion-ai", "alpha-hub", "src"), { recursive: true });
	writeFileSync(
		join(root, "node_modules", "@companion-ai", "alpha-hub", "package.json"),
		JSON.stringify({ name: "@companion-ai/alpha-hub", type: "module", exports: { ".": "./src/index.js" } }),
	);
	writeFileSync(join(root, "node_modules", "@companion-ai", "alpha-hub", "src", "index.js"), "", "utf8");
	writeFileSync(hoistedAlpha, "", "utf8");

	assert.equal(resolveBundledAlphaCliPath(appRoot), realpathSync(hoistedAlpha));
});

test("resolveBundledAlphaCliPath prefers package-local alpha", () => {
	const appRoot = mkdtempSync(join(tmpdir(), "feynman-alpha-cli-"));
	const packageLocalAlpha = join(appRoot, "node_modules", "@companion-ai", "alpha-hub", "bin", "alpha");

	assert.throws(() => resolveBundledAlphaCliPath(appRoot), /Bundled alphaXiv CLI not found/);
	mkdirSync(join(appRoot, "node_modules", "@companion-ai", "alpha-hub", "bin"), { recursive: true });
	writeFileSync(packageLocalAlpha, "", "utf8");
	assert.equal(resolveBundledAlphaCliPath(appRoot), packageLocalAlpha);
});
