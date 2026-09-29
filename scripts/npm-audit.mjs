// `npm audit --omit=dev` that fails on every advisory except the ones below.
// Each exception names why it cannot be fixed here and what removes it.
// Usage: node scripts/npm-audit.mjs [--prefix <dir>]
import { spawnSync } from "node:child_process";

const ALLOWED_ADVISORIES = {
	// pi-subagents pins undici 8.10.0 exactly, and npm ignores Feynman's
	// `overrides` when Feynman is installed as a dependency. pi-subagents only
	// uses undici's HTTP proxy agent, not the WebSocket client this advisory is
	// about. Remove once nicobailon/pi-subagents#2548 is released.
	"GHSA-3wwx-pv8p-q78v": "undici 8.10.0 pinned by pi-subagents",
};

const result = spawnSync("npm", ["audit", "--omit=dev", "--json", ...process.argv.slice(2)], {
	encoding: "utf8",
	shell: process.platform === "win32",
	stdio: ["ignore", "pipe", "inherit"],
});
let report;
try {
	report = JSON.parse(result.stdout);
} catch {
	console.error(`npm audit did not return JSON (exit ${result.status}).`);
	process.exit(1);
}

const blocking = [];
const allowed = new Set();
for (const [name, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
	// Entries whose `via` is only package names inherit an advisory listed on another entry.
	for (const via of vulnerability.via.filter((entry) => typeof entry === "object")) {
		const id = String(via.url ?? "").split("/").pop();
		if (ALLOWED_ADVISORIES[id]) allowed.add(`${id} (${ALLOWED_ADVISORIES[id]})`);
		else blocking.push(`${name}: ${via.title} ${via.url} [${via.severity}]`);
	}
}

for (const entry of allowed) console.log(`allowed: ${entry}`);
if (blocking.length > 0) {
	console.error(`npm audit found ${blocking.length} blocking advisories:\n${blocking.join("\n")}`);
	process.exit(1);
}
console.log("npm audit: no blocking advisories");
