import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ensureFeynmanAgentDir } from "../src/bootstrap/home.js";

test("a keybindings copy that fails does not stop Feynman from starting", { skip: process.platform === "win32" }, (t) => {
	const home = mkdtempSync(join(tmpdir(), "feynman-home-"));
	const agentDir = join(home, "agent");
	mkdirSync(agentDir);
	t.after(() => {
		chmodSync(agentDir, 0o755);
		rmSync(home, { recursive: true, force: true });
	});
	// Windows reports EBUSY when another Feynman start holds the file; a
	// read-only agent dir makes the copy fail the same way here.
	chmodSync(agentDir, 0o555);
	assert.doesNotThrow(() => ensureFeynmanAgentDir(process.cwd(), home, agentDir));
	chmodSync(agentDir, 0o755);
	ensureFeynmanAgentDir(process.cwd(), home, agentDir);
	assert.ok(existsSync(join(agentDir, "keybindings.json")));
});
