import { runPi } from "./launch.js";
import { buildPiEnv, type PiRuntimeOptions } from "./runtime.js";

export const MAX_NATIVE_PACKAGE_NODE_MAJOR = 22;

type OptionalPackagePreset = {
	description: string;
	source: string;
	maxNodeMajor?: number;
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
	"session-search": {
		description: "Indexed recall for prior research session transcripts.",
		source: "npm:@kaiserlich-dev/pi-session-search",
		maxNodeMajor: MAX_NATIVE_PACKAGE_NODE_MAJOR,
	},
} satisfies Record<string, OptionalPackagePreset>;

export type OptionalPackagePresetName = keyof typeof OPTIONAL_PACKAGE_PRESETS;

function parseNodeMajor(version: string): number {
	return Number.parseInt(version.replace(/^v/, "").split(".")[0] ?? "0", 10) || 0;
}

export function supportsNativePackageSources(version = process.versions.node): boolean {
	return parseNodeMajor(version) <= MAX_NATIVE_PACKAGE_NODE_MAJOR;
}

export function normalizeOptionalPackagePresetName(name: string): OptionalPackagePresetName | undefined {
	const normalized = name.trim().toLowerCase();
	return normalized in OPTIONAL_PACKAGE_PRESETS ? (normalized as OptionalPackagePresetName) : undefined;
}

export function isOptionalPackagePresetSupported(name: OptionalPackagePresetName, version = process.versions.node): boolean {
	const preset: OptionalPackagePreset = OPTIONAL_PACKAGE_PRESETS[name];
	return !preset.maxNodeMajor || parseNodeMajor(version) <= preset.maxNodeMajor;
}

export function listOptionalPackagePresets(version = process.versions.node) {
	return (Object.keys(OPTIONAL_PACKAGE_PRESETS) as OptionalPackagePresetName[])
		.filter((name) => isOptionalPackagePresetSupported(name, version))
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
