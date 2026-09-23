import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const e2eWorkflow = readFileSync(".github/workflows/e2e.yml", "utf8");
const publishWorkflow = readFileSync(".github/workflows/publish.yml", "utf8");
const packageManifest = JSON.parse(readFileSync("package.json", "utf8")) as {
	files?: string[];
};

test("pull-request release gates validate the merge candidate", () => {
	assert.match(e2eWorkflow, /pull_request:\s*\n\s+branches: \[main\]/);
	assert.match(e2eWorkflow, /\npermissions:\s*\n\s+contents: read\s*\n/);
	assert.doesNotMatch(e2eWorkflow, /github\.event\.pull_request\.head\.sha/);
	assert.match(e2eWorkflow, /name: Release candidate \(PR\)/);
	assert.match(e2eWorkflow, /name: Candidate consumer \(\$\{\{ matrix\.os \}\}, Node \$\{\{ matrix\.node \}\}\)/);
	assert.match(e2eWorkflow, /name: pr-npm-package/);
	assert.match(e2eWorkflow, /node: "22\.22\.0"/);
	assert.match(e2eWorkflow, /node: "25"/);
	assert.match(e2eWorkflow, /name: Windows native installer \(PR\)/);
	assert.match(e2eWorkflow, /shell: powershell/);
	assert.match(e2eWorkflow, /shell: pwsh/);
	assert.match(e2eWorkflow, /tarball_for_tar=\$\(cygpath -u "\$tarball"\)/);
	assert.match(e2eWorkflow, /consumer=\$\(cygpath -u "\$consumer"\)/);
	assert.equal(
		(e2eWorkflow.match(/scripts\/verify-windows-installer\.ps1/g) ?? []).length,
		2,
	);
});

test("manual post-release gates exercise the live native installers", () => {
	const installerJob = e2eWorkflow.match(
		/\n  published-native-installer-e2e:[\s\S]*?(?=\n  release-candidate-pr:)/,
	);
	assert.ok(installerJob, "manual workflow must define the published native installer job");
	assert.match(installerJob[0], /if: github\.event_name == 'workflow_dispatch'/);
	assert.match(installerJob[0], /https:\/\/feynman\.is\/install\b/);
	assert.match(installerJob[0], /https:\/\/feynman\.is\/install\.ps1/);
	assert.match(installerJob[0], /FEYNMAN_INSTALL_BIN_DIR/);
	assert.match(installerJob[0], /shell: powershell/);
	assert.match(installerJob[0], /check-pi-rpc\.mjs/);
	for (const os of ["ubuntu-latest", "macos-14", "windows-latest"]) {
		assert.match(installerJob[0], new RegExp(`- ${os}`));
	}
});

test("PR and publish workflows require clean package and consumer audits", () => {
	for (const workflow of [e2eWorkflow, publishWorkflow]) {
		assert.match(workflow, /npm ci --prefix "\$consumer\/node_modules\/@companion-ai\/feynman" --omit=dev/);
		assert.match(workflow, /npm audit --omit=dev --prefix "\$consumer\/node_modules\/@companion-ai\/feynman"/);
		assert.match(workflow, /npm pack --dry-run --json/);
		assert.match(workflow, /verify-package-budget\.mjs/);
		assert.match(workflow, /git status --porcelain --untracked-files=all/);
	}
});

test("installed package and native gates boot the shipped CLI in Pi RPC mode", () => {
	assert.ok(packageManifest.files?.includes("scripts/check-pi-rpc.mjs"), "package files must include the RPC compatibility check");
	assert.ok(packageManifest.files?.includes("npm-shrinkwrap.json"), "consumers must get the tested dependency tree");
	const rpcCheck = /scripts[\\/]check-pi-rpc\.mjs/g;
	assert.equal((e2eWorkflow.match(rpcCheck) ?? []).length, 7);
	assert.equal((publishWorkflow.match(rpcCheck) ?? []).length, 8);
	for (const workflow of [e2eWorkflow, publishWorkflow]) {
		assert.match(workflow, /bin="\$consumer\/node_modules\/\.bin\/feynman\.cmd"/);
		assert.match(workflow, /node "\$global_node_modules\/@companion-ai\/feynman\/scripts\/check-pi-rpc\.mjs"/);
		assert.match(workflow, /global_node_modules=\$\(npm root --global --prefix "\$global_prefix"\)/);
	}
	assert.match(publishWorkflow, /"\$bundle\/node\/bin\/node" "\$bundle\/app\/scripts\/check-pi-rpc\.mjs"/);
	assert.match(publishWorkflow, /"\$native_bundle_root\/node\/bin\/node" "\$native_bundle_root\/app\/scripts\/check-pi-rpc\.mjs"/);
});

test("package gates exercise the global npm install path", () => {
	assert.equal(
		(e2eWorkflow.match(/npm install --global --prefix "\$global_prefix"/g) ?? []).length,
		1,
	);
	assert.equal(
		(publishWorkflow.match(/npm install --global --prefix "\$global_prefix"/g) ?? []).length,
		2,
	);
	for (const workflow of [e2eWorkflow, publishWorkflow]) {
		assert.match(workflow, /global_bin="\$global_prefix\/feynman\.cmd"/);
		assert.match(workflow, /global_bin="\$global_prefix\/bin\/feynman"/);
		assert.match(workflow, /test "\$\("\$global_bin" --version \| tail -1\)"/);
		assert.match(workflow, /"\$global_bin" --help >\/dev\/null/);
	}
	assert.match(publishWorkflow, /global_prefix="\$RUNNER_TEMP\/published-global"/);
	assert.match(publishWorkflow, /"@companion-ai\/feynman@\$VERSION"/);
});

test("package consumer matrices allow two slow Windows package installs", () => {
	const candidateConsumerJob = e2eWorkflow.match(
		/\n  supported-node-consumers-pr:[\s\S]*?(?=\n  windows-native-installer-pr:)/,
	);
	assert.ok(candidateConsumerJob, "PR workflow must define the candidate consumer job");
	assert.match(candidateConsumerJob[0], /\n    timeout-minutes: 90\n/);

	const releaseConsumerJob = publishWorkflow.match(
		/\n  verify-package-consumers:[\s\S]*?(?=\n  publish-npm:)/,
	);
	assert.ok(releaseConsumerJob, "publish workflow must define the package consumer job");
	assert.match(releaseConsumerJob[0], /\n    timeout-minutes: 90\n/);
});

test("publish uses the exact verified tarball after native bundles pass", () => {
	assert.match(publishWorkflow, /\nconcurrency:\s*\n\s+group: publish-\$\{\{ github\.repository \}\}-\$\{\{ github\.ref \}\}-\$\{\{ github\.event_name \}\}\n\s+cancel-in-progress: false/);
	const releaseGithubJob = publishWorkflow.match(/\n  release-github:[\s\S]*?(?=\n  verify-published-state:)/);
	assert.ok(releaseGithubJob, "publish workflow must define the GitHub release job");
	assert.match(releaseGithubJob[0], /concurrency:\s*\n\s+group: release-github-\$\{\{ github\.repository \}\}\n\s+cancel-in-progress: false/);
	assert.match(publishWorkflow, /workflow_dispatch:/);
	assert.match(publishWorkflow, /name: npm-package/);
	assert.match(publishWorkflow, /name: npm-package\s*\n\s+path: npm-package/);
	const versionCheckJob = publishWorkflow.match(
		/\n  version-check:[\s\S]*?(?=\n  verify:)/,
	);
	assert.ok(versionCheckJob, "publish workflow must define the version check job");
	const manualPublishGate =
		/if \[ "\$GITHUB_EVENT_NAME" = "workflow_dispatch" \] && \[ "\$PUBLISHED" != "\$LOCAL" \]; then/;
	assert.match(versionCheckJob[0], manualPublishGate);
	assert.ok(
		versionCheckJob[0].search(manualPublishGate) <
			versionCheckJob[0].indexOf('echo "should_publish_npm=true"'),
		"manual publication must fail before publication is authorized",
	);
	const publishNpmJob = publishWorkflow.match(/\n  publish-npm:[\s\S]*?(?=\n  build-native-bundles:)/);
	assert.ok(publishNpmJob, "publish workflow must define the npm publication job");
	assert.match(
		publishNpmJob[0],
		/tarball=\$\(node -e 'process\.stdout\.write\(require\("node:path"\)\.resolve\(process\.argv\[1\]\)\)' "\$tarball"\)/,
	);
	assert.match(publishNpmJob[0], /npx npm@12\.0\.2 publish "\$tarball" --access public --provenance/);
	assert.match(publishNpmJob[0], /github\.event_name == 'push'/);
	assert.match(
		publishWorkflow,
		/Manual release runs may only reconcile an npm version already published from a main push\./,
	);
	assert.match(
		publishWorkflow,
		/publish-npm:\s*\n\s+needs:\s*\n\s+- version-check\s*\n\s+- verify\s*\n\s+- verify-package-consumers\s*\n\s+- build-native-bundles/,
	);
	assert.match(
		publishWorkflow,
		/build-native-bundles:\s*\n\s+needs:\s*\n\s+- version-check\s*\n\s+- verify\s*\n\s+- verify-package-consumers/,
	);
	assert.match(publishWorkflow, /verify-package-consumers:/);
	for (const os of ["ubuntu-latest", "macos-14", "windows-latest"]) {
		assert.match(publishWorkflow, new RegExp(`- os: ${os}`));
	}
	for (const nodeVersion of ["22.22.0", "24.20.0", "25"]) {
		assert.match(publishWorkflow, new RegExp(`node: "${nodeVersion.replace(/\./g, "\\.")}"`));
	}
	const consumerJob = publishWorkflow.match(
		/\n  verify-package-consumers:[\s\S]*?(?=\n  publish-npm:)/,
	);
	assert.ok(consumerJob, "publish workflow must define the package consumer job");
	assert.match(consumerJob[0], /consumer=\$\(cygpath -u "\$consumer"\)/);
	assert.match(publishWorkflow, /needs\.build-native-bundles\.result == 'success'/);
	assert.match(publishWorkflow, /needs\.verify-package-consumers\.result == 'success'/);
	assert.match(publishWorkflow, /dist\.integrity/);
	assert.match(publishWorkflow, /dist\.tarball/);
	assert.match(publishWorkflow, /audit signatures --json --include-attestations/);
	assert.match(publishWorkflow, /verify-npm-provenance\.mjs/);
	assert.match(publishWorkflow, /SHOULD_PUBLISH_NPM/);
	assert.match(publishWorkflow, /needs\.verify\.outputs\.package_integrity/);
	assert.doesNotMatch(
		publishWorkflow,
		/if \[ "\$\{\{ needs\.version-check\.outputs\.should_publish_npm \}\}" = "true" \]/,
	);
});

test("all three provenance verifier calls pin immutable IDs from trusted GitHub context", () => {
	const calls = [...publishWorkflow.matchAll(/node scripts\/verify-npm-provenance\.mjs \\\n[\s\S]*?\)/g)];
	assert.equal(calls.length, 3);
	for (const [call] of calls) {
		assert.match(call,
			/"refs\/heads\/main" \\\n\s+'\$\{\{ github\.repository_owner_id \}\}' \\\n\s+'\$\{\{ github\.repository_id \}\}'\)$/);
		assert.match(call, /"https:\/\/github\.com\/\$GITHUB_REPOSITORY"/);
		assert.match(call, /"\.github\/workflows\/publish\.yml"/);
	}
	assert.equal((publishWorkflow.match(/audit signatures --json --include-attestations/g) ?? []).length, 3);
});

test("npm 12 is pinned only for compatible publisher and signature-audit jobs", () => {
	// npm 12.0.2: ^22.22.2 || ^24.15.0 || >=26.0.0. In particular, not Node 25.
	const [major, minor, patch] = readFileSync(".nvmrc", "utf8").trim().replace(/^v/, "").split(".").map(Number);
	assert.ok(
		(major === 22 && (minor > 22 || (minor === 22 && patch >= 2))) ||
			(major === 24 && minor >= 15) || major >= 26,
		"Publisher .nvmrc must satisfy npm 12.0.2 engines",
	);
	assert.equal((publishWorkflow.match(/npx(?: --yes)? npm@12\.0\.2 /g) ?? []).length, 4);
	assert.equal((publishWorkflow.match(/npx --yes npm@12\.0\.2 audit signatures --json --include-attestations/g) ?? []).length, 3);
	for (const id of ["version-check", "publish-npm", "verify-published-state"]) {
		const job = publishWorkflow.match(new RegExp(`\\n  ${id}:[\\s\\S]*?(?=\\n  [a-z][a-z-]*:|$)`))?.[0];
		assert.ok(job, `missing ${id} job`);
		assert.match(job, /node-version-file: \.nvmrc/);
		assert.match(job, /npm@12\.0\.2/);
		assert.doesNotMatch(job, /node-version: \$\{\{ matrix\.node \}\}/);
	}
	const consumer = publishWorkflow.match(/\n  verify-package-consumers:[\s\S]*?(?=\n  publish-npm:)/)?.[0];
	assert.ok(consumer);
	assert.match(consumer, /node: "25"/);
	assert.doesNotMatch(consumer, /npm@12|npm install.*--global.*npm@/);
	assert.doesNotMatch(e2eWorkflow, /npm@12/);
	assert.doesNotMatch(publishWorkflow, /npm@11\.18\.0|npm@latest/);
	assert.match(publishWorkflow, /npx npm@12\.0\.2 publish "\$tarball" --access public --provenance/);
});

test("GitHub release waits for verification, native bundles, and npm publication", () => {
	assert.match(
		publishWorkflow,
		/release-github:\s*\n\s+needs:\s*\n\s+- version-check\s*\n\s+- verify\s*\n\s+- publish-npm\s*\n\s+- build-native-bundles/,
	);
	const releaseGithubJob = publishWorkflow.match(
		/\n  release-github:[\s\S]*?(?=\n  verify-published-state:)/,
	);
	assert.ok(releaseGithubJob, "publish workflow must define the GitHub release job");
	assert.match(releaseGithubJob[0], /needs\.verify\.result == 'success'/);
	assert.match(releaseGithubJob[0], /always\(\)/);
	assert.match(
		releaseGithubJob[0],
		/needs\.version-check\.outputs\.should_publish_npm == 'false' \|\|\s+needs\.publish-npm\.result == 'success'/,
	);
	assert.match(publishWorkflow, /pattern: native-\*/);
	assert.doesNotMatch(publishWorkflow, /gh release view "v\$VERSION" >\/dev\/null 2>&1/);
	assert.match(publishWorkflow, /release_exists=true/);
	assert.match(publishWorkflow, /release_exists=false/);
	assert.match(publishWorkflow, /--draft/);
	assert.match(publishWorkflow, /Staged release asset mismatch/);
});

test("version reconciliation and post-publish verification cover all release surfaces", () => {
	for (const id of ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64"]) {
		assert.match(publishWorkflow, new RegExp(`feynman-.*-${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
	}
	assert.match(publishWorkflow, /SHA256SUMS/);
	assert.match(publishWorkflow, /sha256sum -c SHA256SUMS/);
	assert.match(publishWorkflow, /SHA256SUMS entry mismatch/);
	assert.match(publishWorkflow, /assets\.length === expected\.size/);
	assert.match(publishWorkflow, /Number\(asset\.size\) > 0/);
	assert.match(publishWorkflow, /verify-published-state:/);
	const verifyPublishedJob = publishWorkflow.match(/\n  verify-published-state:[\s\S]*$/);
	assert.ok(verifyPublishedJob, "publish workflow must define the published-state verification job");
	assert.match(verifyPublishedJob[0], /always\(\)/);
	assert.match(
		verifyPublishedJob[0],
		/needs\.version-check\.outputs\.should_publish_npm == 'false' \|\|\s+needs\.publish-npm\.result == 'success'/,
	);
	assert.match(publishWorkflow, /gh release download "v\$VERSION"/);
	assert.match(
		publishWorkflow,
		/npm install --prefix "\$consumer" --omit=dev --no-audit \\\s+"@companion-ai\/feynman@\$VERSION"/,
	);
	assert.match(verifyPublishedJob[0], /npm_install_error="\$RUNNER_TEMP\/npm-install-published\.err"/);
	assert.match(verifyPublishedJob[0], /if ! grep -q 'E404' "\$npm_install_error"/);
	assert.match(verifyPublishedJob[0], /npm tarball did not become installable/);
	assert.match(verifyPublishedJob[0], /rm -rf "\$consumer\/node_modules" "\$consumer\/package-lock\.json"/);
	assert.match(publishWorkflow, /unzip -t/);
	assert.match(publishWorkflow, /targetCommitish/);
	assert.match(publishWorkflow, /asset\.digest/);
	assert.match(
		publishWorkflow,
		/repos\/\$GITHUB_REPOSITORY\/compare\/\$RELEASE_TARGET\.\.\.\$GITHUB_SHA/,
	);
	assert.match(publishWorkflow, /identical \| ahead/);
	assert.match(
		publishWorkflow,
		/npm version \$LOCAL provenance belongs to \$PUBLISHED_SOURCE_SHA, but GitHub release v\$LOCAL targets \$RELEASE_TARGET/,
	);
	assert.doesNotMatch(publishWorkflow, /npm view .* gitHead/);
	assert.doesNotMatch(
		publishWorkflow,
		/npm view "@companion-ai\/feynman@\$VERSION" version 2>\/dev\/null \|\| true/,
	);
	assert.match(publishWorkflow, /node-version-file: \.nvmrc/);
	assert.match(publishWorkflow, /npx npm@12\.0\.2 publish/);
	assert.match(publishWorkflow, /Windows native launcher failed --help/);
	assert.match(
		publishWorkflow,
		/\[System\.IO\.Compression\.ZipFile\]::ExtractToDirectory/,
	);
	assert.doesNotMatch(publishWorkflow, /Expand-Archive/);
	assert.doesNotMatch(publishWorkflow, /npm@latest/);
	for (const workflow of [e2eWorkflow, publishWorkflow]) {
		assert.doesNotMatch(workflow, /uses: actions\/[^@\s]+@v\d/);
	}
});
