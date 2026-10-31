// `npm audit --omit=dev` that fails on every advisory except the ones below.
// Each exception names why it cannot be fixed here, what removes it, and the
// only install paths where it may appear.
// Usage: node scripts/npm-audit.mjs [--prefix <dir>]
import { spawnSync } from "node:child_process";

// Advisories that cannot be fixed here, with why and what removes each.
// Pi 1.4.0 pins undici 8.10.2 exactly and installs it as its HTTP dispatcher.
// Every other copy resolves to a patched undici. Remove once Pi releases
// earendil-works/pi#11208.
const PINNED_UNDICI = {
	reason: "undici 8.10.2 pinned by Pi 1.4.0",
	nodes: /(^|\/)node_modules\/@earendil-works\/pi-coding-agent\/node_modules\/undici$/,
};
// Pi 1.4.0 pins minimatch 10.2.6 exactly. In a Feynman install nothing else
// uses minimatch, so npm hoists Pi's copy to the top level; `dependents` keeps
// that copy allowed only while Pi is its sole user. Remove once Pi releases
// with minimatch >= 11.0.1.
const PINNED_MINIMATCH = {
	reason: "minimatch 10.2.6 pinned by Pi 1.4.0",
	nodes: /(^|\/)node_modules\/(@earendil-works\/pi-coding-agent\/node_modules\/)?minimatch$/,
	dependents: /(^|\/)node_modules\/@earendil-works\/pi-coding-agent$/,
};
const ALLOWED_ADVISORIES = {
	"GHSA-4qv8-2p9j-2685": PINNED_UNDICI,
	"GHSA-f72v-6w45-q472": PINNED_UNDICI,
	"GHSA-xjj6-f33q-929c": PINNED_UNDICI,
	"GHSA-4w7w-5xrc-9h26": PINNED_UNDICI,
	"GHSA-2m5v-pch6-74hx": PINNED_UNDICI,
	"GHSA-qrxm-fqhp-jwvm": PINNED_UNDICI,
	"GHSA-9fm3-97px-rjf6": PINNED_UNDICI,
	"GHSA-55wc-3pg8-jfw6": PINNED_UNDICI,
	"GHSA-g3hv-75wg-m249": PINNED_MINIMATCH,
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

// Maps each installed copy of `name` to the locations of the packages that depend on it.
function dependentsOf(name) {
	const query = spawnSync("npm", ["query", `#${name}`, ...process.argv.slice(2)], {
		encoding: "utf8",
		shell: process.platform === "win32",
		stdio: ["ignore", "pipe", "inherit"],
	});
	return new Map(JSON.parse(query.stdout).map((node) => [node.location, node.from]));
}

const blocking = [];
const allowed = new Set();
for (const [name, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
	const nodes = vulnerability.nodes ?? [];
	// Entries whose `via` is only package names inherit an advisory listed on another entry.
	for (const via of vulnerability.via.filter((entry) => typeof entry === "object")) {
		const id = String(via.url ?? "").split("/").pop();
		const exception = ALLOWED_ADVISORIES[id];
		const dependents = exception?.dependents ? dependentsOf(name) : undefined;
		const scoped = (node) => {
			const from = dependents?.get(node);
			return (
				exception.nodes.test(node) &&
				(!dependents || (from?.length > 0 && from.every((location) => exception.dependents.test(location))))
			);
		};
		if (exception && nodes.length > 0 && nodes.every(scoped)) {
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
