import {
	getPiWebAccessStatus,
	PI_WEB_SEARCH_PROVIDERS,
	savePiWebAccessConfig,
	searchProviderKeyField,
	type PiWebAccessConfig,
	type PiWebSearchProvider,
} from "../pi/web-access.js";
import { printInfo } from "../ui/terminal.js";

export function searchSetUsage(): string {
	return `Usage: feynman search set <provider> [api-key]\nProviders: ${PI_WEB_SEARCH_PROVIDERS.join(", ")}`;
}

export function printSearchStatus(status = getPiWebAccessStatus()): void {
	const configPathSuffix = status.configExists ? "" : " (not created yet)";
	printInfo("Managed by: pi-web-access");
	printInfo(`Search route: ${status.routeLabel}`);
	printInfo(`Request route: ${status.requestProvider}`);
	printInfo(`Search workflow: ${status.workflow}`);
	printInfo(`Saved API keys: ${status.configuredKeys.join(", ") || "none"}`);
	printInfo(`Gemini browser fallback: ${status.geminiBrowserEnabled ? "enabled" : "disabled"}`);
	if (status.geminiBrowserEnabled && status.chromeProfile) {
		printInfo(`Gemini browser profile: ${status.chromeProfile}`);
	}
	printInfo(`Config path: ${status.configPath}${configPathSuffix}`);
	if (!status.configExists) {
		printInfo("Not configured yet. Run one of:");
		printInfo("  feynman search set auto");
		printInfo("  feynman search set <provider> <api-key>   (for example exa, brave, tavily, perplexity)");
	}
}

export function setSearchProvider(provider: string, apiKey?: string): void {
	if (!(PI_WEB_SEARCH_PROVIDERS as readonly string[]).includes(provider)) {
		throw new Error(searchSetUsage());
	}
	const keyField = searchProviderKeyField(provider as PiWebSearchProvider);
	if (apiKey !== undefined && !keyField) {
		throw new Error(`${provider} takes no API key. Usage: feynman search set ${provider}`);
	}

	const updates: Partial<Record<keyof PiWebAccessConfig, unknown>> = {
		provider,
		searchProvider: provider,
		workflow: "none",
		allowBrowserCookies: false,
		route: undefined,
	};
	if (keyField && apiKey !== undefined) {
		updates[keyField] = apiKey;
	}
	savePiWebAccessConfig(updates);

	const status = getPiWebAccessStatus();
	console.log(`Web search provider set to ${status.routeLabel}.`);
	console.log(`Config path: ${status.configPath}`);
}

export function clearSearchConfig(): void {
	savePiWebAccessConfig({
		provider: undefined,
		searchProvider: undefined,
		route: undefined,
		workflow: "none",
		allowBrowserCookies: false,
	});

	const status = getPiWebAccessStatus();
	console.log(`Web search provider reset to ${status.routeLabel}.`);
	console.log(`Config path: ${status.configPath}`);
}
