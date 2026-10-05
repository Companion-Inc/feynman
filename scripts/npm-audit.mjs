// `npm audit --omit=dev` that fails on every advisory except the ones below.
// Each exception names why it cannot be fixed here, what removes it, and the
// only install paths where it may appear.
// Usage: node scripts/npm-audit.mjs [--prefix <dir>]
import { spawnSync } from "node:child_process";

// Advisories that cannot be fixed here, with why and what removes each. None
// are open.
const ALLOWED_ADVISORIES = {};

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
