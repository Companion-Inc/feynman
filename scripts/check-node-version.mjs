const MIN_NODE_VERSION = "22.22.0";
const PREFERRED_NODE_MAJOR = 24;

function parseNodeVersion(version) {
	const [major = "0", minor = "0", patch = "0"] = version.replace(/^v/, "").split(".");
	return {
		major: Number.parseInt(major, 10) || 0,
		minor: Number.parseInt(minor, 10) || 0,
		patch: Number.parseInt(patch, 10) || 0,
	};
}

function compareNodeVersions(left, right) {
	if (left.major !== right.major) return left.major - right.major;
	if (left.minor !== right.minor) return left.minor - right.minor;
	return left.patch - right.patch;
}

function isSupportedNodeVersion(version = process.versions.node) {
	return compareNodeVersions(parseNodeVersion(version), parseNodeVersion(MIN_NODE_VERSION)) >= 0;
}

function getUnsupportedNodeVersionLines(version = process.versions.node) {
	const isWindows = process.platform === "win32";
	return [
		`feynman requires Node.js ${MIN_NODE_VERSION} or newer (detected ${version}).`,
		isWindows
			? "Install a supported Node.js release from https://nodejs.org, or use the standalone installer:"
			: `Switch to a supported Node release with \`nvm install ${PREFERRED_NODE_MAJOR} && nvm use ${PREFERRED_NODE_MAJOR}\`, or use the standalone installer:`,
		isWindows
			? "irm https://feynman.is/install.ps1 | iex"
			: "curl -fsSL https://feynman.is/install | bash",
	];
}

if (!isSupportedNodeVersion()) {
	for (const line of getUnsupportedNodeVersionLines()) {
		console.error(line);
	}
	process.exit(1);
}
