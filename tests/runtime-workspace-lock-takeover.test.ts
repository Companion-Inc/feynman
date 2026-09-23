import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	renameSync,
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
			() => acquireRuntimeWorkspaceSetupLock(lockDir, { staleMs: 50, waitTimeoutMs: 50, readOwnerProcessStartedAt: () => undefined }),
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
		assert.throws(() => acquireRuntimeWorkspaceSetupLock(lockDir, { staleMs: 50, waitTimeoutMs: 50 }), /Timed out waiting/);
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

test("a provably dead or replaced owner loses the lock without waiting for staleness", () => {
	withLockDir((lockDir) => {
		const fresh = Date.now();
		// No process has this PID, so the fresh heartbeat does not matter.
		writeOwner(lockDir, { pid: 2_147_483_647, token: "crashed-owner", createdAt: fresh, heartbeatAt: fresh });
		const startedAt = Date.now();
		const token = acquireRuntimeWorkspaceSetupLock(lockDir, { waitTimeoutMs: 0 });
		assert.notEqual(token, "crashed-owner");
		assert.ok(Date.now() - startedAt < 5_000);
		releaseRuntimeWorkspaceSetupLock(lockDir, token);

		// This PID is alive but started at a different time: it was reused.
		writeOwner(lockDir, { token: "reused-owner", createdAt: fresh, heartbeatAt: fresh, processStartedAt: 1 });
		const replacement = acquireRuntimeWorkspaceSetupLock(lockDir, { waitTimeoutMs: 0 });
		assert.notEqual(replacement, "reused-owner");
		releaseRuntimeWorkspaceSetupLock(lockDir, replacement);
		assert.equal(existsSync(lockDir), false);
	});
});

test("waiting for a live owner outlasts a package install instead of the stale window", () => {
	withLockDir((lockDir) => {
		const token = acquireRuntimeWorkspaceSetupLock(lockDir, { staleMs: 25 });
		const startedAt = Date.now();
		// The live owner is past staleMs, yet the waiter keeps waiting until its own deadline.
		assert.throws(() => acquireRuntimeWorkspaceSetupLock(lockDir, { staleMs: 25, waitTimeoutMs: 300 }), /Timed out waiting/);
		assert.ok(Date.now() - startedAt >= 300);
		releaseRuntimeWorkspaceSetupLock(lockDir, token);
		assert.equal(existsSync(lockDir), false);
	});
});

function failingRename(code: string, failures: number) {
	let calls = 0;
	return {
		get calls() {
			return calls;
		},
		rename(from: string, to: string) {
			calls += 1;
			if (calls <= failures) {
				throw Object.assign(new Error(`${code}: locked`), { code });
			}
			renameSync(from, to);
		},
	};
}

test("lock release retries transient Windows rename failures", () => {
	withLockDir((lockDir) => {
		const token = acquireRuntimeWorkspaceSetupLock(lockDir);
		const flaky = failingRename("EPERM", 2);
		releaseRuntimeWorkspaceSetupLock(lockDir, token, { rename: flaky.rename, wait: () => {} });
		assert.equal(flaky.calls, 3);
		assert.equal(existsSync(lockDir), false);
	});
});

test("a lock that cannot be renamed away drops its owner record so waiters fall back to mtime", () => {
	withLockDir((lockDir) => {
		const token = acquireRuntimeWorkspaceSetupLock(lockDir);
		const stuck = failingRename("EBUSY", Number.POSITIVE_INFINITY);
		releaseRuntimeWorkspaceSetupLock(lockDir, token, { rename: stuck.rename, wait: () => {} });
		assert.equal(stuck.calls, 6);
		assert.equal(existsSync(lockDir), true);
		assert.equal(existsSync(join(lockDir, "owner.json")), false);
		// The token is forgotten, so a later release cannot act on a lock it no longer owns.
		releaseRuntimeWorkspaceSetupLock(lockDir, token);
		assert.equal(existsSync(lockDir), true);
	});
});

test("a lock directory that could not be claimed is removed instead of blocking others", () => {
	withLockDir((lockDir) => {
		assert.throws(
			() => acquireRuntimeWorkspaceSetupLock(lockDir, { writeOwner: () => false }),
			/changed while it was acquired/,
		);
		assert.equal(existsSync(lockDir), false);
		assert.throws(
			() => acquireRuntimeWorkspaceSetupLock(lockDir, {
				writeOwner: () => {
					throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
				},
			}),
			/ENOSPC/,
		);
		assert.equal(existsSync(lockDir), false);
		const token = acquireRuntimeWorkspaceSetupLock(lockDir, { waitTimeoutMs: 0 });
		releaseRuntimeWorkspaceSetupLock(lockDir, token);
	});
});
