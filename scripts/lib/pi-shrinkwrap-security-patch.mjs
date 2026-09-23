import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { gte as semverGte, valid as validSemver } from "semver";

const require = createRequire(import.meta.url);

const SAFE_BRACE_EXPANSION = {
	version: "5.0.9",
	resolved: "https://registry.npmjs.org/brace-expansion/-/brace-expansion-5.0.9.tgz",
	integrity: "sha512-ScQ4IuvIEF1TMlP7Zt+vjJ//9zlPb2SDcxWxM3bk8s6t6GGdJ7KO1dCcTidOPJKePW30LE/2cT7wCyPho9/Wxg==",
	license: "MIT",
	dependencies: { "balanced-match": "^4.0.2" },
	engines: { node: "20 || >=22" },
};

const PATCHABLE_BRACE_EXPANSION_VERSIONS = ["5.0.6", "5.0.7", "5.0.8"];

function isSafeBraceExpansionVersion(version) {
	const parsedVersion = validSemver(version);
	return parsedVersion !== null && semverGte(parsedVersion, SAFE_BRACE_EXPANSION.version);
}

function readPackageVersion(packageRoot) {
	try {
		return JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")).version;
	} catch {
		return undefined;
	}
}

function resolveSafePackagePath(nodeModulesPath, fallbackSafePackagePath) {
	const candidates = [
		resolve(nodeModulesPath, "brace-expansion"),
		fallbackSafePackagePath,
	];
	try {
		candidates.push(dirname(require.resolve("brace-expansion/package.json")));
	} catch {}
	return candidates.find((candidate) =>
		candidate && readPackageVersion(candidate) === SAFE_BRACE_EXPANSION.version
	);
}

export function patchPiCodingAgentShrinkwrapSource(source) {
	const shrinkwrap = JSON.parse(source);
	const entry = shrinkwrap.packages?.["node_modules/brace-expansion"];
	if (isSafeBraceExpansionVersion(entry?.version)) {
		return source;
	}
	if (!entry || !PATCHABLE_BRACE_EXPANSION_VERSIONS.includes(entry.version)) {
		throw new Error(`Unsupported Pi brace-expansion shrinkwrap entry: ${entry?.version ?? "missing"}`);
	}
	shrinkwrap.packages["node_modules/brace-expansion"] = SAFE_BRACE_EXPANSION;
	return JSON.stringify(shrinkwrap, null, 2) + "\n";
}

export function patchPiPackageLockSource(source) {
	const lockfile = JSON.parse(source);
	let changed = false;
	for (const [packagePath, entry] of Object.entries(lockfile.packages ?? {})) {
		if (!packagePath.endsWith("/pi-coding-agent/node_modules/brace-expansion")) {
			continue;
		}
		if (isSafeBraceExpansionVersion(entry?.version)) {
			continue;
		}
		if (!entry || !PATCHABLE_BRACE_EXPANSION_VERSIONS.includes(entry.version)) {
			throw new Error(`Unsupported Pi brace-expansion package-lock entry: ${entry?.version ?? "missing"}`);
		}
		lockfile.packages[packagePath] = SAFE_BRACE_EXPANSION;
		changed = true;
	}
	return changed ? JSON.stringify(lockfile, null, 2) + "\n" : source;
}

/**
 * Older Pi releases shrinkwrap an affected brace-expansion release. Replace
 * only reviewed 5.0.6-5.0.8 trees with verified 5.0.9 for stale user runtimes.
 * Versions at or above 5.0.9 are outside the advisory range and remain intact.
 */
export function patchPiBraceExpansionTree(nodeModulesPath, fallbackSafePackagePath) {
	const piRoots = ["@earendil-works", "@mariozechner"]
		.map((scope) => resolve(nodeModulesPath, scope, "pi-coding-agent"))
		.filter((piRoot) => existsSync(resolve(piRoot, "npm-shrinkwrap.json")));
	if (piRoots.length === 0) {
		return false;
	}

	let changed = false;
	for (const piRoot of piRoots) {
		const shrinkwrapPath = resolve(piRoot, "npm-shrinkwrap.json");

		const shrinkwrapSource = readFileSync(shrinkwrapPath, "utf8");
		const patchedShrinkwrap = patchPiCodingAgentShrinkwrapSource(shrinkwrapSource);
		const nestedPackagePath = resolve(piRoot, "node_modules", "brace-expansion");
		const nestedVersion = readPackageVersion(nestedPackagePath);
		if (!isSafeBraceExpansionVersion(nestedVersion)) {
			if (nestedVersion && !PATCHABLE_BRACE_EXPANSION_VERSIONS.includes(nestedVersion)) {
				throw new Error(`Unsupported installed Pi brace-expansion version: ${nestedVersion}`);
			}
			const safePackagePath = resolveSafePackagePath(nodeModulesPath, fallbackSafePackagePath);
			if (!safePackagePath) {
				throw new Error(`Safe brace-expansion ${SAFE_BRACE_EXPANSION.version} package tree is unavailable`);
			}
			const temporaryPath = `${nestedPackagePath}.feynman-safe-${process.pid}`;
			rmSync(temporaryPath, { recursive: true, force: true });
			mkdirSync(dirname(temporaryPath), { recursive: true });
			cpSync(safePackagePath, temporaryPath, { recursive: true });
			rmSync(nestedPackagePath, { recursive: true, force: true });
			renameSync(temporaryPath, nestedPackagePath);
			changed = true;
		}
		if (patchedShrinkwrap !== shrinkwrapSource) {
			writeFileSync(shrinkwrapPath, patchedShrinkwrap, "utf8");
			changed = true;
		}
	}
	const packageLockPath = resolve(nodeModulesPath, "..", "package-lock.json");
	if (existsSync(packageLockPath)) {
		const packageLockSource = readFileSync(packageLockPath, "utf8");
		const patchedPackageLock = patchPiPackageLockSource(packageLockSource);
		if (patchedPackageLock !== packageLockSource) {
			writeFileSync(packageLockPath, patchedPackageLock, "utf8");
			changed = true;
		}
	}
	return changed;
}
