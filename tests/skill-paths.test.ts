import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = join(repoRoot, "skills");
const markdownPathPattern = /`((?:\.\.?\/)(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.md)`/g;
const simulatedInstallRoot = join(repoRoot, "__skill-install-root__");

test("all local markdown references in bundled skills resolve in the installed skill layout", () => {
	for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;

		const skillPath = join(skillsRoot, entry.name, "SKILL.md");
		if (!existsSync(skillPath)) continue;

		const content = readFileSync(skillPath, "utf8");
		for (const match of content.matchAll(markdownPathPattern)) {
			const reference = match[1];
			const installedSkillDir = join(simulatedInstallRoot, entry.name);
			const installedTarget = resolve(installedSkillDir, reference);
			const repoTarget = join(skillsRoot, relative(simulatedInstallRoot, installedTarget));
			assert.ok(existsSync(repoTarget), `${skillPath} references missing installed markdown file ${reference}`);
		}
	}
});
