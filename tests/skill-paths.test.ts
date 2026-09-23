import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = join(repoRoot, "skills");
const markdownPathPattern = /`((?:\.\.?\/)(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.md)`/g;
const simulatedInstallRoot = join(repoRoot, "__skill-install-root__");
const scienceWorkbenchSkills = [
	"alphafold2",
	"boltz",
	"borzoi",
	"chai1",
	"compute-env-setup",
	"diffdock",
	"esmfold2",
	"evo2",
	"fair-esm2",
	"figure-composer",
	"figure-style",
	"indication-dossier",
	"ligandmpnn",
	"managed-model-endpoints",
	"openfold3",
	"paper-narrative",
	"pdf-explore",
	"proteinmpnn",
	"remote-compute-modal",
	"remote-compute-ssh",
	"scgpt",
	"scvi-tools",
	"skill-creator",
	"solublempnn",
	"using-model-endpoint",
] as const;

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

test("science workbench skill pack is bundled as Feynman-owned skills", () => {
	for (const skillName of scienceWorkbenchSkills) {
		const skillPath = join(skillsRoot, skillName, "SKILL.md");
		assert.ok(existsSync(skillPath), `expected ${skillName} to be bundled`);
		const content = readFileSync(skillPath, "utf8");
		assert.match(content, new RegExp(`^name: ${skillName}$`, "m"));
		assert.match(content, /^description: .+/m);
		assert.doesNotMatch(content, /claude-science|operon-cli|~\/\.claude-science/i);
	}
});
