import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	formatPiWebAccessDoctorLines,
	getPiWebAccessStatus,
	getPiWebSearchConfigPath,
	loadPiWebAccessConfig,
	savePiWebAccessConfig,
} from "../src/pi/web-access.js";

test("loadPiWebAccessConfig returns empty config when Pi web config is missing", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-pi-web-"));
	const configPath = getPiWebSearchConfigPath(root);

	assert.deepEqual(loadPiWebAccessConfig(configPath), {});
});

test("getPiWebSearchConfigPath uses the agent dir that pi-web-access reads", () => {
	assert.equal(getPiWebSearchConfigPath("/tmp/custom-home"), "/tmp/custom-home/.feynman/agent/web-search.json");
});

test("savePiWebAccessConfig merges updates and deletes undefined values", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-pi-web-"));
	const configPath = getPiWebSearchConfigPath(root);

	savePiWebAccessConfig({
		provider: "perplexity",
		searchProvider: "perplexity",
		perplexityApiKey: "pplx_...",
	}, configPath);
	savePiWebAccessConfig({
		provider: undefined,
		searchProvider: undefined,
		route: undefined,
	}, configPath);

	assert.deepEqual(loadPiWebAccessConfig(configPath), {
		perplexityApiKey: "pplx_...",
	});
});

test("savePiWebAccessConfig restricts web-search.json permissions", { skip: process.platform === "win32" }, () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-pi-web-"));
	const configPath = getPiWebSearchConfigPath(root);

	savePiWebAccessConfig({
		searchProvider: "exa",
		exaApiKey: "exa_secret",
	}, configPath);

	assert.equal(statSync(configPath).mode & 0o777, 0o600);
});

test("getPiWebAccessStatus reads Pi web-access config directly", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-pi-web-"));
	const configPath = getPiWebSearchConfigPath(root);
	mkdirSync(join(root, ".feynman", "agent"), { recursive: true });
	writeFileSync(
		configPath,
		JSON.stringify({
			provider: "exa",
			searchProvider: "exa",
			exaApiKey: "exa_...",
			browserCookies: { profile: "Profile 2" },
			geminiApiKey: "AIza...",
		}),
		"utf8",
	);

	const status = getPiWebAccessStatus(loadPiWebAccessConfig(configPath), configPath);
	assert.equal(status.routeLabel, "Exa");
	assert.equal(status.requestProvider, "exa");
	assert.equal(status.workflow, "none");
	assert.equal(status.exaConfigured, true);
	assert.equal(status.geminiApiConfigured, true);
	assert.equal(status.perplexityConfigured, false);
	assert.equal(status.chromeProfile, "Profile 2");
	assert.equal(status.geminiBrowserEnabled, false);
});

test("getPiWebAccessStatus reads Gemini routes directly", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-pi-web-"));
	const configPath = getPiWebSearchConfigPath(root);
	mkdirSync(join(root, ".feynman", "agent"), { recursive: true });
	writeFileSync(
		configPath,
		JSON.stringify({
			provider: "gemini",
			searchProvider: "gemini",
			browserCookies: { profile: "Profile 2" },
			allowBrowserCookies: true,
			geminiApiKey: "AIza...",
		}),
		"utf8",
	);

	const status = getPiWebAccessStatus(loadPiWebAccessConfig(configPath), configPath);
	assert.equal(status.routeLabel, "Gemini");
	assert.equal(status.requestProvider, "gemini");
	assert.equal(status.workflow, "none");
	assert.equal(status.exaConfigured, false);
	assert.equal(status.geminiApiConfigured, true);
	assert.equal(status.perplexityConfigured, false);
	assert.equal(status.chromeProfile, "Profile 2");
	assert.equal(status.geminiBrowserEnabled, true);
});

test("getPiWebAccessStatus supports the legacy route key", () => {
	const status = getPiWebAccessStatus({
		route: "perplexity",
		perplexityApiKey: "pplx_...",
	});

	assert.equal(status.routeLabel, "Perplexity");
	assert.equal(status.requestProvider, "perplexity");
	assert.equal(status.workflow, "none");
	assert.equal(status.perplexityConfigured, true);
	assert.equal(status.geminiBrowserEnabled, false);
});

test("formatPiWebAccessDoctorLines reports Pi-managed web access", () => {
	const lines = formatPiWebAccessDoctorLines(
		getPiWebAccessStatus({
			provider: "auto",
			searchProvider: "auto",
		}, "/tmp/pi-web-search.json"),
	);

	assert.equal(lines[0], "web access: pi-web-access");
	assert.ok(lines.some((line) => line.includes("search workflow: none")));
	assert.ok(lines.some((line) => line.includes("gemini browser fallback: disabled")));
	assert.ok(lines.some((line) => line.includes("/tmp/pi-web-search.json")));
});

test("getPiWebAccessStatus flags configExists: false when web-search.json is missing", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-pi-web-"));
	const configPath = getPiWebSearchConfigPath(root);

	const status = getPiWebAccessStatus(loadPiWebAccessConfig(configPath), configPath);
	assert.equal(status.configExists, false);
});

test("getPiWebAccessStatus flags configExists: true after web-search.json is written", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-pi-web-"));
	const configPath = getPiWebSearchConfigPath(root);
	savePiWebAccessConfig({ provider: "auto", searchProvider: "auto" }, configPath);

	const status = getPiWebAccessStatus(loadPiWebAccessConfig(configPath), configPath);
	assert.equal(status.configExists, true);
});

test("formatPiWebAccessDoctorLines marks missing config path and includes a setup hint", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-pi-web-"));
	const configPath = getPiWebSearchConfigPath(root);

	const lines = formatPiWebAccessDoctorLines(
		getPiWebAccessStatus(loadPiWebAccessConfig(configPath), configPath),
	);

	const configLine = lines.find((line) => line.includes("config path:"));
	assert.ok(configLine, "expected a config path line");
	assert.ok(configLine!.includes("(not created yet)"), `expected '(not created yet)' marker, got: ${configLine}`);
	assert.ok(
		lines.some((line) => line.includes("hint:") && line.includes("feynman search set")),
		"expected a hint line pointing to `feynman search set`",
	);
});

test("formatPiWebAccessDoctorLines omits marker and hint when config exists", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-pi-web-"));
	const configPath = getPiWebSearchConfigPath(root);
	savePiWebAccessConfig({ provider: "auto", searchProvider: "auto" }, configPath);

	const lines = formatPiWebAccessDoctorLines(
		getPiWebAccessStatus(loadPiWebAccessConfig(configPath), configPath),
	);

	const configLine = lines.find((line) => line.includes("config path:"));
	assert.ok(configLine, "expected a config path line");
	assert.ok(!configLine!.includes("(not created yet)"), `did not expect '(not created yet)' marker: ${configLine}`);
	assert.ok(!lines.some((line) => line.includes("hint:")), "did not expect a hint line when config exists");
});

test("feynman search set accepts every search provider pi-web-access has", async () => {
	const { readFileSync } = await import("node:fs");
	const { PI_WEB_SEARCH_PROVIDERS, searchProviderKeyField } = await import("../src/pi/web-access.js");
	const source = readFileSync("node_modules/pi-web-access/gemini-search.ts", "utf8");
	const resolved = JSON.parse(`[${/RESOLVED_SEARCH_PROVIDERS = \[([^\]]+)\]/.exec(source)![1]}]`) as string[];
	assert.deepEqual([...PI_WEB_SEARCH_PROVIDERS].sort(), ["all", "auto", ...resolved].sort());
	// Every key field Feynman writes is one pi-web-access reads.
	const packageSource = (await import("node:fs")).readdirSync("node_modules/pi-web-access")
		.filter((name) => name.endsWith(".ts"))
		.map((name) => readFileSync(`node_modules/pi-web-access/${name}`, "utf8"))
		.join("\n");
	for (const provider of PI_WEB_SEARCH_PROVIDERS) {
		const field = searchProviderKeyField(provider);
		if (field) assert.ok(packageSource.includes(field), `${provider} -> ${field}`);
	}
	// 9router is available once its base URL is set; its key is optional.
	assert.equal(searchProviderKeyField("ninerouter"), "ninerouterBaseUrl");
});

test("search status names any configured provider and lists every saved key", () => {
	const status = getPiWebAccessStatus({ provider: "brave", searchProvider: "brave", braveApiKey: "b", tavilyApiKey: "t" }, "/tmp/w.json");
	assert.equal(status.routeLabel, "brave");
	assert.deepEqual(status.configuredKeys, ["brave", "tavily"]);
	assert.doesNotMatch(formatPiWebAccessDoctorLines(status).join("\n"), /try Exa, then Perplexity/);
});
