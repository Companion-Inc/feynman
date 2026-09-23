import { rmSync } from "node:fs";

const RETRYABLE_REMOVE_CODES = new Set(["EBUSY", "EMFILE", "ENFILE", "ENOTEMPTY", "EPERM"]);
const waitBuffer = new Int32Array(new SharedArrayBuffer(4));

function waitSynchronously(delayMs) {
	Atomics.wait(waitBuffer, 0, 0, delayMs);
}

function isRetryableRemoveError(error, retryableCodes) {
	return error instanceof Error
		&& "code" in error
		&& retryableCodes.has(error.code);
}

export function removeTemporaryTree(
	path,
	{
		remove = rmSync,
		wait = waitSynchronously,
		maxRetries = 10,
		retryDelayMs = 250,
		maxRetryDelayMs = 5_000,
		retryableCodes = RETRYABLE_REMOVE_CODES,
	} = {},
) {
	for (let attempt = 0; ; attempt += 1) {
		try {
			remove(path, { recursive: true, force: true });
			return;
		} catch (error) {
			if (!isRetryableRemoveError(error, retryableCodes) || attempt >= maxRetries) {
				throw error;
			}
			wait(Math.min(retryDelayMs * (2 ** attempt), maxRetryDelayMs));
		}
	}
}

export function runWithTemporaryTreeCleanup(path, verify, cleanupOptions) {
	let verificationError;
	try {
		verify();
	} catch (error) {
		verificationError = error;
	}

	try {
		removeTemporaryTree(path, cleanupOptions);
	} catch (cleanupError) {
		if (verificationError === undefined) {
			throw cleanupError;
		}
		if (verificationError instanceof Error && verificationError.cause === undefined) {
			verificationError.cause = cleanupError;
		}
	}

	if (verificationError !== undefined) {
		throw verificationError;
	}
}
