import assert from "node:assert/strict";
import test from "node:test";

import { resolveBrowser } from "../src/system/executables.js";

test("resolveBrowser finds a browser installed under a name other than google-chrome", () => {
	const resolved = resolveBrowser({
		fallbackPaths: ["/usr/bin/google-chrome"],
		fileExists: () => false,
		resolveCommand: (name) => (name === "chromium" ? "/usr/bin/chromium" : undefined),
	});
	assert.equal(resolved, "/usr/bin/chromium");
});
