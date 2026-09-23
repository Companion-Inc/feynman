import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
	ensureFeynmanHome,
	getBootstrapStatePath,
	getDefaultSessionDir,
	getFeynmanAgentDir,
	getFeynmanHome,
	getFeynmanMemoryDir,
	getFeynmanStateDir,
} from "../src/config/paths.js";

test("getFeynmanHome uses FEYNMAN_HOME env var when set", () => {
	const previous = process.env.FEYNMAN_HOME;
	try {
		process.env.FEYNMAN_HOME = "/custom/home";
		assert.equal(getFeynmanHome(), resolve("/custom/home", ".feynman"));
	} finally {
		if (previous === undefined) {
			delete process.env.FEYNMAN_HOME;
		} else {
			process.env.FEYNMAN_HOME = previous;
		}
	}
});

test("getFeynmanHome falls back to homedir when FEYNMAN_HOME is unset", () => {
	const previous = process.env.FEYNMAN_HOME;
	try {
		delete process.env.FEYNMAN_HOME;
		const home = getFeynmanHome();
		assert.ok(home.endsWith(".feynman"), `expected path ending in .feynman, got: ${home}`);
		assert.ok(!home.includes("undefined"), `expected no 'undefined' in path, got: ${home}`);
	} finally {
		if (previous === undefined) {
			delete process.env.FEYNMAN_HOME;
		} else {
			process.env.FEYNMAN_HOME = previous;
		}
	}
});

test("getFeynmanAgentDir resolves to <home>/agent", () => {
	assert.equal(getFeynmanAgentDir("/some/home"), resolve("/some/home", "agent"));
});

test("getFeynmanMemoryDir resolves to <home>/memory", () => {
	assert.equal(getFeynmanMemoryDir("/some/home"), resolve("/some/home", "memory"));
});

test("getFeynmanStateDir resolves to <home>/.state", () => {
	assert.equal(getFeynmanStateDir("/some/home"), resolve("/some/home", ".state"));
});

test("getDefaultSessionDir resolves to <home>/sessions", () => {
	assert.equal(getDefaultSessionDir("/some/home"), resolve("/some/home", "sessions"));
});

test("getBootstrapStatePath resolves to <home>/.state/bootstrap.json", () => {
	assert.equal(getBootstrapStatePath("/some/home"), resolve("/some/home", ".state", "bootstrap.json"));
});

test("ensureFeynmanHome creates all required subdirectories", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-paths-"));
	try {
		const home = join(root, "home");
		ensureFeynmanHome(home);

		assert.ok(existsSync(home), "home dir should exist");
		assert.ok(existsSync(join(home, "agent")), "agent dir should exist");
		assert.ok(existsSync(join(home, "memory")), "memory dir should exist");
		assert.ok(existsSync(join(home, ".state")), ".state dir should exist");
		assert.ok(existsSync(join(home, "sessions")), "sessions dir should exist");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("ensureFeynmanHome is idempotent when dirs already exist", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-paths-"));
	try {
		const home = join(root, "home");
		ensureFeynmanHome(home);
		assert.doesNotThrow(() => ensureFeynmanHome(home));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
