import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export function getFeynmanHome(): string {
	return resolve(process.env.FEYNMAN_HOME ?? homedir(), ".feynman");
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
