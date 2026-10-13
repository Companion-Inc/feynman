import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

for (const [quietStartup, label] of [["header", "header only"], [true, "enabled"], [false, "disabled"]] as const) {
	test(`doctor reports quietStartup ${quietStartup} as ${label}`, () => {
		const home = mkdtempSync(join(tmpdir(), "feynman-doctor-"));
		try {
			const settingsPath = join(home, "settings.json");
			writeFileSync(settingsPath, JSON.stringify({ quietStartup }));
			const options = {
				settingsPath, authPath: join(home, "auth.json"), sessionDir: join(home, "sessions"),
				workingDir: home, appRoot: process.cwd(),
			};
			const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
				import { runDoctor } from ${JSON.stringify(new URL("../src/setup/doctor.ts", import.meta.url).href)};
				await runDoctor(${JSON.stringify(options)});
			`], {
				encoding: "utf8", timeout: 30_000,
				env: { ...process.env, HOME: home, USERPROFILE: home, FEYNMAN_HOME: home, FEYNMAN_TELEMETRY: "off", PI_OFFLINE: "1" },
			});
			assert.equal(result.error, undefined);
			assert.equal(result.status, 0, result.stderr);
			assert.ok(result.stdout.split("\n").includes(`quiet startup: ${label}`), result.stdout);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
}

test("doctor warns only about custom providers Pi has no credential for", () => {
	const home = mkdtempSync(join(tmpdir(), "feynman-doctor-"));
	try {
		const authPath = join(home, "auth.json");
		// A key stored through Pi (`feynman model login`) counts, as does models.json `apiKey`.
		writeFileSync(authPath, JSON.stringify({ "stored-key": { type: "api_key", key: "sk-stored" } }));
		writeFileSync(join(home, "models.json"), JSON.stringify({
			providers: {
				"stored-key": { baseUrl: "http://localhost:8000/v1", api: "openai-completions", models: [{ id: "a" }] },
				"inline-key": { baseUrl: "http://localhost:8001/v1", api: "openai-completions", apiKey: "local", models: [{ id: "b" }] },
				"no-key": { baseUrl: "http://localhost:8002/v1", api: "openai-completions", models: [{ id: "c" }] },
			},
		}));
		const options = {
			settingsPath: join(home, "settings.json"), authPath, sessionDir: join(home, "sessions"),
			workingDir: home, appRoot: process.cwd(),
		};
		const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
			import { runDoctor } from ${JSON.stringify(new URL("../src/setup/doctor.ts", import.meta.url).href)};
			await runDoctor(${JSON.stringify(options)});
		`], {
			encoding: "utf8", timeout: 30_000,
			env: { ...process.env, HOME: home, USERPROFILE: home, FEYNMAN_HOME: home, FEYNMAN_TELEMETRY: "off", PI_OFFLINE: "1" },
		});
		assert.equal(result.status, 0, result.stderr);
		assert.ok(result.stdout.split("\n").includes("  warning: provider(s) missing apiKey: no-key"), result.stdout);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});
