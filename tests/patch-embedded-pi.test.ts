import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import { join, resolve } from "node:path";

import { runtimeWorkspaceMatches } from "../scripts/lib/runtime-workspace-restore.mjs";

test("embedded Pi patch covers nested release-bundle copies before artifact verification", () => {
	const source = readFileSync(resolve("scripts", "patch-embedded-pi.mjs"), "utf8");

	assert.match(source, /patchPiInteractiveUpdateNoticeSource/);
	assert.match(
		source,
		/const nestedAgentLoopPaths = resolveNestedPiFiles\(piPackageRoot, "pi-agent-core"/,
	);
	assert.match(
		source,
		/const workspaceNestedAgentLoopPaths = resolveWorkspaceNestedPiFiles\(/,
	);
	assert.match(source, /const nestedTuiPaths = resolveNestedPiFiles\(piPackageRoot, "pi-tui"/);
	assert.match(
		source,
		/const nestedTuiMainScreenPaths = resolveNestedPiFiles\(piPackageRoot, "pi-tui"/,
	);
	assert.match(
		source,
		/const workspaceNestedTuiPaths = resolveWorkspaceNestedPiFiles\(workspaceRoot, "pi-tui"/,
	);
	assert.match(source, /const workspaceNestedTuiMainScreenPaths = resolveWorkspaceNestedPiFiles\(/);
	assert.match(source, /const nestedEditorPaths = resolveNestedPiFiles\(piPackageRoot, "pi-tui"/);
	assert.match(source, /const workspaceNestedEditorPaths = workspaceNestedTuiPaths\.map/);
	assert.match(
		source,
		/\[\s*agentLoopPath,\s*\.\.\.nestedAgentLoopPaths,\s*workspaceAgentLoopPath,\s*\.\.\.workspaceNestedAgentLoopPaths,/,
	);
	assert.match(
		source,
		/\[\s*tuiPath,\s*tuiMainScreenPath,\s*\.\.\.nestedTuiPaths,\s*\.\.\.nestedTuiMainScreenPaths,\s*workspaceTuiPath,\s*workspaceTuiMainScreenPath,\s*\.\.\.workspaceNestedTuiPaths,\s*\.\.\.workspaceNestedTuiMainScreenPaths,/,
	);
	assert.match(
		source,
		/patchFilesIfPresent\(\s*\[interactiveModePath, workspaceInteractiveModePath\],\s*patchPiInteractiveUpdateNoticeSource,/,
	);
	assert.match(
		source,
		/\[\s*editorPath,\s*\.\.\.nestedEditorPaths,\s*workspaceEditorPath,\s*\.\.\.workspaceNestedEditorPaths,/,
	);
});

function extractFunctionBody(source: string, signature: string): string {
	const signatureStart = source.indexOf(signature);
	assert.ok(signatureStart !== -1, `expected to find ${JSON.stringify(signature)}`);
	const braceStart = source.indexOf("{", signatureStart);
	assert.ok(braceStart !== -1, `expected a "{" after ${JSON.stringify(signature)}`);
	let depth = 0;
	for (let i = braceStart; i < source.length; i++) {
		if (source[i] === "{") depth++;
		else if (source[i] === "}") {
			depth--;
			if (depth === 0) return source.slice(braceStart, i + 1);
		}
	}
	throw new Error(`unbalanced braces while scanning ${JSON.stringify(signature)}`);
}

test("ensureBundledPackageLinks does not repeat the runtime workspace integrity check", () => {
	const source = readFileSync(resolve("scripts", "patch-embedded-pi.mjs"), "utf8");

	const functionBody = extractFunctionBody(source, "function ensureBundledPackageLinks() {");
	assert.doesNotMatch(functionBody, /workspaceMatchesRuntime/);

	const allOccurrences = source.match(/ensureBundledPackageLinks\(/g) ?? [];
	assert.equal(
		allOccurrences.length,
		5,
		"expected exactly 1 definition + 4 call sites of ensureBundledPackageLinks; " +
			"if you added or removed one, confirm it only runs after a successful " +
			"workspaceMatchesRuntime() check and update this test",
	);

	const callSites = source.match(/(?<!function )ensureBundledPackageLinks\([^)]*\)/g) ?? [];
	assert.equal(callSites.length, 4);
	for (const callSite of callSites) {
		assert.match(callSite, /^ensureBundledPackageLinks\(\)$/);
	}

	const workspaceUnlockedBody = extractFunctionBody(
		source,
		"function ensurePackageWorkspaceUnlocked(heartbeat) {",
	);

	assert.match(
		workspaceUnlockedBody,
		/if \(workspaceMatchesRuntime\(supportedPackageSpecs\)\) \{\s*reconcileRuntimeWorkspaceRestoreArtifacts\(workspaceDir, \{\s*workspaceIsHealthy: true,\s*\}\);\s*ensureBundledPackageLinks\(\);\s*return;\s*\}/,
	);

	assert.match(
		workspaceUnlockedBody,
		/if \(packagedRestore\.restored && workspaceMatchesRuntime\(supportedPackageSpecs\)\) \{\s*ensureBundledPackageLinks\(\);\s*return;\s*\}/,
	);

	assert.match(
		workspaceUnlockedBody,
		/if \(\s*sourceRestore\.restored &&\s*workspaceMatchesRuntime\(supportedPackageSpecs\)\s*\) \{\s*ensureBundledPackageLinks\(\);\s*return;\s*\}/,
	);

	assert.match(
		workspaceUnlockedBody,
		/if \(!workspaceMatchesRuntime\(supportedPackageSpecs\)\) \{\s*throw new Error\(\s*"Feynman restored an incomplete bundled research runtime\.",\s*\);\s*\}\s*ensureBundledPackageLinks\(\);/,
	);
});

test("running the launch patcher leaves a prepared runtime workspace matching", () => {
	// Launches must not rewrite a completed workspace; otherwise every launch
	// sees a mismatched tree hash and restores the runtime again.
	const home = realpathSync(mkdtempSync(join(tmpdir(), "feynman-patch-idempotence-")));
	try {
		const run = spawnSync(process.execPath, [resolve("scripts", "patch-embedded-pi.mjs")], {
			encoding: "utf8",
			env: { ...process.env, FEYNMAN_HOME: home, FEYNMAN_TELEMETRY: "0" },
			timeout: 600_000,
		});
		assert.equal(run.status, 0, run.stderr);
		const source = readFileSync(resolve("scripts", "patch-embedded-pi.mjs"), "utf8");
		const pruneVersion = Number(source.match(/^const PRUNE_VERSION = (\d+);$/m)?.[1]);
		const packageSpecs = (JSON.parse(readFileSync(resolve(".feynman", "settings.json"), "utf8")) as { packages: string[] })
			.packages.filter((spec) => spec.startsWith("npm:")).map((spec) => spec.slice("npm:".length));
		assert.equal(runtimeWorkspaceMatches(resolve(".feynman", "npm"), packageSpecs, {
			archivePath: resolve(".feynman", "runtime-workspace.tgz"),
			digestPath: resolve(".feynman", "runtime-workspace.sha256"),
			pruneVersion,
			requireCompletion: true,
			requireCurrentPlatformPackageGraph: true,
			requirePlatformIdentity: Number(process.versions.node.split(".")[0]) <= 22,
		}), true);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});
