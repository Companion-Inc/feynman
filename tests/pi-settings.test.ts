import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
	listOptionalPackagePresets,
	normalizeOptionalPackagePresetName,
	resolvePackageSource,
} from "../src/pi/packages.js";
import { BUNDLED_PI_PACKAGES, getFeynmanPackageSources } from "../src/pi/runtime.js";
import { chooseRecommendedModel } from "../src/model/catalog.js";
import { ensureFeynmanSettings, normalizeThinkingLevel } from "../src/pi/settings.js";

const appRoot = process.cwd();
const bundledSettingsPath = resolve(appRoot, ".feynman", "settings.json");

test("normalizeThinkingLevel accepts the latest Pi thinking levels", () => {
	assert.equal(normalizeThinkingLevel("off"), "off");
	assert.equal(normalizeThinkingLevel("minimal"), "minimal");
	assert.equal(normalizeThinkingLevel("low"), "low");
	assert.equal(normalizeThinkingLevel("medium"), "medium");
	assert.equal(normalizeThinkingLevel("high"), "high");
	assert.equal(normalizeThinkingLevel("xhigh"), "xhigh");
	assert.equal(normalizeThinkingLevel("max"), "max");
});

test("normalizeThinkingLevel rejects unknown values", () => {
	assert.equal(normalizeThinkingLevel("turbo"), undefined);
	assert.equal(normalizeThinkingLevel(undefined), undefined);
});

test("first run writes the bundled defaults and loads Feynman plus its bundled Pi packages", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "feynman-settings-first-run-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const settingsPath = join(root, "settings.json");
	writeFileSync(join(root, "auth.json"), "{}\n");
	await ensureFeynmanSettings(settingsPath, bundledSettingsPath, appRoot, "high", join(root, "auth.json"));

	const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
	const bundled = JSON.parse(readFileSync(bundledSettingsPath, "utf8"));
	for (const [key, value] of Object.entries(bundled)) assert.deepEqual(settings[key], value);
	assert.equal(settings.defaultThinkingLevel, "high");
	assert.deepEqual(settings.packages, getFeynmanPackageSources(appRoot));
	assert.equal(settings.packages[0], appRoot);
	assert.equal(settings.packages.length, 1 + BUNDLED_PI_PACKAGES.length);
});

test("later runs only add missing keys and leave an unchanged file alone", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "feynman-settings-missing-keys-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const settingsPath = join(root, "settings.json");
	writeFileSync(join(root, "auth.json"), "{}\n");
	writeFileSync(settingsPath, JSON.stringify({ theme: "dark", quietStartup: false, retry: { enabled: false } }));
	await ensureFeynmanSettings(settingsPath, bundledSettingsPath, appRoot, "medium", join(root, "auth.json"));

	const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
	assert.equal(settings.theme, "dark");
	assert.equal(settings.quietStartup, false);
	assert.deepEqual(settings.retry, { enabled: false });
	assert.equal(settings.collapseChangelog, true);
	assert.equal(settings.defaultThinkingLevel, "medium");

	const before = readFileSync(settingsPath, "utf8");
	const modifiedAt = statSync(settingsPath).mtimeMs;
	await ensureFeynmanSettings(settingsPath, bundledSettingsPath, appRoot, "low", join(root, "auth.json"));
	assert.equal(readFileSync(settingsPath, "utf8"), before);
	assert.equal(statSync(settingsPath).mtimeMs, modifiedAt);
});

test("pinned core packages from older releases become the bundled packages; custom packages stay", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "feynman-settings-legacy-packages-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const settingsPath = join(root, "settings.json");
	const oldInstall = join(root, "old-install", "node_modules", "pi-subagents");
	mkdirSync(oldInstall, { recursive: true });
	writeFileSync(join(oldInstall, "package.json"), JSON.stringify({ name: "pi-subagents", version: "0.65.1" }));
	writeFileSync(join(root, "auth.json"), "{}\n");
	writeFileSync(settingsPath, JSON.stringify({
		packages: [
			"npm:@companion-ai/alpha-hub@0.1.6",
			"npm:pi-subagents@0.65.1",
			"npm:pi-btw@0.4.1",
			"npm:pi-docparser@4.0.0",
			{ source: "npm:pi-web-access@0.28.0", skills: [] },
			"npm:pi-otel@0.1.0",
			"npm:@samfp/pi-memory",
			oldInstall,
			{ source: "git:github.com/example/custom@v1", prompts: [] },
		],
	}));
	await ensureFeynmanSettings(settingsPath, bundledSettingsPath, appRoot, "medium", join(root, "auth.json"));

	assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")).packages, [
		...getFeynmanPackageSources(appRoot),
		"npm:@samfp/pi-memory",
		{ source: "git:github.com/example/custom@v1", prompts: [] },
	]);
});

test("user-level ~/.agents definitions cannot replace Feynman's agents unless the user opts in", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "feynman-settings-agent-dirs-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const settingsPath = join(root, "settings.json");
	writeFileSync(join(root, "auth.json"), "{}\n");
	await ensureFeynmanSettings(settingsPath, bundledSettingsPath, appRoot, "medium", join(root, "auth.json"));
	assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")).subagents, { agentExcludeDirs: ["~/.agents"] });

	writeFileSync(settingsPath, JSON.stringify({ subagents: { agentExcludeDirs: [], agentOverrides: { writer: { model: "x/y" } } } }));
	await ensureFeynmanSettings(settingsPath, bundledSettingsPath, appRoot, "medium", join(root, "auth.json"));
	assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")).subagents, { agentExcludeDirs: [], agentOverrides: { writer: { model: "x/y" } } });
});

test("the researcher child extension path managed by older releases is removed", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "feynman-settings-researcher-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const settingsPath = join(root, "settings.json");
	writeFileSync(join(root, "auth.json"), "{}\n");
	writeFileSync(settingsPath, JSON.stringify({
		subagents: { agentOverrides: {
			researcher: { subagentOnlyExtensions: ["custom.ts", "/old/extensions/research-tools.ts"], _feynmanResearchToolsExtension: "/old/extensions/research-tools.ts" },
			writer: { subagentOnlyExtensions: ["/old/extensions/research-tools.ts"] },
		} },
	}));
	await ensureFeynmanSettings(settingsPath, bundledSettingsPath, appRoot, "medium", join(root, "auth.json"));

	assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")).subagents.agentOverrides, {
		researcher: { subagentOnlyExtensions: ["custom.ts"] },
		writer: { subagentOnlyExtensions: ["/old/extensions/research-tools.ts"] },
	});
});

test("subagent defaults follow settingsPath, not HOME, authPath, or the Pi environment", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "feynman-subagent-defaults-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const agentDir = join(root, "custom", "agent");
	const decoyDir = join(root, "unrelated-agent");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(decoyDir);
	const settingsPath = join(agentDir, "settings.json");
	const authPath = join(decoyDir, "auth.json");
	writeFileSync(authPath, "{}\n");
	const keys = ["HOME", "PI_CODING_AGENT_DIR"] as const;
	const previous = keys.map((key) => process.env[key]);
	for (const key of keys) process.env[key] = decoyDir;
	try {
		await ensureFeynmanSettings(settingsPath, bundledSettingsPath, appRoot, "medium", authPath);
	} finally {
		keys.forEach((key, index) => {
			if (previous[index] === undefined) delete process.env[key];
			else process.env[key] = previous[index];
		});
	}
	const configPath = join(agentDir, "extensions", "subagent", "config.json");
	assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")), {
		missions: { enabled: false }, fleetView: false, asyncByDefault: true,
	});
	assert.equal(statSync(configPath).mode & 0o777, 0o600);
	assert.equal(existsSync(join(decoyDir, "extensions")), false);
	const before = readFileSync(configPath, "utf8");
	const modifiedAt = statSync(configPath).mtimeMs;
	await ensureFeynmanSettings(settingsPath, bundledSettingsPath, appRoot, "medium", authPath);
	assert.equal(readFileSync(configPath, "utf8"), before);
	assert.equal(statSync(configPath).mtimeMs, modifiedAt);
});

test("subagent defaults preserve explicit custom values and complete config bytes", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "feynman-subagent-custom-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const configPath = join(root, "extensions", "subagent", "config.json");
	mkdirSync(join(root, "extensions", "subagent"), { recursive: true });
	const original = '{"missions":{"enabled":true,"globalIndex":false},"fleetView":true,"asyncByDefault":false,"maxSubagentDepth":1}\n';
	writeFileSync(configPath, original, { mode: 0o640 });
	writeFileSync(join(root, "auth.json"), "{}\n");
	await ensureFeynmanSettings(join(root, "settings.json"), bundledSettingsPath, appRoot, "medium", join(root, "auth.json"));
	assert.equal(readFileSync(configPath, "utf8"), original);
	assert.equal(statSync(configPath).mode & 0o777, 0o640);
});

test("subagent defaults merge only missing fields while preserving nested config and false values", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "feynman-subagent-partial-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const configPath = join(root, "extensions", "subagent", "config.json");
	mkdirSync(join(root, "extensions", "subagent"), { recursive: true });
	writeFileSync(configPath, JSON.stringify({
		missions: { directory: join(root, "custom-missions"), retainTerminal: 12 },
		asyncByDefault: false, asyncWidget: true, custom: { nested: ["preserved"] },
	}));
	writeFileSync(join(root, "auth.json"), "{}\n");
	await ensureFeynmanSettings(join(root, "settings.json"), bundledSettingsPath, appRoot, "medium", join(root, "auth.json"));
	assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")), {
		missions: { directory: join(root, "custom-missions"), retainTerminal: 12, enabled: false },
		asyncByDefault: false, asyncWidget: true, custom: { nested: ["preserved"] }, fleetView: false,
	});
});

for (const invalid of [
	"{", "null", "[]", "false", '"string"',
	'{"missions":null}', '{"missions":[]}', '{"missions":false}',
	'{"missions":{"enabled":"false"}}', '{"missions":{"enabled":null}}',
	'{"fleetView":0}', '{"fleetView":null}', '{"asyncByDefault":"true"}', '{"asyncByDefault":null}',
]) {
	test(`subagent defaults reject invalid config without rewriting any settings: ${invalid}`, async (t) => {
		const root = mkdtempSync(join(tmpdir(), "feynman-subagent-invalid-"));
		t.after(() => rmSync(root, { recursive: true, force: true }));
		const configPath = join(root, "extensions", "subagent", "config.json");
		const settingsPath = join(root, "settings.json");
		mkdirSync(join(root, "extensions", "subagent"), { recursive: true });
		writeFileSync(configPath, invalid);
		const settings = '{"subagents":{"agentOverrides":{"researcher":{"subagentOnlyExtensions":["custom.ts"]}}}}\n';
		writeFileSync(settingsPath, settings);
		await assert.rejects(
			ensureFeynmanSettings(settingsPath, bundledSettingsPath, appRoot, "medium", join(root, "absent-auth.json")),
			/Invalid subagent config/,
		);
		assert.equal(readFileSync(configPath, "utf8"), invalid);
		assert.equal(readFileSync(settingsPath, "utf8"), settings);
		assert.equal(existsSync(join(root, "absent-auth.json")), false);
	});
}

test("invalid main settings fail closed before creating subagent defaults", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "feynman-settings-invalid-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const settingsPath = join(root, "settings.json");
	writeFileSync(settingsPath, "{");
	await assert.rejects(
		ensureFeynmanSettings(settingsPath, bundledSettingsPath, appRoot, "medium", join(root, "absent-auth.json")),
		/Invalid Feynman settings/,
	);
	assert.equal(readFileSync(settingsPath, "utf8"), "{");
	assert.equal(existsSync(join(root, "extensions")), false);
});

test("ensureFeynmanSettings seeds the newest OpenAI GPT default exposed by Pi", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-settings-"));
	const settingsPath = join(root, "settings.json");
	const authPath = join(root, "auth.json");

	writeFileSync(authPath, JSON.stringify({ openai: { type: "api_key", key: "openai-test-key" } }) + "\n", "utf8");
	const recommendation = await chooseRecommendedModel(authPath);

	await ensureFeynmanSettings(settingsPath, bundledSettingsPath, appRoot, "medium", authPath);

	const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
		defaultProvider?: string;
		defaultModel?: string;
	};
	assert.equal(`${settings.defaultProvider}/${settings.defaultModel}`, recommendation?.spec);
});

test("ensureFeynmanSettings seeds OpenCode Go Kimi as the preferred OpenCode Go default", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-settings-"));
	const settingsPath = join(root, "settings.json");
	const authPath = join(root, "auth.json");

	writeFileSync(authPath, JSON.stringify({ "opencode-go": { type: "api_key", key: "opencode-test-key" } }) + "\n", "utf8");

	await ensureFeynmanSettings(settingsPath, bundledSettingsPath, appRoot, "medium", authPath);

	const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
		defaultProvider?: string;
		defaultModel?: string;
	};
	assert.equal(settings.defaultProvider, "opencode-go");
	assert.equal(settings.defaultModel, "kimi-k2.6");
});

test("optional package presets map friendly names to Pi package sources", () => {
	assert.equal(resolvePackageSource("memory"), "npm:@samfp/pi-memory");
	assert.equal(resolvePackageSource("Hindsight"), "npm:@luxusai/pi-hindsight");
	assert.equal(resolvePackageSource("session-search"), "session-search");
	assert.equal(resolvePackageSource("npm:custom-package"), "npm:custom-package");
	assert.equal(normalizeOptionalPackagePresetName("all-extras"), undefined);
	assert.deepEqual(listOptionalPackagePresets().map((preset) => preset.name), ["memory", "hindsight"]);
});


test("ensureFeynmanSettings drops the retry backoff older Feynman versions seeded", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "feynman-settings-retry-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const settingsPath = join(root, "settings.json");
	const authPath = join(root, "auth.json");
	writeFileSync(authPath, "{}\n");
	writeFileSync(settingsPath, JSON.stringify({ retry: { maxRetries: 6, baseDelayMs: 5000 }, defaultProvider: "openai", defaultModel: "gpt-5.6-terra" }));
	await ensureFeynmanSettings(settingsPath, resolve(".feynman", "settings.json"), process.cwd(), "medium", authPath);
	assert.equal(JSON.parse(readFileSync(settingsPath, "utf8")).retry, undefined);

	writeFileSync(settingsPath, JSON.stringify({ retry: { maxRetries: 8 }, defaultProvider: "openai", defaultModel: "gpt-5.6-terra" }));
	await ensureFeynmanSettings(settingsPath, resolve(".feynman", "settings.json"), process.cwd(), "medium", authPath);
	assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")).retry, { maxRetries: 8 });
});
