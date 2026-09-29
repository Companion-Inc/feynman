// Runs requests one after another, each starting at least `minGapMs` after the
// previous one started. Pi runs parallel tool calls in one process, so this keeps
// them under a service's per-second limit.
export function createRequestPacer(): <T>(minGapMs: number, run: () => Promise<T>) => Promise<T> {
	let queue: Promise<unknown> = Promise.resolve();
	let lastStartedAt = Number.NEGATIVE_INFINITY;
	return <T>(minGapMs: number, run: () => Promise<T>): Promise<T> => {
		const next = queue.then(async () => {
			const wait = lastStartedAt + minGapMs - Date.now();
			if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
			lastStartedAt = Date.now();
			return run();
		});
		queue = next.catch(() => {});
		return next;
	};
}
