export declare const RUNTIME_WORKSPACE_RESTORE_MAX_CLEANUPS: 16;
export declare const RUNTIME_WORKSPACE_SETUP_LOCK_STALE_MS: 300000;
export declare function acquireRuntimeWorkspaceSetupLock(
	lockDir: string,
	options?: {
		staleMs?: number;
		readOwnerProcessStartedAt?: (pid: number) => number | undefined;
		waitTimeoutMs?: number;
		writeOwner?: (
			lockDir: string,
			owner: Record<string, unknown>,
			identity: { dev: string; ino: string },
		) => boolean;
	},
): string;
export declare function releaseRuntimeWorkspaceSetupLock(
	lockDir: string,
	token: string,
	options?: {
		rename?: (from: string, to: string) => void;
		wait?: (delayMs: number) => void;
	},
): void;
export declare function cleanupRuntimeWorkspaceSetupLockTombstones(
	lockDir: string,
	options?: {
		now?: number;
		staleMs?: number;
		maxCleanups?: number;
		maxCandidates?: number;
	},
): number;
export declare function heartbeatRuntimeWorkspaceSetupLock(
	lockDir: string,
	token: string,
): boolean;
