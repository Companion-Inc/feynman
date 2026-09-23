import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("architecture guard passes while naming current split debt", () => {
	const output = execFileSync(process.execPath, ["./scripts/check-architecture.mjs"], {
		encoding: "utf8",
	});

	assert.match(output, /checked \d+ source files/);
	assert.match(output, /src\/cli\.ts: \d+ lines/);
	assert.match(output, /src\/model\/commands\.ts: \d+ lines/);
});
