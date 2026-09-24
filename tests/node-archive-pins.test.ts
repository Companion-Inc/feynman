import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { isSupportedNodeVersion } from "../src/system/node-version.js";

// Official https://nodejs.org/dist/v24.21.0/SHASUMS256.txt
// Retrieved 2026-09-24; index.json identifies v24.21.0 as latest LTS (Krypton).
const officialHashes = {
	"node-v24.21.0-darwin-arm64.tar.xz": "6239d4cf92d864487ec8cd3615038f7b67e7f58b77b21cd2f09ea9fbd68065fe",
	"node-v24.21.0-darwin-x64.tar.xz": "0ae5a24c24bb7d015cd816c5036b3f90f2945aa872fcf54e58da054753b3a299",
	"node-v24.21.0-linux-arm64.tar.xz": "6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2",
	"node-v24.21.0-linux-x64.tar.xz": "fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6",
	"node-v24.21.0-win-arm64.zip": "8779b1bde1d39f8d420e3b57aa657b39891af434d3de44a919044cec06785921",
	"node-v24.21.0-win-x64.zip": "158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541",
};
const root = resolve(import.meta.dirname, "..");

test("native Node release pins all six official LTS archives without importing the builder", () => {
	assert.equal(readFileSync(resolve(root, ".nvmrc"), "utf8").trim(), "24.21.0");
	const source = readFileSync(resolve(root, "scripts/build-native-bundle.mjs"), "utf8");
	const block = source.match(/const PINNED_NODE_ARCHIVE_SHA256 = \{([\s\S]*?)\n\};/)?.[1];
	assert.ok(block);
	const entries = [...block.matchAll(/"([^"]+)": "([0-9a-f]{64})"/g)];
	assert.equal(entries.length, 6);
	assert.deepEqual(Object.fromEntries(entries.map((match) => [match[1], match[2]])), officialHashes);
	assert.equal(isSupportedNodeVersion("24.21.0"), true);
	assert.equal(isSupportedNodeVersion("26.0.0"), true);
	const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
	assert.equal(manifest.engines.node, ">=22.22.0");
});

test("release workflow Node 24 lanes match the native release pin", () => {
	for (const file of [".github/workflows/e2e.yml", ".github/workflows/publish.yml"]) {
		const source = readFileSync(resolve(root, file), "utf8");
		assert.doesNotMatch(source, /24\.18\.0/);
		assert.match(source, /node: "24\.21\.0"/);
		assert.match(source, /node: "22\.22\.0"/);
		assert.match(source, /node: "26"/);
	}
});
