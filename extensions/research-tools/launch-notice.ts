import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function registerLaunchNotice(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		const notice = process.env.FEYNMAN_LAUNCH_NOTICE;
		delete process.env.FEYNMAN_LAUNCH_NOTICE;
		if (notice && ctx.mode === "tui" && ctx.hasUI) {
			// Pi labels warnings itself.
			ctx.ui.notify(notice.replace(/^Warning: /gm, ""), "warning");
		}
	});
}
