// `npm audit --omit=dev` that fails on every advisory except the ones below.
// Each exception names why it cannot be fixed here, what removes it, and the
// only install paths where it may appear.
// Usage: node scripts/npm-audit.mjs [--prefix <dir>]
import { spawnSync } from "node:child_process";

// pi-subagents pins undici 8.10.0 exactly, and npm ignores Feynman's `overrides`
// when Feynman is installed as a dependency, so npm installs keep that copy under
// pi-subagents (Feynman's own undici dependency keeps every other package on a
// patched one; the standalone installers apply the override). pi-subagents'
// background runner installs it as the process-wide fetch and WebSocket, so
// these apply to background subagent runs: denial of service from a malicious
// server, plus retry, cache, cookie, dump-interceptor, and BalancedPool issues
// in undici features the runner does not use. Remove once pi-subagents releases
// nicobailon/pi-subagents#2548 (undici 8.10.2).
const PI_SUBAGENTS_UNDICI = {
	reason: "undici 8.10.0 pinned by pi-subagents",
	nodes: /(^|\/)node_modules\/pi-subagents\/node_modules\/undici$/,
};
// Pi 0.99.1's npm-shrinkwrap locks brace-expansion 5.0.9, and npm keeps a
// dependency's shrinkwrap over Feynman's overrides. Pi expands brace patterns only
// through minimatch for package resource filters and model patterns, both from
// the user's own settings or flags. Remove once a Pi release ships 5.0.12.
const PI_BRACE_EXPANSION = {
	reason: "brace-expansion 5.0.9 locked by Pi's shrinkwrap",
	nodes: /(^|\/)node_modules\/@earendil-works\/pi-coding-agent\/node_modules\/brace-expansion$/,
};
const ALLOWED_ADVISORIES = Object.fromEntries([
	...["GHSA-q2hr-2g5m-vwhr", "GHSA-qhr7-859c-m2p7", "GHSA-6j4f-fj2g-mc7p"].map((id) => [id, PI_BRACE_EXPANSION]),
	...[
		"GHSA-3wwx-pv8p-q78v",
		"GHSA-pmjh-fq2x-6v4x",
		"GHSA-r53p-7pc4-xj5r",
		"GHSA-rfgv-xxqx-mfg5",
		"GHSA-3xpg-4rpp-hhhm",
		"GHSA-2jfj-6hjv-fm6j",
		"GHSA-2gqq-gqf2-x968",
		"GHSA-w293-vg96-wgc3",
		"GHSA-8436-99hf-9mmv",
		"GHSA-vp8m-p9jh-q5pm",
		"GHSA-rx4f-c7p8-82vq",
	].map((id) => [id, PI_SUBAGENTS_UNDICI]),
]);

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
	const nodes = vulnerability.nodes ?? [];
	// Entries whose `via` is only package names inherit an advisory listed on another entry.
	for (const via of vulnerability.via.filter((entry) => typeof entry === "object")) {
		const id = String(via.url ?? "").split("/").pop();
		const exception = ALLOWED_ADVISORIES[id];
		if (exception && nodes.length > 0 && nodes.every((node) => exception.nodes.test(node))) {
			allowed.add(`${id} (${exception.reason})`);
		} else {
			blocking.push(`${name}: ${via.title} ${via.url} [${via.severity}] at ${nodes.join(", ")}`);
		}
	}
}

for (const entry of allowed) console.log(`allowed: ${entry}`);
if (blocking.length > 0) {
	console.error(`npm audit found ${blocking.length} blocking advisories:\n${blocking.join("\n")}`);
	process.exit(1);
}
console.log("npm audit: no blocking advisories");
