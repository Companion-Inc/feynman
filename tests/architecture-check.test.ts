import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("architecture guard passes while naming current split debt", () => {
	const output = execFileSync(process.execPath, ["./scripts/check-architecture.mjs"], {
		encoding: "utf8",
	});

	assert.match(output, /checked \d+ source files/);
	assert.match(output, /src\/cli\.ts: \d+ lines/);
	assert.match(output, /src\/model\/commands\.ts: \d+ lines/);
});

test("the CLI uses Pi's ModelRuntime, not the ModelRegistry facade Pi keeps for extensions", () => {
	const users = readdirSync("src", { recursive: true, encoding: "utf8" })
		.filter((path) => path.endsWith(".ts"))
		.filter((path) => /\bModelRegistry\b/.test(readFileSync(join("src", path), "utf8")));
	assert.deepEqual(users, []);
});
