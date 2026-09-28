import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shellInstallerPath = resolve(appRoot, "scripts", "install", "install-skills.sh");
const powershellInstallerPath = resolve(appRoot, "scripts", "install", "install-skills.ps1");

test("skills installers expose Codex, repo, and OpenCode scopes", () => {
	const shellInstaller = readFileSync(shellInstallerPath, "utf8");
	assert.match(shellInstaller, /--codex/);
	assert.match(shellInstaller, /\$HOME\/\.codex/);
	assert.match(shellInstaller, /Codex user skills will be discovered from \\?\$CODEX_HOME\/skills/);
	assert.match(shellInstaller, /\.agents\/skills\/feynman/);
	assert.match(shellInstaller, /--opencode/);
	assert.match(shellInstaller, /\.opencode\/skills\/feynman/);
	assert.match(shellInstaller, /OpenCode project skills will be discovered from \.opencode\/skills/);

	const powershellInstaller = readFileSync(powershellInstallerPath, "utf8");
	assert.match(powershellInstaller, /ValidateSet\("Codex", "User", "Repo", "OpenCode"\)/);
	assert.match(powershellInstaller, /\.codex/);
	assert.match(powershellInstaller, /Codex user skills will be discovered from `\$CODEX_HOME\/skills/);
	assert.match(powershellInstaller, /\.agents\\skills\\feynman/);
	assert.match(powershellInstaller, /\.opencode\\skills\\feynman/);
	assert.match(powershellInstaller, /OpenCode project skills will be discovered from \.opencode\/skills/);
});

test("skills docs include the Codex and OpenCode install targets", () => {
	for (const relativePath of ["website/src/content/docs/getting-started/installation.md"]) {
		const source = readFileSync(resolve(appRoot, relativePath), "utf8");
		assert.match(source, /--codex/);
		assert.match(source, /Scope Codex/);
		assert.match(source, /~\/\.codex\/skills\/feynman/);
		assert.match(source, /--opencode/);
		assert.match(source, /\.opencode\/skills\/feynman/);
		assert.match(source, /Scope OpenCode/);
	}
});

function createFakeSkillsArchive() {
	const tempRoot = mkdtempSync(join(tmpdir(), "feynman-install-skills-"));
	const sourceRoot = join(tempRoot, "feynman-1.2.3");
	mkdirSync(join(sourceRoot, "skills", "deep-research"), { recursive: true });
	mkdirSync(join(sourceRoot, "prompts"), { recursive: true });
	writeFileSync(join(sourceRoot, "skills", "deep-research", "SKILL.md"), "# Deep Research\n", "utf8");
	writeFileSync(join(sourceRoot, "prompts", "deepresearch.md"), "# Prompt\n", "utf8");
	writeFileSync(join(sourceRoot, "AGENTS.md"), "# Agents\n", "utf8");
	writeFileSync(join(sourceRoot, "CONTRIBUTING.md"), "# Contributing\n", "utf8");

	const archivePath = join(tempRoot, "feynman-skills.tar.gz");
	const tarResult = spawnSync("tar", ["-czf", archivePath, "-C", tempRoot, "feynman-1.2.3"], {
		encoding: "utf8",
	});
	assert.equal(tarResult.status, 0, tarResult.stderr);
	return { tempRoot, archivePath };
}

test("Unix skills installer writes Codex skills under CODEX_HOME", { skip: process.platform === "win32" }, () => {
	const downloader = spawnSync("sh", ["-c", "command -v curl || command -v wget"], { encoding: "utf8" });
	if (downloader.status !== 0) {
		assert.fail("curl or wget is required for the installer smoke test");
	}

	const { tempRoot, archivePath } = createFakeSkillsArchive();
	const projectRoot = join(tempRoot, "project");
	const codexHome = join(tempRoot, "codex");
	mkdirSync(projectRoot, { recursive: true });
	const result = spawnSync("sh", [shellInstallerPath, "1.2.3", "--codex"], {
		cwd: projectRoot,
		encoding: "utf8",
		env: {
			...process.env,
			FEYNMAN_INSTALL_SKILLS_ARCHIVE_URL: pathToFileURL(archivePath).href,
			HOME: join(tempRoot, "home"),
			CODEX_HOME: codexHome,
		},
	});

	assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
	const installDir = join(codexHome, "skills", "feynman");
	assert.equal(existsSync(join(installDir, "deep-research", "SKILL.md")), true);
	assert.equal(existsSync(join(installDir, "prompts", "deepresearch.md")), true);
	assert.match(result.stdout, /Codex user skills will be discovered from \$CODEX_HOME\/skills/);
});

test("Unix skills installer writes OpenCode skills under .opencode", { skip: process.platform === "win32" }, () => {
	const downloader = spawnSync("sh", ["-c", "command -v curl || command -v wget"], { encoding: "utf8" });
	if (downloader.status !== 0) {
		assert.fail("curl or wget is required for the installer smoke test");
	}

	const { tempRoot, archivePath } = createFakeSkillsArchive();
	const projectRoot = join(tempRoot, "project");
	mkdirSync(projectRoot, { recursive: true });
	const result = spawnSync("sh", [shellInstallerPath, "1.2.3", "--opencode"], {
		cwd: projectRoot,
		encoding: "utf8",
		env: {
			...process.env,
			FEYNMAN_INSTALL_SKILLS_ARCHIVE_URL: pathToFileURL(archivePath).href,
			HOME: join(tempRoot, "home"),
			CODEX_HOME: join(tempRoot, "codex"),
		},
	});

	assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
	const installDir = join(projectRoot, ".opencode", "skills", "feynman");
	assert.equal(existsSync(join(installDir, "deep-research", "SKILL.md")), true);
	assert.equal(existsSync(join(installDir, "prompts", "deepresearch.md")), true);
	assert.match(result.stdout, /OpenCode project skills will be discovered from \.opencode\/skills/);
});
