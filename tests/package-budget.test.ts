import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = process.cwd();
const verifier = resolve(root, "scripts", "verify-package-budget.mjs");

function runBudget(packMetadata: Record<string, unknown>) {
	const tempRoot = mkdtempSync(join(tmpdir(), "feynman-package-budget-"));
	const packOutput = join(tempRoot, "pack.json");
	writeFileSync(
		packOutput,
		`prepack lifecycle output\n${JSON.stringify([packMetadata])}\n`,
		"utf8",
	);
	return spawnSync(process.execPath, [verifier, packOutput], {
		encoding: "utf8",
	});
}

test("package release budget is documented and accepts the measured candidate shape", () => {
	const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
		feynmanReleaseBudget: {
			maxTarballBytes: number;
			maxUnpackedBytes: number;
			maxFileCount: number;
		};
	};
	assert.deepEqual(manifest.feynmanReleaseBudget, {
		maxTarballBytes: 2_097_152,
		maxUnpackedBytes: 8_388_608,
		maxFileCount: 1_000,
	});

	const result = runBudget({
		filename: "companion-ai-feynman-0.4.0.tgz",
		size: 187_124,
		unpackedSize: 696_241,
		entryCount: 103,
	});
	assert.equal(result.status, 0, result.stderr);
});

test("package release budget accepts npm pack totalFiles metadata from older npm releases", () => {
	const result = runBudget({
		filename: "companion-ai-feynman-0.4.0.tgz",
		size: 187_124,
		unpackedSize: 696_241,
		totalFiles: 103,
	});
	assert.equal(result.status, 0, result.stderr);
});

test("package release budget rejects compressed size and file-count regressions", () => {
	for (const packMetadata of [
		{
			filename: "companion-ai-feynman-0.4.0.tgz",
			size: 2_097_153,
			unpackedSize: 696_241,
			entryCount: 103,
		},
		{
			filename: "companion-ai-feynman-0.4.0.tgz",
			size: 187_124,
			unpackedSize: 696_241,
			entryCount: 1_001,
		},
	]) {
		const result = runBudget(packMetadata);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /feynman package budget/);
	}
});
