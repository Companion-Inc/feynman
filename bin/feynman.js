#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MIN_NODE_VERSION = "22.22.0";
const MAX_NODE_MAJOR = 25;
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

const parsedNodeVersion = parseNodeVersion(process.versions.node);
if (compareNodeVersions(parsedNodeVersion, parseNodeVersion(MIN_NODE_VERSION)) < 0 || parsedNodeVersion.major > MAX_NODE_MAJOR) {
  const isWindows = process.platform === "win32";
  console.error(`feynman supports Node.js ${MIN_NODE_VERSION} through ${MAX_NODE_MAJOR}.x (detected ${process.versions.node}).`);
  console.error(parsedNodeVersion.major > MAX_NODE_MAJOR
    ? "This newer Node release is not supported yet."
    : isWindows
      ? "Install a supported Node.js release from https://nodejs.org, or use the standalone installer:"
      : `Switch to a supported Node release with \`nvm install ${PREFERRED_NODE_MAJOR} && nvm use ${PREFERRED_NODE_MAJOR}\`, or use the standalone installer:`);
  console.error(isWindows
    ? "irm https://feynman.is/install.ps1 | iex"
    : "curl -fsSL https://feynman.is/install | bash");
  process.exit(1);
}
await import(pathToFileURL(resolve(import.meta.dirname, "..", "dist", "index.js")).href);
