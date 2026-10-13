import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const repository = "https://github.com/Companion-Inc/feynman";
const read = (path: string) => readFileSync(path, "utf8");

test("npm uses the Companion package and repository", () => {
	const manifest = JSON.parse(read("package.json"));
	const lock = JSON.parse(read("package-lock.json"));
	assert.equal(manifest.name, "@companion-ai/feynman");
	assert.equal(manifest.publishConfig.access, "public");
	assert.equal(manifest.bin.feynman, "bin/feynman.js");
	assert.ok(manifest.dependencies["@companion-ai/alpha-hub"]);
	assert.equal(lock.name, manifest.name);
	assert.equal(lock.packages[""].name, manifest.name);
	assert.equal(lock.version, manifest.version);
	assert.equal(lock.packages[""].version, manifest.version);
	assert.equal(manifest.repository.url, `git+${repository}.git`);
	assert.equal(manifest.homepage, `${repository}#readme`);
	assert.equal(manifest.bugs.url, `${repository}/issues`);
});

test("release and consumer workflows use only the Companion Feynman scope", () => {
	const manifest = JSON.parse(read("package.json"));
	const tarballPrefix = manifest.name.replace(/^@/, "").replaceAll("/", "-");
	for (const path of [".github/workflows/publish.yml", ".github/workflows/e2e.yml"]) {
		const content = read(path);
		assert.ok(content.includes("@companion-ai/feynman"), path);
		assert.doesNotMatch(content, /advaitpaliwal/i, path);
		assert.ok(content.includes(`${tarballPrefix}-`), path);
	}
	assert.ok(read(".github/workflows/e2e.yml").includes(`runner.temp }}/${tarballPrefix}-*.tgz`));
	assert.doesNotMatch(read(".github/workflows/deploy-website.yml"), /advaitpaliwal/i);
});

test("research source request identities use the Companion repository", () => {
	for (const name of readdirSync("extensions/research-tools").filter((name) => name.endsWith(".ts"))) {
		assert.doesNotMatch(read(`extensions/research-tools/${name}`), /advaitpaliwal/i, name);
	}
});

test("installation docs include the ordered one-time npm scope migration", () => {
	for (const path of ["website/src/content/docs/getting-started/installation.md"]) {
		const content = read(path);
		assert.ok(content.includes("npm uninstall -g @advaitpaliwal/feynman\nnpm install -g @companion-ai/feynman"), path);
	}
});

test("installers and their public copies use the Companion owner directly", () => {
	for (const [source, published] of [
		["install.sh", "install"],
		["install.ps1", "install.ps1"],
		["install-skills.sh", "install-skills"],
		["install-skills.ps1", "install-skills.ps1"],
	]) {
		const installer = read(`scripts/install/${source}`);
		assert.ok(installer.includes(`${repository}/releases/latest`), source);
		assert.doesNotMatch(installer, /advaitpaliwal/i);
		assert.equal(read(`website/public/${published}`), installer);
	}
});

test("public source links do not depend on old-owner redirects", () => {
	for (const path of [
		"README.md",
		"CONTRIBUTING.md",
		"website/src/layouts/main.astro",
		"website/src/pages/index.astro",
	]) {
		const content = read(path);
		assert.ok(content.includes(repository), path);
		assert.doesNotMatch(content, /github\.com\/advaitpaliwal(?:\/|%2f)feynman|advaitpaliwal%2Ffeynman/i, path);
	}
});

// Pi pins its own packages with open ^ ranges, so a fresh npm install of a
// Feynman pinned to Pi X.Y.Z pulled Pi X.(Y+1)'s pi-codemode, which Pi X.Y.Z
// cannot load. Feynman pins every Pi package Pi depends on to Pi's version;
// pi-tui and typebox stay "*" peers because Pi supplies them to extensions.
test("every Pi package Pi depends on is pinned to Pi's version", () => {
	const manifest = JSON.parse(read("package.json")) as {
		dependencies: Record<string, string>;
		peerDependencies: Record<string, string>;
	};
	const pi = JSON.parse(read("node_modules/@earendil-works/pi-coding-agent/package.json")) as {
		version: string;
		dependencies: Record<string, string>;
	};
	assert.equal(manifest.peerDependencies["@earendil-works/pi-coding-agent"], pi.version);
	for (const name of Object.keys(pi.dependencies).filter((dep) => dep.startsWith("@earendil-works/") && dep !== "@earendil-works/pi-tui")) {
		const pinned = manifest.dependencies[name] ?? manifest.peerDependencies[name];
		assert.equal(pinned, pi.version, name);
	}
});
