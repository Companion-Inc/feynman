import assert from "node:assert/strict";
import test from "node:test";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { registerLaunchNotice } from "../extensions/research-tools/launch-notice.js";

for (const { mode, hasUI, notice, shown } of [
	{ mode: "tui", hasUI: true, notice: "Local-model warning\nMissing Bash warning" },
	{ mode: "rpc", hasUI: true, notice: "Hidden warning" },
	{ mode: "json", hasUI: false, notice: "Hidden warning" },
	{ mode: "print", hasUI: false, notice: "Hidden warning" },
	{ mode: "tui", hasUI: false, notice: "Hidden warning" },
	{ mode: "tui", hasUI: true, notice: undefined },
	{ mode: "tui", hasUI: true, notice: "Warning: local model\nWarning: no Bash", shown: "local model\nno Bash" },
] as { mode: string; hasUI: boolean; notice?: string; shown?: string }[]) {
	test(`launch notice: ${mode}, UI ${hasUI}, notice ${Boolean(notice)}`, async (t) => {
		const previous = process.env.FEYNMAN_LAUNCH_NOTICE;
		t.after(() => {
			if (previous === undefined) delete process.env.FEYNMAN_LAUNCH_NOTICE;
			else process.env.FEYNMAN_LAUNCH_NOTICE = previous;
		});
		if (notice === undefined) delete process.env.FEYNMAN_LAUNCH_NOTICE;
		else process.env.FEYNMAN_LAUNCH_NOTICE = notice;

		let handler: (event: unknown, ctx: ExtensionContext) => unknown;
		const pi = {
			on(event: string, callback: typeof handler) {
				assert.equal(event, "session_start");
				handler = callback;
			},
		} as unknown as ExtensionAPI;
		const notifications: unknown[][] = [];
		const ctx = {
			mode, hasUI,
			ui: { notify: (...args: unknown[]) => notifications.push(args) },
		} as unknown as ExtensionContext;
		const stdout = t.mock.method(process.stdout, "write", () => true);
		const stderr = t.mock.method(process.stderr, "write", () => true);
		registerLaunchNotice(pi);
		await handler!({}, ctx);
		assert.equal(process.env.FEYNMAN_LAUNCH_NOTICE, undefined);
		await handler!({}, ctx);
		registerLaunchNotice(pi);
		await handler!({}, ctx);
		assert.deepEqual(notifications, notice && mode === "tui" && hasUI ? [[shown ?? notice, "warning"]] : []);
		assert.equal(stdout.mock.callCount(), 0);
		assert.equal(stderr.mock.callCount(), 0);
	});
}
