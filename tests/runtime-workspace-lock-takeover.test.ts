import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	acquireRuntimeWorkspaceSetupLock,
	releaseRuntimeWorkspaceSetupLock,
} from "../scripts/lib/runtime-workspace-lock.mjs";

function withLockDir(run: (lockDir: string) => void) {
	const root = mkdtempSync(join(tmpdir(), "feynman-runtime-lock-takeover-"));
	try {
		run(join(root, ".workspace-setup.lock"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function writeOwner(lockDir: string, owner: Record<string, unknown>) {
	mkdirSync(lockDir);
	writeFileSync(join(lockDir, "owner.json"), `${JSON.stringify({
		version: 1,
		pid: process.pid,
		hostname: hostname(),
		processStartedAt: 1,
		...owner,
	})}\n`);
}

test("a live owner whose start time cannot be read keeps the lock until the PID-reuse ceiling", () => {
	withLockDir((lockDir) => {
		// This process is alive, but the stubbed `ps` lookup fails, as on slim images.
		writeOwner(lockDir, { token: "slow-owner", createdAt: Date.now() - 60_000, heartbeatAt: Date.now() - 60_000 });
		assert.throws(
			() => acquireRuntimeWorkspaceSetupLock(lockDir, { staleMs: 50, readOwnerProcessStartedAt: () => undefined }),
			/Timed out waiting/,
		);
		assert.equal(JSON.parse(readFileSync(join(lockDir, "owner.json"), "utf8")).token, "slow-owner");

		rmSync(lockDir, { recursive: true });
		// Past two package-install timeouts the heartbeat is treated as a reused PID.
		writeOwner(lockDir, { token: "ancient-owner", createdAt: 0, heartbeatAt: 0 });
		const token = acquireRuntimeWorkspaceSetupLock(lockDir, { staleMs: 50, readOwnerProcessStartedAt: () => undefined });
		assert.notEqual(token, "ancient-owner");
		releaseRuntimeWorkspaceSetupLock(lockDir, token);
		assert.equal(existsSync(lockDir), false);
	});
});

test("stale-lock takeover is serialized by a break mutex", () => {
	withLockDir((lockDir) => {
		const breakDir = `${lockDir}.break`;
		writeOwner(lockDir, { pid: 2_147_483_647, token: "dead-owner", createdAt: 0, heartbeatAt: 0 });
		mkdirSync(breakDir);
		// Another waiter holds the break mutex, so this one keeps waiting.
		assert.throws(() => acquireRuntimeWorkspaceSetupLock(lockDir, { staleMs: 50 }), /Timed out waiting/);
		assert.equal(JSON.parse(readFileSync(join(lockDir, "owner.json"), "utf8")).token, "dead-owner");

		// A break mutex abandoned for more than 30 seconds is cleared.
		const abandoned = new Date(Date.now() - 60_000);
		utimesSync(breakDir, abandoned, abandoned);
		const token = acquireRuntimeWorkspaceSetupLock(lockDir, { staleMs: 50 });
		assert.notEqual(token, "dead-owner");
		assert.equal(existsSync(breakDir), false);
		releaseRuntimeWorkspaceSetupLock(lockDir, token);
		assert.equal(existsSync(lockDir), false);
	});
});
