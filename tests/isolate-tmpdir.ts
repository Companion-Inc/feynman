// Give each test process its own temp root and remove it on exit, so homes
// created with mkdtempSync(tmpdir()) do not pile up in the system temp dir.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "feynman-test-"));
process.env.TMPDIR = process.env.TEMP = process.env.TMP = root;
// CLI runs spawned by tests must not report usage telemetry.
process.env.FEYNMAN_TELEMETRY = "off";
process.on("exit", () => {
	try {
		rmSync(root, { recursive: true, force: true });
	} catch {}
});
