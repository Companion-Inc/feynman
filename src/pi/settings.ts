import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { ModelRegistry, ModelRuntime, PackageSource } from "@earendil-works/pi-coding-agent";

import { parseJsonText, readJsonFile } from "../config/json-file.js";
import { BUNDLED_PI_PACKAGES, getFeynmanPackageSources, resolvePackageRoot } from "./runtime.js";
import { choosePreferredModelRecord, getAvailableModelRecords } from "../model/catalog.js";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

type ModelLookup = Pick<ModelRegistry, "find"> | Pick<ModelRuntime, "getModel">;

// Written by Feynman <= 0.4.0 next to a subagent extension path it managed.
const LEGACY_RESEARCHER_EXTENSION_MARKER = "_feynmanResearchToolsExtension";

function findModel(modelLookup: ModelLookup, provider: string, id: string) {
	return "find" in modelLookup
		? modelLookup.find(provider, id)
		: modelLookup.getModel(provider, id);
}

export function parseModelSpec(spec: string, modelLookup: ModelLookup) {
	const trimmed = spec.trim();
	for (const separator of ["/", ":"] as const) {
		const separatorIndex = trimmed.indexOf(separator);
		if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) {
			continue;
		}

		const provider = trimmed.slice(0, separatorIndex);
		const id = trimmed.slice(separatorIndex + 1);
		const model = findModel(modelLookup, provider, id);
		if (model) {
			return model;
		}
	}

	return undefined;
}

export function canonicalizeModelSpec(spec: string, modelLookup: ModelLookup): string | undefined {
	const model = parseModelSpec(spec, modelLookup);
	return model ? `${model.provider}/${model.id}` : undefined;
}

export function normalizeThinkingLevel(value: string | undefined): ThinkingLevel | undefined {
	if (!value) {
		return undefined;
	}

	const normalized = value.toLowerCase();
	if (
		normalized === "off" ||
		normalized === "minimal" ||
		normalized === "low" ||
		normalized === "medium" ||
		normalized === "high" ||
		normalized === "xhigh" ||
		normalized === "max"
	) {
		return normalized;
	}

	return undefined;
}

export function readJson(path: string): Record<string, unknown> {
	if (!existsSync(path)) {
		return {};
	}

	try {
		return readJsonFile(path) as Record<string, unknown>;
	} catch (error) {
		if (process.env.FEYNMAN_DEBUG === "1") {
			process.stderr.write(
				`[feynman] warning: failed to parse ${path}, treating as empty (${error instanceof Error ? error.message : "unknown error"})\n`,
			);
		}
		return {};
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readConfigObject(path: string, label: string): { source: string; value: Record<string, unknown> } {
	const source = readFileSync(path, "utf8");
	let value: unknown;
	try {
		value = parseJsonText(source);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(`Invalid ${label} at ${path}: ${reason}. Fix the JSON or delete the file. The file was not changed.`);
	}
	if (!isRecord(value)) {
		throw new Error(`Invalid ${label} at ${path}: expected a JSON object. The file was not changed.`);
	}
	return { source, value };
}

function prepareSubagentDefaults(settingsPath: string) {
	// cli.ts passes <feynmanAgentDir>/settings.json. Do not derive this from
	// HOME, authPath, the project cwd, or a potentially unrelated Pi env var.
	const path = join(dirname(settingsPath), "extensions", "subagent", "config.json");
	const existing = existsSync(path) ? readConfigObject(path, "subagent config") : undefined;
	const config = existing?.value ?? {};
	if (config.missions !== undefined && !isRecord(config.missions)) {
		throw new Error(`Invalid subagent config at ${path}: missions must be an object. The file was not changed.`);
	}
	const missions = config.missions ?? {};
	for (const [key, value] of [
		["missions.enabled", missions.enabled],
		["fleetView", config.fleetView],
		["asyncByDefault", config.asyncByDefault],
	] as const) {
		if (value !== undefined && typeof value !== "boolean") {
			throw new Error(`Invalid subagent config at ${path}: ${key} must be a boolean. The file was not changed.`);
		}
	}
	if (config.singleRunOutputBaseDir !== undefined && typeof config.singleRunOutputBaseDir !== "string") {
		throw new Error(`Invalid subagent config at ${path}: singleRunOutputBaseDir must be a string. The file was not changed.`);
	}
	if (
		missions.enabled !== undefined &&
		config.fleetView !== undefined &&
		config.asyncByDefault !== undefined &&
		config.singleRunOutputBaseDir !== undefined
	) {
		return undefined;
	}
	const next = {
		...config,
		missions: { ...missions, enabled: missions.enabled ?? false },
		fleetView: config.fleetView ?? false,
		asyncByDefault: config.asyncByDefault ?? true,
		// pi-subagents otherwise saves a relative `output` such as
		// outputs/.drafts/x.md under the session's subagent-artifacts folder, where
		// the lead agent never looks. "." resolves against Pi's cwd, the workspace.
		singleRunOutputBaseDir: config.singleRunOutputBaseDir ?? ".",
	};
	return { path, original: existing?.source, content: `${JSON.stringify(next, null, 2)}\n` };
}

function packageSourceName(source: string): string | undefined {
	if (source.startsWith("npm:")) {
		return source.slice("npm:".length).match(/^(@?[^@]+)/)?.[1];
	}
	const manifestPath = join(source, "package.json");
	if (!existsSync(manifestPath)) return undefined;
	try {
		return (JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: string }).name;
	} catch {
		return undefined;
	}
}

// Feynman and its bundled Pi packages load as local-path packages, so child
// sessions (pi-subagents) see the same resources as the main session. Entries
// for those packages from any other install or version are replaced; npm
// entries for them are the pinned core list written by Feynman <= 0.4.0.
export function reconcileFeynmanPackages(packages: unknown, appRoot: string): PackageSource[] {
	const feynmanName = (JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8")) as { name: string }).name;
	const managedNames = new Set<string>([feynmanName, "@companion-ai/alpha-hub", "pi-otel", ...BUNDLED_PI_PACKAGES]);
	const configured = Array.isArray(packages) ? (packages as PackageSource[]) : [];
	const userPackages = configured.filter((entry) => {
		const source = typeof entry === "string" ? entry : entry.source;
		const name = typeof source === "string" ? packageSourceName(source) : undefined;
		return !name || !managedNames.has(name);
	});
	return [...getFeynmanPackageSources(appRoot), ...userPackages];
}

function removeLegacyResearcherExtension(settings: Record<string, unknown>): void {
	const subagents = settings.subagents;
	const researcher = isRecord(subagents) && isRecord(subagents.agentOverrides) ? subagents.agentOverrides.researcher : undefined;
	if (!isRecord(researcher) || typeof researcher[LEGACY_RESEARCHER_EXTENSION_MARKER] !== "string") return;
	const managedPath = researcher[LEGACY_RESEARCHER_EXTENSION_MARKER];
	delete researcher[LEGACY_RESEARCHER_EXTENSION_MARKER];
	if (!Array.isArray(researcher.subagentOnlyExtensions)) return;
	const extensions = researcher.subagentOnlyExtensions.filter((entry) => entry !== managedPath);
	if (extensions.length > 0) researcher.subagentOnlyExtensions = extensions;
	else delete researcher.subagentOnlyExtensions;
}

// Foreground subagents run inside the parent process and never load its
// extensions, so researcher and verifier lost web and paper search there.
// pi-subagents loads these paths in every child session; they are rewritten on
// each launch because the install path changes between versions.
export function feynmanSubagentExtensions(appRoot: string): string[] {
	const webAccess = resolvePackageRoot(appRoot, "pi-web-access");
	return [join(appRoot, "extensions", "research-tools.ts"), ...(webAccess ? [webAccess] : [])];
}

function isFeynmanSubagentExtension(path: unknown): boolean {
	return typeof path === "string" && (/[\\/]extensions[\\/]research-tools\.ts$/.test(path) || /[\\/]pi-web-access$/.test(path));
}

export async function ensureFeynmanSettings(
	settingsPath: string,
	bundledSettingsPath: string,
	appRoot: string,
	defaultThinkingLevel: ThinkingLevel,
	authPath: string,
): Promise<void> {
	// Validate before model discovery or either settings write. Invalid custom
	// configuration must not silently turn into an empty/default configuration.
	const subagentDefaults = prepareSubagentDefaults(settingsPath);
	const existing = existsSync(settingsPath) ? readConfigObject(settingsPath, "Feynman settings") : undefined;
	const settings: Record<string, unknown> = existing ? { ...existing.value } : {};
	const defaults = readConfigObject(bundledSettingsPath, "bundled Feynman settings").value;

	for (const [key, value] of Object.entries({ ...defaults, defaultThinkingLevel })) {
		if (settings[key] === undefined) settings[key] = value;
	}
	settings.packages = reconcileFeynmanPackages(settings.packages, appRoot);
	removeLegacyResearcherExtension(settings);
	// 0.5.0-0.5.5 seeded a 6-retry, 5s backoff that left a dead connection
	// retrying silently for over five minutes; drop that exact value for Pi's default.
	if (isRecord(settings.retry) && JSON.stringify(settings.retry) === '{"maxRetries":6,"baseDelayMs":5000}') delete settings.retry;
	// A ~/.agents/<name>.md would otherwise silently replace Feynman's agents.
	if (settings.subagents === undefined) settings.subagents = {};
	if (isRecord(settings.subagents) && settings.subagents.agentExcludeDirs === undefined) {
		settings.subagents.agentExcludeDirs = ["~/.agents"];
	}
	if (isRecord(settings.subagents)) {
		const current = settings.subagents.defaultSubagentOnlyExtensions;
		if (current === undefined || (Array.isArray(current) && current.every(isFeynmanSubagentExtension))) {
			settings.subagents.defaultSubagentOnlyExtensions = feynmanSubagentExtensions(appRoot);
		}
	}

	if (!settings.defaultProvider || !settings.defaultModel) {
		const preferredModel = choosePreferredModelRecord(await getAvailableModelRecords(authPath));
		if (preferredModel) {
			settings.defaultProvider = preferredModel.provider;
			settings.defaultModel = preferredModel.id;
		}
	}

	// If another process wrote the subagent config while models were being
	// discovered, keep its version instead of overwriting it or failing startup.
	const subagentCurrent = subagentDefaults && existsSync(subagentDefaults.path) ? readFileSync(subagentDefaults.path, "utf8") : undefined;
	if (subagentDefaults && subagentCurrent === subagentDefaults.original) {
		mkdirSync(dirname(subagentDefaults.path), { recursive: true });
		try {
			writeFileSync(subagentDefaults.path, subagentDefaults.content, {
				encoding: "utf8", mode: 0o600, flag: subagentDefaults.original === undefined ? "wx" : "w",
			});
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
	}
	const content = JSON.stringify(settings, null, 2) + "\n";
	if (content === existing?.source) return;
	mkdirSync(dirname(settingsPath), { recursive: true });
	writeFileSync(settingsPath, content, "utf8");
}
