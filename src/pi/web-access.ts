import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { readJsonFile } from "../config/json-file.js";
import { getFeynmanAgentDir, getFeynmanHome } from "../config/paths.js";

// pi-web-access's search providers (SEARCH_PROVIDERS in its gemini-search.ts;
// a test keeps this list in step with the installed package).
export const PI_WEB_SEARCH_PROVIDERS = [
	"auto", "all", "openai", "brave", "parallel", "parallel-mcp", "tinyfish", "search1api", "searchinfinity", "querit",
	"tavily", "you", "firecrawl", "jina", "searxng", "degoog", "duckduckgo", "perplexity", "gemini", "kimi", "exa",
	"serpdive", "kagi", "ollama", "anysearch", "xai", "mistral", "brightdata", "serpbase", "serpapi", "serper", "serply",
	"valyu", "bocha", "xcrawl", "baizhi", "zai", "keenable", "ceramic", "deepseek", "linkup",
] as const;
export type PiWebSearchProvider = (typeof PI_WEB_SEARCH_PROVIDERS)[number];

// The web-search.json field holding a provider's key (searxng takes its base URL);
// undefined for providers with nothing to set.
export function searchProviderKeyField(provider: PiWebSearchProvider): string | undefined {
	if (provider === "auto" || provider === "all" || provider === "duckduckgo" || provider === "kimi") return undefined;
	if (provider === "parallel-mcp") return "parallelApiKey";
	if (provider === "searxng") return "searxngBaseUrl";
	return `${provider}ApiKey`;
}

const ROUTE_LABELS: Partial<Record<PiWebSearchProvider, string>> = { auto: "Auto", perplexity: "Perplexity", exa: "Exa", gemini: "Gemini" };
export type PiWebSearchWorkflow = "none" | "summary-review";

export type PiWebAccessConfig = Record<string, unknown> & {
	route?: PiWebSearchProvider;
	provider?: PiWebSearchProvider;
	searchProvider?: PiWebSearchProvider;
	workflow?: PiWebSearchWorkflow;
	perplexityApiKey?: string;
	exaApiKey?: string;
	geminiApiKey?: string;
	allowBrowserCookies?: boolean;
	browserCookies?: { profile?: string };
};

export type PiWebAccessStatus = {
	configPath: string;
	configExists: boolean;
	searchProvider: PiWebSearchProvider;
	requestProvider: PiWebSearchProvider;
	workflow: PiWebSearchWorkflow;
	perplexityConfigured: boolean;
	exaConfigured: boolean;
	geminiApiConfigured: boolean;
	chromeProfile?: string;
	geminiBrowserEnabled: boolean;
	routeLabel: string;
	// Search providers with a saved API key in web-search.json.
	configuredKeys: string[];
	note: string;
};

// pi-web-access reads web-search.json from PI_CODING_AGENT_DIR.
export function getPiWebSearchConfigPath(home?: string): string {
	const feynmanHome = home ? resolve(home, ".feynman") : getFeynmanHome();
	return resolve(getFeynmanAgentDir(feynmanHome), "web-search.json");
}

function normalizeProvider(value: unknown): PiWebSearchProvider | undefined {
	return (PI_WEB_SEARCH_PROVIDERS as readonly unknown[]).includes(value) ? (value as PiWebSearchProvider) : undefined;
}

function normalizeWorkflow(value: unknown): PiWebSearchWorkflow | undefined {
	return value === "none" || value === "summary-review" ? value : undefined;
}

function normalizeNonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function loadPiWebAccessConfig(configPath = getPiWebSearchConfigPath()): PiWebAccessConfig {
	if (!existsSync(configPath)) {
		return {};
	}

	try {
		const parsed = readJsonFile(configPath) as PiWebAccessConfig;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

export function savePiWebAccessConfig(
	updates: Partial<Record<keyof PiWebAccessConfig, unknown>>,
	configPath = getPiWebSearchConfigPath(),
): void {
	const merged: Record<string, unknown> = { ...loadPiWebAccessConfig(configPath) };
	for (const [key, value] of Object.entries(updates)) {
		if (value === undefined) {
			delete merged[key];
		} else {
			merged[key] = value;
		}
	}

	mkdirSync(dirname(configPath), { recursive: true });
	writeFileSync(configPath, JSON.stringify(merged, null, 2) + "\n", "utf8");
	// web-search.json can contain provider API keys; default to user-only permissions.
	try {
		chmodSync(configPath, 0o600);
	} catch {
		// ignore permission errors (best-effort)
	}
}

function formatRouteNote(provider: PiWebSearchProvider): string {
	if (provider === "auto") return "Pi web-access picks from the search providers you have keys or sign-ins for. Browser-cookie fallback is opt-in.";
	if (provider === "all") return "Pi web-access searches every eligible provider at once.";
	return `Pi web-access will use ${ROUTE_LABELS[provider] ?? provider} for search.`;
}

export function getPiWebAccessStatus(
	config: PiWebAccessConfig = loadPiWebAccessConfig(),
	configPath = getPiWebSearchConfigPath(),
): PiWebAccessStatus {
	const searchProvider =
		normalizeProvider(config.searchProvider) ?? normalizeProvider(config.route) ?? normalizeProvider(config.provider) ?? "auto";
	const requestProvider = normalizeProvider(config.provider) ?? normalizeProvider(config.route) ?? searchProvider;
	const workflow = normalizeWorkflow(config.workflow) ?? "none";
	const perplexityConfigured = Boolean(normalizeNonEmptyString(config.perplexityApiKey));
	const exaConfigured = Boolean(normalizeNonEmptyString(config.exaApiKey));
	const geminiApiConfigured = Boolean(normalizeNonEmptyString(config.geminiApiKey));
	const chromeProfile = normalizeNonEmptyString(config.browserCookies?.profile);
	const geminiBrowserEnabled = config.allowBrowserCookies === true;
	const effectiveProvider = searchProvider;
	const configuredKeys = PI_WEB_SEARCH_PROVIDERS.filter((provider) => {
		const field = searchProviderKeyField(provider);
		return field !== undefined && field.endsWith("ApiKey") && Boolean(normalizeNonEmptyString(config[field]));
	}).filter((provider) => provider !== "parallel-mcp");

	return {
		configPath,
		configExists: existsSync(configPath),
		searchProvider,
		requestProvider,
		workflow,
		perplexityConfigured,
		exaConfigured,
		geminiApiConfigured,
		chromeProfile,
		geminiBrowserEnabled,
		configuredKeys,
		routeLabel: ROUTE_LABELS[effectiveProvider] ?? effectiveProvider,
		note: formatRouteNote(effectiveProvider),
	};
}

export function formatPiWebAccessDoctorLines(
	status: PiWebAccessStatus = getPiWebAccessStatus(),
): string[] {
	const configPathSuffix = status.configExists ? "" : " (not created yet)";
	const lines = [
		"web access: pi-web-access",
		`  search route: ${status.routeLabel}`,
		`  request route: ${status.requestProvider}`,
		`  search workflow: ${status.workflow}`,
		`  saved api keys: ${status.configuredKeys.join(", ") || "none"}`,
		`  gemini browser fallback: ${status.geminiBrowserEnabled ? "enabled" : "disabled"}`,
		`  config path: ${status.configPath}${configPathSuffix}`,
		`  note: ${status.note}`,
	];
	if (status.geminiBrowserEnabled && status.chromeProfile) {
		lines.splice(6, 0, `  gemini browser profile: ${status.chromeProfile}`);
	}
	if (!status.configExists) {
		lines.push("  hint: run `feynman search set <provider> [api-key]` to configure web search (`feynman search set` lists providers)");
	}
	return lines;
}
