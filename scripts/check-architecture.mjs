import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";

const appRoot = resolve(import.meta.dirname, "..");
const warningLineLimit = 800;
const failureLineLimit = 1200;
const sourceRoots = ["src", "extensions", "scripts", "tests"];
const sourceExtensions = new Set([".ts", ".mts", ".mjs"]);
const ignoredPathParts = new Set(["node_modules", "dist", ".git", ".feynman"]);

const allowedOversizedFiles = new Map([
	[
		"src/cli.ts",
		"Existing CLI dispatcher. Split command handlers into src/commands/ before growing CLI behavior.",
	],
]);

const domainRoots = [
	"src/artifacts/",
	"src/evidence/",
	"src/papers/",
];

const disallowedDomainImportRoots = [
	"src/cli",
	"src/commands/",
	"src/setup/",
	"src/ui/",
];

function extensionOf(path) {
	const match = path.match(/(\.[^.]+)$/);
	return match ? match[1] : "";
}

function walk(dir) {
	const files = [];
	for (const entry of readdirSync(dir)) {
		if (ignoredPathParts.has(entry)) continue;
		const abs = join(dir, entry);
		const stat = statSync(abs);
		if (stat.isDirectory()) {
			files.push(...walk(abs));
			continue;
		}
		if (stat.isFile() && sourceExtensions.has(extensionOf(entry))) {
			files.push(abs);
		}
	}
	return files;
}

function toRel(abs) {
	return normalize(relative(appRoot, abs)).replaceAll("\\", "/");
}

function countLines(text) {
	if (!text) return 0;
	return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
}

function extractImportSpecifiers(text) {
	const specs = [];
	const importRegex = /\b(?:import|export)\s+(?:[^'"]*?\s+from\s*)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;
	let match;
	while ((match = importRegex.exec(text)) !== null) {
		specs.push(match[1] ?? match[2]);
	}
	return specs;
}

function resolveRelativeImport(fromAbs, specifier) {
	if (!specifier.startsWith(".")) return undefined;
	const resolved = resolve(dirname(fromAbs), specifier);
	return toRel(resolved);
}

function checkFileSize(rel, lineCount) {
	if (lineCount <= warningLineLimit) return { kind: "ok" };
	if (lineCount > failureLineLimit) {
		const reason = allowedOversizedFiles.get(rel);
		if (reason) return { kind: "allowed", reason };
		return { kind: "fail", reason: `exceeds ${failureLineLimit} lines` };
	}
	return { kind: "warn", reason: `exceeds ${warningLineLimit} lines` };
}

function isDomainFile(rel) {
	return domainRoots.some((root) => rel.startsWith(root));
}

function disallowedDomainImport(rel, targetRel) {
	if (!isDomainFile(rel)) return undefined;
	return disallowedDomainImportRoots.find((root) => targetRel === root || targetRel.startsWith(root));
}

const files = sourceRoots.flatMap((root) => walk(resolve(appRoot, root))).sort();
const failures = [];
const warnings = [];
const debts = [];

for (const file of files) {
	const rel = toRel(file);
	const text = readFileSync(file, "utf8");
	const lineCount = countLines(text);
	const sizeCheck = checkFileSize(rel, lineCount);
	if (sizeCheck.kind === "fail") {
		failures.push(`${rel}: ${lineCount} lines (${sizeCheck.reason})`);
	} else if (sizeCheck.kind === "warn") {
		warnings.push(`${rel}: ${lineCount} lines (${sizeCheck.reason})`);
	} else if (sizeCheck.kind === "allowed") {
		debts.push(`${rel}: ${lineCount} lines (${sizeCheck.reason})`);
	}

	for (const specifier of extractImportSpecifiers(text)) {
		const targetRel = resolveRelativeImport(file, specifier);
		if (!targetRel) continue;
		const root = disallowedDomainImport(rel, targetRel);
		if (root) {
			failures.push(`${rel}: domain module imports ${specifier} (${root} boundary)`);
		}
	}
}

if (debts.length > 0) {
	console.log("[feynman:architecture] known architecture debt:");
	for (const debt of debts) console.log(`  - ${debt}`);
}

if (warnings.length > 0) {
	console.log("[feynman:architecture] files to split before they become core debt:");
	for (const warning of warnings) console.log(`  - ${warning}`);
}

if (failures.length > 0) {
	console.error("[feynman:architecture] failed:");
	for (const failure of failures) console.error(`  - ${failure}`);
	process.exit(1);
}

console.log(`[feynman:architecture] checked ${files.length} source files`);
