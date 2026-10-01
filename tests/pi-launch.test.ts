import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { exitCodeFromSignal } from "../src/pi/launch.js";
import { TELEMETRY_NOTICE } from "../src/telemetry/posthog.js";

test("exitCodeFromSignal maps POSIX signals to conventional shell exit codes", () => {
	assert.equal(exitCodeFromSignal("SIGTERM"), 143);
	assert.equal(exitCodeFromSignal("SIGSEGV"), 139);
});

for (const { mode, stdoutTTY, stderrTTY, telemetry, warning, oneShot } of [
	{ mode: "text", stdoutTTY: true, stderrTTY: true, telemetry: true, warning: "Local-model warning\nMissing Bash warning" },
	{ mode: "text", stdoutTTY: true, stderrTTY: true, telemetry: false, warning: "Local-model warning" },
	{ mode: "text", stdoutTTY: true, stderrTTY: true, telemetry: true, warning: undefined },
	{ mode: "text", stdoutTTY: true, stderrTTY: false, telemetry: true, warning: undefined },
	{ mode: "text", stdoutTTY: false, stderrTTY: true, telemetry: true, warning: undefined },
	{ mode: "rpc", stdoutTTY: true, stderrTTY: true, telemetry: true, warning: undefined },
	{ mode: "json", stdoutTTY: false, stderrTTY: false, telemetry: true, warning: undefined },
	// A one-shot --prompt run never starts the TUI, so it prints the notices as before.
	{ mode: "text", stdoutTTY: true, stderrTTY: true, telemetry: true, warning: "Local-model warning", oneShot: "hi" },
] as { mode: string; stdoutTTY: boolean; stderrTTY: boolean; telemetry: boolean; warning?: string; oneShot?: string }[]) {
	test(`launch hands notices to the TUI and prints them otherwise: ${JSON.stringify({ mode, stdoutTTY, stderrTTY, telemetry, warning, oneShot })}`, () => {
		const home = mkdtempSync(join(tmpdir(), "feynman-launch-notice-"));
		try {
			const piRoot = join(home, "node_modules", "@earendil-works", "pi-coding-agent");
			mkdirSync(piRoot, { recursive: true });
			writeFileSync(join(home, "package.json"), "{}");
			writeFileSync(join(piRoot, "package.json"), JSON.stringify({ bin: { pi: "cli.cjs" } }));
			writeFileSync(join(piRoot, "cli.cjs"), 'console.log(JSON.stringify({ notice: process.env.FEYNMAN_LAUNCH_NOTICE ?? null }));');
			const options = {
				appRoot: home, workingDir: home, feynmanAgentDir: join(home, ".feynman", "agent"),
				sessionDir: join(home, "sessions"), mode, preLaunchNotice: warning, oneShotPrompt: oneShot,
			};
			const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
				import { launchPiChat } from ${JSON.stringify(new URL("../src/pi/launch.ts", import.meta.url).href)};
				import { initializePostHogTelemetry, shutdownPostHogTelemetry } from ${JSON.stringify(new URL("../src/telemetry/posthog.ts", import.meta.url).href)};
				Object.defineProperty(process.stdout, "isTTY", { value: ${stdoutTTY} });
				Object.defineProperty(process.stderr, "isTTY", { value: ${stderrTTY} });
				initializePostHogTelemetry({ posthogFetch: async () => new Response(null, { status: 204 }) });
				try { await launchPiChat(${JSON.stringify(options)}); }
				finally { await shutdownPostHogTelemetry(); }
			`], {
				encoding: "utf8", timeout: 30_000,
				env: {
					...process.env, HOME: home, USERPROFILE: home, FEYNMAN_HOME: home,
					FEYNMAN_TELEMETRY: telemetry ? "on" : "off", DO_NOT_TRACK: "0",
					FEYNMAN_LAUNCH_NOTICE: "stale inherited notice",
				},
			});
			assert.equal(result.error, undefined);
			assert.equal(result.status, 0, result.stderr);
			const disclosure = telemetry && stdoutTTY && stderrTTY && mode !== "rpc" ? TELEMETRY_NOTICE : undefined;
			const notice = [disclosure, warning].filter(Boolean).join("\n") || null;
			const clear = stdoutTTY && mode !== "rpc" ? "\x1b[2J\x1b[3J\x1b[H" : "";
			assert.equal(result.stderr, oneShot && notice ? `${notice}\n` : "");
			assert.equal(result.stdout, `${clear}${JSON.stringify({ notice: oneShot ? null : notice })}\n`);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
}
