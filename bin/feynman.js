#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

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

if (compareNodeVersions(parseNodeVersion(process.versions.node), parseNodeVersion(MIN_NODE_VERSION)) < 0) {
  const isWindows = process.platform === "win32";
  console.error(`feynman requires Node.js ${MIN_NODE_VERSION} or newer (detected ${process.versions.node}).`);
  console.error(isWindows
    ? "Install a supported Node.js release from https://nodejs.org, or use the standalone installer:"
    : `Switch to a supported Node release with \`nvm install ${PREFERRED_NODE_MAJOR} && nvm use ${PREFERRED_NODE_MAJOR}\`, or use the standalone installer:`);
  console.error(isWindows
    ? "irm https://feynman.is/install.ps1 | iex"
    : "curl -fsSL https://feynman.is/install | bash");
  process.exit(1);
}
const here = import.meta.dirname;

// `--version` needs only package.json; answer it without loading the CLI.
if (process.argv.length === 3 && process.argv[2] === "--version") {
  const { readFileSync } = await import("node:fs");
  console.log(JSON.parse(readFileSync(resolve(here, "..", "package.json"), "utf8")).version);
  process.exit(0);
}

await import(pathToFileURL(resolve(here, "..", "dist", "index.js")).href);
