import { runPi } from "./launch.js";
import { buildPiEnv, type PiRuntimeOptions } from "./runtime.js";

type OptionalPackagePreset = {
	description: string;
	source: string;
};

export const OPTIONAL_PACKAGE_PRESETS = {
	memory: {
		description: "Research-session preference and correction memory.",
		source: "npm:@samfp/pi-memory",
	},
	hindsight: {
		description: "Hindsight-backed research continuity memory.",
		source: "npm:@luxusai/pi-hindsight",
	},
} satisfies Record<string, OptionalPackagePreset>;

export type OptionalPackagePresetName = keyof typeof OPTIONAL_PACKAGE_PRESETS;

export function normalizeOptionalPackagePresetName(name: string): OptionalPackagePresetName | undefined {
	const normalized = name.trim().toLowerCase();
	return normalized in OPTIONAL_PACKAGE_PRESETS ? (normalized as OptionalPackagePresetName) : undefined;
}

export function listOptionalPackagePresets() {
	return (Object.keys(OPTIONAL_PACKAGE_PRESETS) as OptionalPackagePresetName[])
		.map((name) => ({ name, ...OPTIONAL_PACKAGE_PRESETS[name] }));
}

export function resolvePackageSource(name: string): string {
	const preset = normalizeOptionalPackagePresetName(name);
	return preset ? OPTIONAL_PACKAGE_PRESETS[preset].source : name.trim();
}

// Package installs and updates go through Pi's own package manager so they
// land in <agentDir>/npm exactly as `pi install` / `pi update` would.
export async function installPiPackage(options: PiRuntimeOptions, source: string): Promise<number> {
	return runPi(options, ["install", source], buildPiEnv(options));
}

export async function updatePiPackages(options: PiRuntimeOptions, source?: string): Promise<number> {
	return runPi(options, source ? ["update", source] : ["update", "--extensions"], buildPiEnv(options));
}
