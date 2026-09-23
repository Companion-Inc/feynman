export interface TemporaryTreeCleanupOptions {
	remove?: (
		path: string,
		options: { recursive: true; force: true },
	) => void;
	wait?: (delayMs: number) => void;
	maxRetries?: number;
	retryDelayMs?: number;
	maxRetryDelayMs?: number;
	retryableCodes?: ReadonlySet<string>;
}

export declare function removeTemporaryTree(
	path: string,
	options?: TemporaryTreeCleanupOptions,
): void;

export declare function runWithTemporaryTreeCleanup(
	path: string,
	verify: () => void,
	cleanupOptions?: TemporaryTreeCleanupOptions,
): void;
