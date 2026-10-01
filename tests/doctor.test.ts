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
