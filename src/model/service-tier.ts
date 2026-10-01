import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { readJsonFile } from "../config/json-file.js";

export const FEYNMAN_SERVICE_TIERS = [
	"auto",
	"default",
	"flex",
	"priority",
	"standard_only",
] as const;

export type FeynmanServiceTier = (typeof FEYNMAN_SERVICE_TIERS)[number];

const SERVICE_TIER_SET = new Set<string>(FEYNMAN_SERVICE_TIERS);
const OPENAI_SERVICE_TIERS = new Set<FeynmanServiceTier>(["auto", "default", "flex", "priority"]);
const ANTHROPIC_SERVICE_TIERS = new Set<FeynmanServiceTier>(["auto", "standard_only"]);

function readSettings(settingsPath: string): Record<string, unknown> {
	try {
		return readJsonFile(settingsPath) as Record<string, unknown>;
	} catch {
		return {};
	}
}

export function normalizeServiceTier(value: string | undefined): FeynmanServiceTier | undefined {
	if (!value) return undefined;
	const normalized = value.trim().toLowerCase();
	return SERVICE_TIER_SET.has(normalized) ? (normalized as FeynmanServiceTier) : undefined;
}

export function getConfiguredServiceTier(settingsPath: string): FeynmanServiceTier | undefined {
	const settings = readSettings(settingsPath);
	return normalizeServiceTier(typeof settings.serviceTier === "string" ? settings.serviceTier : undefined);
}

export function setConfiguredServiceTier(settingsPath: string, tier: FeynmanServiceTier | undefined): void {
	const settings = readSettings(settingsPath);
	if (tier) {
		settings.serviceTier = tier;
	} else {
		delete settings.serviceTier;
	}

	mkdirSync(dirname(settingsPath), { recursive: true });
	writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
}

export function resolveActiveServiceTier(settingsPath: string): FeynmanServiceTier | undefined {
	return normalizeServiceTier(process.env.FEYNMAN_SERVICE_TIER) ?? getConfiguredServiceTier(settingsPath);
}

export function resolveProviderServiceTier(
	provider: string | undefined,
	tier: FeynmanServiceTier | undefined,
): FeynmanServiceTier | undefined {
	if (!provider || !tier) return undefined;
	if ((provider === "openai" || provider === "openai-codex") && OPENAI_SERVICE_TIERS.has(tier)) {
		return tier;
	}
	if (provider === "anthropic" && ANTHROPIC_SERVICE_TIERS.has(tier)) {
		return tier;
	}
	return undefined;
}
