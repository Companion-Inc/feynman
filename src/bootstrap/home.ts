import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { resolve } from "node:path";

import { getBootstrapStatePath } from "../config/paths.js";

type LegacyBootstrapState = {
	files?: Record<string, { lastAppliedTargetHash?: string }>;
};

const LEGACY_SYNCED_SCOPES: Record<string, string> = { themes: "themes", agents: "agents", skills: "skills" };

// Feynman <= 0.4.0 copied its themes, agents, and skills into the agent dir on
// every launch. They now load from the Feynman Pi package, so remove the copies
// the user never edited; edited copies stay and keep overriding the package.
function removeLegacySyncedAssets(home: string, agentDir: string): void {
	const statePath = getBootstrapStatePath(home);
	if (!existsSync(statePath)) return;
	let state: LegacyBootstrapState = {};
	try {
		state = JSON.parse(readFileSync(statePath, "utf8")) as LegacyBootstrapState;
	} catch {
		// Unreadable state: leave every copy in place.
	}
	for (const [key, record] of Object.entries(state.files ?? {})) {
		const [scope, ...rest] = key.split(":");
		const targetDir = scope ? LEGACY_SYNCED_SCOPES[scope] : undefined;
		if (!targetDir || rest.length === 0 || !record.lastAppliedTargetHash) continue;
		const targetPath = resolve(agentDir, targetDir, rest.join(":"));
		if (!existsSync(targetPath)) continue;
		const hash = createHash("sha256").update(readFileSync(targetPath, "utf8")).digest("hex");
		if (hash === record.lastAppliedTargetHash) rmSync(targetPath, { force: true });
	}
	rmSync(statePath, { force: true });
}

export function ensureFeynmanAgentDir(appRoot: string, home: string, agentDir: string): void {
	removeLegacySyncedAssets(home, agentDir);
	// pi-web-access reads web-search.json from PI_CODING_AGENT_DIR.
	const legacyWebSearchPath = resolve(home, "web-search.json");
	const webSearchPath = resolve(agentDir, "web-search.json");
	if (existsSync(legacyWebSearchPath) && !existsSync(webSearchPath)) {
		renameSync(legacyWebSearchPath, webSearchPath);
	}
	const keybindingsPath = resolve(agentDir, "keybindings.json");
	if (!existsSync(keybindingsPath)) {
		copyFileSync(resolve(appRoot, ".feynman", "config", "keybindings.json"), keybindingsPath);
	}
}
