import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { settings } from "@clack/prompts";

import "../src/setup/prompts.js";

function runWithoutModel(args: string[], authJson?: string) {
	const home = mkdtempSync(join(tmpdir(), "feynman-first-run-"));
	try {
		if (authJson !== undefined) {
			mkdirSync(join(home, ".feynman", "agent"), { recursive: true });
			writeFileSync(join(home, ".feynman", "agent", "auth.json"), authJson);
		}
		const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/_API_KEY$|_TOKEN$/.test(key)));
		const result = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts", ...args], {
			cwd: process.cwd(),
			encoding: "utf8",
			env: { ...env, FEYNMAN_HOME: home, HOME: home, FEYNMAN_TELEMETRY: "0" },
			input: "",
			maxBuffer: 1024 * 1024,
		});
		return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

test("typing a question into a setup menu does not move the selection", () => {
	for (const key of ["h", "j", "k", "l"]) assert.equal(settings.aliases.has(key), false, key);
});

test("a malformed auth.json names the file and how to recover", () => {
	for (const args of [["model", "list"], ["doctor"]]) {
		const { status, output } = runWithoutModel(args, '{\n  ,"openai": {}\n}\n');
		assert.equal(status, 1, args.join(" "));
		assert.match(output, /auth\.json is not valid JSON \(.*position/);
		assert.match(output, /feynman setup/);
		assert.doesNotMatch(output, /node_modules|at file:/);
	}
});

test("feynman mcp adds MCP servers to Feynman's own home, with flags Feynman's parser would reject", () => {
	const home = mkdtempSync(join(tmpdir(), "feynman-mcp-"));
	try {
		const env = { ...process.env, FEYNMAN_HOME: home, HOME: home, FEYNMAN_TELEMETRY: "0" };
		const run = (args: string[]) =>
			spawnSync(process.execPath, ["--import", "tsx", "src/index.ts", ...args], { cwd: process.cwd(), encoding: "utf8", env, input: "", maxBuffer: 1024 * 1024 });
		const added = run(["mcp", "add", "library", "--env", "ZOTERO_LOCAL=true", "--", "zotero-mcp"]);
		assert.equal(added.status, 0, `${added.stdout}${added.stderr}`);
		assert.doesNotMatch(`${added.stdout}${added.stderr}`, /Unknown option|No model is set up/);
		const configPath = join(home, ".feynman", "agent", "mcp.json");
		assert.ok(existsSync(configPath), "mcp.json lives in Feynman's agent directory");
		const config = JSON.parse(readFileSync(configPath, "utf8")) as { mcpServers: Record<string, { command: string; env: Record<string, string> }> };
		assert.equal(config.mcpServers.library?.command, "zotero-mcp");
		assert.equal(config.mcpServers.library?.env.ZOTERO_LOCAL, "true");
		assert.equal(existsSync(join(home, ".pi")), false, "nothing is written to Pi's own home");
		const removed = run(["mcp", "remove", "library"]);
		assert.equal(removed.status, 0, `${removed.stdout}${removed.stderr}`);
		const after = JSON.parse(readFileSync(configPath, "utf8")) as { mcpServers?: Record<string, unknown> };
		assert.equal(Object.keys(after.mcpServers ?? {}).length, 0);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

test("a prompt with no model configured says how to add one and that it was not sent", () => {
	const { status, output } = runWithoutModel(["-p", "what is attention"]);
	assert.equal(status, 1);
	assert.match(output, /No model is set up yet/);
	assert.match(output, /feynman model login/);
	assert.match(output, /ANTHROPIC_API_KEY/);
	assert.match(output, /Your question was not sent\./);
	assert.doesNotMatch(output, /Use \/login|node_modules/);
});

test("help lists options without a duplicate getting-started block or a legacy label", () => {
	const { output } = runWithoutModel(["--help"]);
	assert.match(output, /◆ Options/);
	assert.doesNotMatch(output, /Legacy Flags|Getting Started/);
});

test("signed-out alpha commands name `feynman alpha login`", () => {
	const { status, output } = runWithoutModel(["alpha", "search", "transformers"]);
	assert.equal(status, 1);
	assert.match(output, /Run `feynman alpha login`/);
});

test("a no-model exit is reported to telemetry as a deliberate exit, not a crash", async () => {
	const { createServer } = await import("node:http");
	const { gunzipSync } = await import("node:zlib");
	const events: Array<{ event: string; properties: Record<string, unknown> }> = [];
	const server = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => {
			let body = Buffer.concat(chunks);
			if (req.headers["content-encoding"] === "gzip") body = gunzipSync(body);
			try {
				const parsed = JSON.parse(body.toString("utf8")) as { batch?: typeof events };
				events.push(...(parsed.batch ?? []));
			} catch {}
			res.writeHead(200, { "content-type": "application/json" }).end("{}");
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as { port: number }).port;
	const home = mkdtempSync(join(tmpdir(), "feynman-first-run-telemetry-"));
	try {
		const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/_API_KEY$|_TOKEN$/.test(key)));
		const { spawn } = await import("node:child_process");
		const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts", "-p", "hi"], {
			cwd: process.cwd(),
			env: { ...env, FEYNMAN_HOME: home, HOME: home, FEYNMAN_TELEMETRY: "1", FEYNMAN_POSTHOG_HOST: `http://127.0.0.1:${port}` },
			stdio: ["ignore", "ignore", "ignore"],
		});
		await new Promise((resolve) => child.on("exit", resolve));
		const failed = events.find((entry) => entry.event === "feynman_command_failed");
		assert.ok(failed, `events: ${events.map((entry) => entry.event).join(", ")}`);
		assert.equal(failed.properties.exit_reason, "no_model");
		assert.equal(failed.properties.pi_stderr, undefined);
	} finally {
		server.close();
		rmSync(home, { recursive: true, force: true });
	}
});

test("Feynman uses Pi's sessionDir setting when no --session-dir is given", async () => {
	const { writeFileSync, mkdirSync } = await import("node:fs");
	const home = mkdtempSync(join(tmpdir(), "feynman-session-dir-"));
	try {
		mkdirSync(join(home, ".feynman", "agent"), { recursive: true });
		writeFileSync(join(home, ".feynman", "agent", "settings.json"), JSON.stringify({ sessionDir: join(home, "my-sessions") }));
		const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/_API_KEY$|_TOKEN$|SESSION_DIR$/.test(key)));
		const result = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts", "status"], {
			cwd: process.cwd(), encoding: "utf8", env: { ...env, FEYNMAN_HOME: home, HOME: home, FEYNMAN_TELEMETRY: "0" }, input: "",
		});
		assert.match(result.stdout, new RegExp(`Sessions: ${join(home, "my-sessions").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});
