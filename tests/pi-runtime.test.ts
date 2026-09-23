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

test("buildPiEnv points Pi at Feynman's agent dir and command shim", () => {
	const env = buildPiEnv({
		appRoot: "/repo/feynman",
		workingDir: "/workspace",
		sessionDir: "/sessions",
		feynmanAgentDir: "/home/.feynman/agent",
		feynmanVersion: "0.1.5",
	});

	assert.equal(env.PI_CODING_AGENT_DIR, "/home/.feynman/agent");
	assert.equal(env.FEYNMAN_BIN_PATH, "/repo/feynman/bin/feynman.js");
	assert.equal(env.FEYNMAN_VERSION, "0.1.5");
	assert.ok(env.PATH?.startsWith("/home/.feynman/bin:/repo/feynman/node_modules/.bin:"));
	for (const key of ["FEYNMAN_CODING_AGENT_DIR", "FEYNMAN_PI_CLI_PATH", "FEYNMAN_NPM_PREFIX", "OTEL_NODE_RESOURCE_DETECTORS", "PI_OTEL_CAPTURE_CONTENT"]) {
		assert.equal(env[key], undefined, key);
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
	delete process.env.FEYNMAN_TELEMETRY;
	delete process.env.DO_NOT_TRACK;
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
