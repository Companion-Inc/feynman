import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// Like Pi's own agent-dir variable: a leading ~ in FEYNMAN_HOME (unexpanded in
// .env files, Docker ENV, or Windows shells) means the home folder.
export function expandHomePath(path: string, home = homedir()): string {
	if (path === "~") return home;
	return /^~[\\/]/.test(path) ? join(home, path.slice(2)) : path;
}

export function getFeynmanHome(): string {
	return resolve(expandHomePath(process.env.FEYNMAN_HOME ?? homedir()), ".feynman");
}

export function getFeynmanAgentDir(home = getFeynmanHome()): string {
	return resolve(home, "agent");
}

export function getFeynmanMemoryDir(home = getFeynmanHome()): string {
	return resolve(home, "memory");
}

export function getFeynmanStateDir(home = getFeynmanHome()): string {
	return resolve(home, ".state");
}

export function getDefaultSessionDir(home = getFeynmanHome()): string {
	return resolve(home, "sessions");
}

export function getBootstrapStatePath(home = getFeynmanHome()): string {
	return resolve(getFeynmanStateDir(home), "bootstrap.json");
}

export function ensureFeynmanHome(home = getFeynmanHome()): void {
	for (const dir of [
		home,
		getFeynmanAgentDir(home),
		getFeynmanMemoryDir(home),
		getFeynmanStateDir(home),
		getDefaultSessionDir(home),
	]) {
		mkdirSync(dir, { recursive: true });
	}
}
