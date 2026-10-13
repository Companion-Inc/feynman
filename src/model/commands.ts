import type { AuthEvent, AuthInteraction, AuthPrompt } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { exec as execCallback } from "node:child_process";
import { dirname } from "node:path";
import { promisify } from "node:util";

import { promptChoice, promptSecret, promptSelect, promptText, SetupCancelledError, validateApiKeyInput, type PromptSelectOption } from "../setup/prompts.js";
import { openUrl } from "../system/open-url.js";
import { printInfo, printSection, printSuccess, printWarning } from "../ui/terminal.js";
import {
	buildModelStatusSnapshotFromRecords,
	chooseRecommendedModel,
	getAuthenticatedModelRecords,
	getAvailableModelRecords,
	getSupportedModelRecords,
	isProClassModelSpec,
	type ModelStatusSnapshot,
} from "./catalog.js";
import { MODEL_API_KEY_PROVIDERS, type ApiKeyProviderInfo } from "./api-key-providers.js";
import { createModelRegistry, createModelRuntime, getModelsJsonPath } from "./registry.js";
import { apiKeyReference, upsertProviderBaseUrl, upsertProviderConfig } from "./models-json.js";

const exec = promisify(execCallback);

async function collectModelStatus(settingsPath: string, authPath: string): Promise<ModelStatusSnapshot> {
	return buildModelStatusSnapshotFromRecords(
		await getSupportedModelRecords(authPath),
		await getAuthenticatedModelRecords(authPath),
		getCurrentModelSpec(settingsPath),
	);
}

type OAuthProviderInfo = {
	id: string;
	name?: string;
	usesCallbackServer?: boolean;
};

async function getOAuthProviders(authPath: string): Promise<OAuthProviderInfo[]> {
	const modelRuntime = await createModelRuntime(authPath);
	return modelRuntime
		.getProviders()
		.filter((provider) => Boolean(provider.auth.oauth))
		.map((provider) => ({
			id: provider.id,
			name: provider.auth.oauth?.name ?? provider.name,
		}));
}

async function resolveOAuthProvider(authPath: string, input: string): Promise<OAuthProviderInfo | undefined> {
	const normalizedInput = input.trim().toLowerCase();
	if (!normalizedInput) {
		return undefined;
	}
	return (await getOAuthProviders(authPath)).find((provider) => provider.id.toLowerCase() === normalizedInput);
}

async function selectOAuthProvider(authPath: string, action: "login" | "logout"): Promise<OAuthProviderInfo | undefined> {
	const providers = await getOAuthProviders(authPath);
	if (providers.length === 0) {
		printWarning("No Pi OAuth model providers are available.");
		return undefined;
	}
	if (providers.length === 1) {
		return providers[0];
	}

	const selection = await promptSelect<OAuthProviderInfo | "cancel">(
		`Choose an OAuth provider to ${action}:`,
		[
			...providers.map((provider) => ({
				value: provider,
				label: provider.name ?? provider.id,
				hint: provider.id,
			})),
			{ value: "cancel", label: "Cancel" },
		],
		providers[0],
	);
	if (selection === "cancel") {
		return undefined;
	}
	return selection;
}

// Endpoints Pi has no API-key sign-in for: Feynman writes their models.json entry.
const LOCAL_API_KEY_SETUPS: ApiKeyProviderInfo[] = MODEL_API_KEY_PROVIDERS.filter((provider) =>
	["lm-studio", "litellm", "__custom__"].includes(provider.id),
);

// Every provider Pi can sign in to with an API key (its own list, labels and
// prompts), plus Feynman's local and custom endpoint setups.
export async function listApiKeyProviders(authPath: string): Promise<ApiKeyProviderInfo[]> {
	const envVars = new Map(MODEL_API_KEY_PROVIDERS.map((provider) => [provider.id, provider.envVar]));
	const piProviders = (await createModelRuntime(authPath))
		.getProviders()
		.filter((provider) => provider.auth.apiKey)
		.map((provider) => ({ id: provider.id, label: provider.name, envVar: envVars.get(provider.id) }))
		.sort((left, right) => left.label.localeCompare(right.label));
	return [...piProviders, ...LOCAL_API_KEY_SETUPS];
}

async function resolveApiKeyProvider(authPath: string, input: string): Promise<ApiKeyProviderInfo | undefined> {
	const normalizedInput = normalizeProviderId(input);
	if (!normalizedInput) {
		return undefined;
	}
	return (await listApiKeyProviders(authPath)).find((provider) => provider.id === normalizedInput);
}

export async function resolveModelProviderForCommand(
	authPath: string,
	input: string,
): Promise<{ kind: "oauth" | "api-key"; id: string } | undefined> {
	const oauthProvider = await resolveOAuthProvider(authPath, input);
	if (oauthProvider) {
		return { kind: "oauth", id: oauthProvider.id };
	}

	const apiKeyProvider = await resolveApiKeyProvider(authPath, input);
	if (apiKeyProvider) {
		return { kind: "api-key", id: apiKeyProvider.id };
	}

	return undefined;
}

function apiKeyProviderHint(provider: ApiKeyProviderInfo): string {
	if (provider.id === "__custom__") {
		return "Ollama, vLLM, LM Studio, proxies";
	}
	if (provider.id === "lm-studio") {
		return "http://localhost:1234/v1";
	}
	if (provider.id === "litellm") {
		return "http://localhost:4000/v1";
	}
	return provider.envVar ?? provider.id;
}

async function selectApiKeyProvider(authPath: string): Promise<ApiKeyProviderInfo | undefined> {
	const providers = await listApiKeyProviders(authPath);
	const options: PromptSelectOption<ApiKeyProviderInfo | "cancel">[] = providers.map((provider) => ({
		value: provider,
		label: provider.label,
		hint: apiKeyProviderHint(provider),
	}));
	options.push({ value: "cancel", label: "Cancel" });

	const defaultProvider = providers.find((provider) => provider.id === "openai") ?? providers[0];
	const selection = await promptSelect("Choose an API-key provider:", options, defaultProvider);
	if (selection === "cancel") {
		return undefined;
	}
	return selection;
}

type CustomProviderSetup = {
	providerId: string;
	modelIds: string[];
	baseUrl: string;
	api: "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai";
	apiKeyConfig: string;
	/**
	 * If true, add `Authorization: Bearer <apiKey>` to requests in addition to
	 * whatever the API mode uses (useful for proxies that implement /v1/messages
	 * but expect Bearer auth instead of x-api-key).
	 */
	authHeader: boolean;
};

function normalizeProviderId(value: string): string {
	return value.trim().toLowerCase().replace(/\s+/g, "-");
}

function normalizeModelIds(value: string): string[] {
	const items = value
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
	return Array.from(new Set(items));
}

function normalizeBaseUrl(value: string): string {
	return value.trim().replace(/\/+$/, "");
}

function normalizeCustomProviderBaseUrl(
	api: CustomProviderSetup["api"],
	baseUrl: string,
): { baseUrl: string; note?: string } {
	const normalized = normalizeBaseUrl(baseUrl);
	if (!normalized) {
		return { baseUrl: normalized };
	}

	// Pi expects Anthropic baseUrl without `/v1` (it appends `/v1/messages` internally).
	if (api === "anthropic-messages" && /\/v1$/i.test(normalized)) {
		return { baseUrl: normalized.replace(/\/v1$/i, ""), note: "Stripped trailing /v1 for Anthropic mode." };
	}

	return { baseUrl: normalized };
}

function isLocalBaseUrl(baseUrl: string): boolean {
	return /^(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(baseUrl);
}

// "llama.cpp" is the id of Pi's bundled llama.cpp provider.
const LOCAL_PROVIDER_IDS = new Set(["ollama", "lm-studio", "vllm", "llama.cpp", "llama-cpp", "llamacpp"]);

export function isLocalModelProvider(authPath: string, providerId: string): boolean {
	if (!providerId) {
		return false;
	}
	if (LOCAL_PROVIDER_IDS.has(providerId)) {
		return true;
	}

	try {
		const raw = readFileSync(getModelsJsonPath(authPath), "utf8");
		const parsed = JSON.parse(raw) as { providers?: Record<string, { baseUrl?: unknown }> };
		const provider = parsed.providers?.[providerId];
		return typeof provider?.baseUrl === "string" && isLocalBaseUrl(provider.baseUrl);
	} catch {
		return false;
	}
}

async function resolveApiKeyConfig(apiKeyConfig: string): Promise<string | undefined> {
	const trimmed = apiKeyConfig.trim();
	if (!trimmed) return undefined;

	if (trimmed.startsWith("!")) {
		const command = trimmed.slice(1).trim();
		if (!command) return undefined;
		const shell = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : process.env.SHELL || "/bin/sh";
		try {
			const { stdout } = await exec(command, { shell, maxBuffer: 1024 * 1024 });
			const value = stdout.trim();
			return value || undefined;
		} catch {
			return undefined;
		}
	}

	const envValue = process.env[trimmed.replace(/^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/, "$1")];
	if (typeof envValue === "string" && envValue.trim()) {
		return envValue.trim();
	}

	// Fall back to literal value.
	return trimmed;
}

async function bestEffortFetchOpenAiModelIds(
	baseUrl: string,
	apiKey: string,
	authHeader: boolean,
): Promise<string[] | undefined> {
	const url = `${baseUrl}/models`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 5000);
	try {
		const response = await fetch(url, {
			method: "GET",
			headers: authHeader ? { Authorization: `Bearer ${apiKey}` } : undefined,
			signal: controller.signal,
		});
		if (!response.ok) {
			return undefined;
		}
		const json = (await response.json()) as any;
		if (!Array.isArray(json?.data)) return undefined;
		return json.data
			.map((entry: any) => (typeof entry?.id === "string" ? entry.id : undefined))
			.filter(Boolean);
	} catch {
		return undefined;
	} finally {
		clearTimeout(timer);
	}
}

async function promptCustomProviderSetup(): Promise<CustomProviderSetup | undefined> {
	printSection("Custom Provider");
	const providerIdInput = await promptText("Provider id (e.g. my-proxy)", "custom");
	const providerId = normalizeProviderId(providerIdInput);
	if (!providerId || providerId === "__custom__") {
		printWarning("Invalid provider id.");
		return undefined;
	}

	const apiChoices = [
		"openai-completions — OpenAI Chat Completions compatible (e.g. /v1/chat/completions)",
		"openai-responses — OpenAI Responses compatible (e.g. /v1/responses)",
		"anthropic-messages — Anthropic Messages compatible (e.g. /v1/messages)",
		"google-generative-ai — Google Generative AI compatible (generativelanguage.googleapis.com)",
		"Cancel",
	];
	const apiSelection = await promptChoice("API mode:", apiChoices, 0);
	if (apiSelection >= 4) {
		return undefined;
	}
	const api = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"][apiSelection] as CustomProviderSetup["api"];

	const baseUrlDefault = ((): string => {
		if (api === "openai-completions" || api === "openai-responses") return "http://localhost:11434/v1";
		if (api === "anthropic-messages") return "https://api.anthropic.com";
		if (api === "google-generative-ai") return "https://generativelanguage.googleapis.com";
		return "http://localhost:11434/v1";
	})();
	const baseUrlPrompt =
		api === "openai-completions" || api === "openai-responses"
			? "Base URL (include /v1 for OpenAI-compatible endpoints)"
			: api === "anthropic-messages"
				? "Base URL (no trailing /, no /v1)"
				: "Base URL (no trailing /)";
	const baseUrlRaw = await promptText(baseUrlPrompt, baseUrlDefault);
	const { baseUrl, note: baseUrlNote } = normalizeCustomProviderBaseUrl(api, baseUrlRaw);
	if (!baseUrl) {
		printWarning("Base URL is required.");
		return undefined;
	}
	if (baseUrlNote) {
		printInfo(baseUrlNote);
	}

	let authHeader = false;
	if (api === "openai-completions" || api === "openai-responses") {
		const defaultAuthHeader = !isLocalBaseUrl(baseUrl);
		const authHeaderChoices = [
			"Yes (send Authorization: Bearer <apiKey>)",
			"No (common for local Ollama/vLLM/LM Studio)",
			"Cancel",
		];
		const authHeaderSelection = await promptChoice(
			"Send Authorization header?",
			authHeaderChoices,
			defaultAuthHeader ? 0 : 1,
		);
		if (authHeaderSelection >= 2) {
			return undefined;
		}
		authHeader = authHeaderSelection === 0;
	}
	if (api === "anthropic-messages") {
		const defaultAuthHeader = isLocalBaseUrl(baseUrl);
		const authHeaderChoices = [
			"Yes (also send Authorization: Bearer <apiKey>)",
			"No (standard Anthropic uses x-api-key only)",
			"Cancel",
		];
		const authHeaderSelection = await promptChoice(
			"Also send Authorization header?",
			authHeaderChoices,
			defaultAuthHeader ? 0 : 1,
		);
		if (authHeaderSelection >= 2) {
			return undefined;
		}
		authHeader = authHeaderSelection === 0;
	}

	printInfo("API key value supports:");
	printInfo("  - literal secret (stored in models.json)");
	printInfo("  - env var name such as MY_API_KEY or $MY_API_KEY (resolved at runtime)");
	printInfo("  - !command (executes and uses stdout)");
	const apiKeyConfigRaw = (await promptText("API key / resolver", "")).trim();
	const apiKeyConfig = apiKeyReference(apiKeyConfigRaw) || "local";
	if (!apiKeyConfigRaw) {
		printInfo("Using placeholder apiKey value (required by Pi for custom providers).");
	}

	let modelIdsDefault = "my-model";
	if (api === "openai-completions" || api === "openai-responses") {
		// Best-effort: hit /models so users can pick correct ids (especially for proxies).
		const resolvedKey = await resolveApiKeyConfig(apiKeyConfig);
		const modelIds = resolvedKey ? await bestEffortFetchOpenAiModelIds(baseUrl, resolvedKey, authHeader) : undefined;
		if (modelIds && modelIds.length > 0) {
			const sample = modelIds.slice(0, 10).join(", ");
			printInfo(`Detected models: ${sample}${modelIds.length > 10 ? ", ..." : ""}`);
			modelIdsDefault = modelIds.includes("sonnet") ? "sonnet" : modelIds[0]!;
		}
	}

	const modelIdsRaw = await promptText("Model id(s) (comma-separated)", modelIdsDefault);
	const modelIds = normalizeModelIds(modelIdsRaw);
	if (modelIds.length === 0) {
		printWarning("At least one model id is required.");
		return undefined;
	}

	return { providerId, modelIds, baseUrl, api, apiKeyConfig, authHeader };
}

async function promptLmStudioProviderSetup(): Promise<CustomProviderSetup | undefined> {
	printSection("LM Studio");
	printInfo("Start the LM Studio local server first, then load a model.");

	const baseUrlRaw = await promptText("Base URL", "http://localhost:1234/v1");
	const { baseUrl } = normalizeCustomProviderBaseUrl("openai-completions", baseUrlRaw);
	if (!baseUrl) {
		printWarning("Base URL is required.");
		return undefined;
	}

	const detectedModelIds = await bestEffortFetchOpenAiModelIds(baseUrl, "lm-studio", false);
	let modelIdsDefault = "local-model";
	if (detectedModelIds && detectedModelIds.length > 0) {
		const sample = detectedModelIds.slice(0, 10).join(", ");
		printInfo(`Detected LM Studio models: ${sample}${detectedModelIds.length > 10 ? ", ..." : ""}`);
		modelIdsDefault = detectedModelIds[0]!;
	} else {
		printInfo("No models detected from /models. Enter the exact model id shown in LM Studio.");
	}

	const modelIdsRaw = await promptText("Model id(s) (comma-separated)", modelIdsDefault);
	const modelIds = normalizeModelIds(modelIdsRaw);
	if (modelIds.length === 0) {
		printWarning("At least one model id is required.");
		return undefined;
	}

	return {
		providerId: "lm-studio",
		modelIds,
		baseUrl,
		api: "openai-completions",
		apiKeyConfig: "lm-studio",
		authHeader: false,
	};
}

async function promptLiteLlmProviderSetup(): Promise<CustomProviderSetup | undefined> {
	printSection("LiteLLM Proxy");
	printInfo("Start the LiteLLM proxy first. Feynman uses the OpenAI-compatible chat-completions API.");

	const baseUrlRaw = await promptText("Base URL", "http://localhost:4000/v1");
	const { baseUrl } = normalizeCustomProviderBaseUrl("openai-completions", baseUrlRaw);
	if (!baseUrl) {
		printWarning("Base URL is required.");
		return undefined;
	}

	const keyChoices = [
		"Yes (use LITELLM_MASTER_KEY and send Authorization: Bearer <key>)",
		"No (proxy runs without authentication)",
		"Cancel",
	];
	const keySelection = await promptChoice("Is the proxy protected by a master key?", keyChoices, 0);
	if (keySelection >= 2) {
		return undefined;
	}

	const hasKey = keySelection === 0;
	const apiKeyConfig = hasKey ? "$LITELLM_MASTER_KEY" : "local";
	const authHeader = hasKey;
	if (hasKey) {
		printInfo("Set LITELLM_MASTER_KEY in your shell or .env before using Feynman.");
	}

	const resolvedKey = hasKey ? await resolveApiKeyConfig(apiKeyConfig) : apiKeyConfig;
	const detectedModelIds = resolvedKey
		? await bestEffortFetchOpenAiModelIds(baseUrl, resolvedKey, authHeader)
		: undefined;

	let modelIdsDefault = "your-litellm-model";
	if (detectedModelIds && detectedModelIds.length > 0) {
		const sample = detectedModelIds.slice(0, 10).join(", ");
		printInfo(`Detected LiteLLM models: ${sample}${detectedModelIds.length > 10 ? ", ..." : ""}`);
		modelIdsDefault = detectedModelIds[0]!;
	} else {
		printInfo("No models detected from /models. Enter the model id(s) from your LiteLLM config.");
	}

	const modelIdsRaw = await promptText("Model id(s) (comma-separated)", modelIdsDefault);
	const modelIds = normalizeModelIds(modelIdsRaw);
	if (modelIds.length === 0) {
		printWarning("At least one model id is required.");
		return undefined;
	}

	return {
		providerId: "litellm",
		modelIds,
		baseUrl,
		api: "openai-completions",
		apiKeyConfig,
		authHeader,
	};
}

async function verifyCustomProvider(setup: CustomProviderSetup, authPath: string): Promise<void> {
	const registry = await createModelRegistry(authPath);
	const modelsError = registry.getError();
	if (modelsError) {
		printWarning("Verification: models.json failed to load.");
		for (const line of modelsError.split("\n")) {
			printInfo(`  ${line}`);
		}
		return;
	}

	const all = registry.getAll();
	const hasModel = setup.modelIds.some((id) => all.some((model) => model.provider === setup.providerId && model.id === id));
	if (!hasModel) {
		printWarning("Verification: model registry does not contain the configured provider/model ids.");
		return;
	}

	const available = registry.getAvailable();
	const hasAvailable = setup.modelIds.some((id) =>
		available.some((model) => model.provider === setup.providerId && model.id === id),
	);
	if (!hasAvailable) {
		printWarning("Verification: provider is not considered authenticated/available.");
		return;
	}

	const apiKey = await registry.getApiKeyForProvider(setup.providerId);
	if (!apiKey) {
		printWarning("Verification: API key could not be resolved (check env var name / !command).");
		return;
	}

	const timeoutMs = 8000;

	// Best-effort network check for OpenAI-compatible endpoints
	if (setup.api === "openai-completions" || setup.api === "openai-responses") {
		const url = `${setup.baseUrl}/models`;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await fetch(url, {
				method: "GET",
				headers: setup.authHeader ? { Authorization: `Bearer ${apiKey}` } : undefined,
				signal: controller.signal,
			});
			if (!response.ok) {
				printWarning(`Verification: ${url} returned ${response.status} ${response.statusText}`);
				return;
			}
			const json = (await response.json()) as unknown;
			const modelIds = Array.isArray((json as any)?.data)
				? (json as any).data.map((entry: any) => (typeof entry?.id === "string" ? entry.id : undefined)).filter(Boolean)
				: [];
			const missing = setup.modelIds.filter((id) => modelIds.length > 0 && !modelIds.includes(id));
			if (modelIds.length > 0 && missing.length > 0) {
				printWarning(`Verification: /models does not list configured model id(s): ${missing.join(", ")}`);
				return;
			}
			printSuccess("Verification: endpoint reachable and authorized.");
		} catch (error) {
			printWarning(`Verification: failed to reach ${url}: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			clearTimeout(timer);
		}
		return;
	}

	if (setup.api === "anthropic-messages") {
		const url = `${setup.baseUrl}/v1/models?limit=1`;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const headers: Record<string, string> = {
				"x-api-key": apiKey,
				"anthropic-version": "2023-06-01",
			};
			if (setup.authHeader) {
				headers.Authorization = `Bearer ${apiKey}`;
			}
			const response = await fetch(url, {
				method: "GET",
				headers,
				signal: controller.signal,
			});
			if (!response.ok) {
				printWarning(`Verification: ${url} returned ${response.status} ${response.statusText}`);
				if (response.status === 404) {
					printInfo("  Tip: For Anthropic mode, use a base URL without /v1 (e.g. https://api.anthropic.com).");
				}
				if ((response.status === 401 || response.status === 403) && !setup.authHeader) {
					printInfo("  Tip: Some proxies require `Authorization: Bearer <apiKey>` even in Anthropic mode.");
				}
				return;
			}
			printSuccess("Verification: endpoint reachable and authorized.");
		} catch (error) {
			printWarning(`Verification: failed to reach ${url}: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			clearTimeout(timer);
		}
		return;
	}

	if (setup.api === "google-generative-ai") {
		const url = `${setup.baseUrl}/v1beta/models?key=${encodeURIComponent(apiKey)}`;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await fetch(url, { method: "GET", signal: controller.signal });
			if (!response.ok) {
				printWarning(`Verification: ${url} returned ${response.status} ${response.statusText}`);
				return;
			}
			printSuccess("Verification: endpoint reachable and authorized.");
		} catch (error) {
			printWarning(`Verification: failed to reach ${url}: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			clearTimeout(timer);
		}
		return;
	}

	printInfo("Verification: skipped network probe for this API mode.");
}

async function maybeSetRecommendedDefaultModel(settingsPath: string | undefined, authPath: string): Promise<void> {
	if (!settingsPath) {
		return;
	}

	const currentSpec = getCurrentModelSpec(settingsPath);
	const available = await getAvailableModelRecords(authPath);
	const currentValid = currentSpec ? available.some((m) => `${m.provider}/${m.id}` === currentSpec) : false;

	if ((!currentSpec || !currentValid) && available.length > 0) {
		const recommended = await chooseRecommendedModel(authPath);
		if (recommended) {
			await setDefaultModelSpec(settingsPath, authPath, recommended.spec);
		}
	}
}

async function configureApiKeyProvider(authPath: string, providerId?: string): Promise<boolean> {
	const provider = providerId ? await resolveApiKeyProvider(authPath, providerId) : await selectApiKeyProvider(authPath);
	if (!provider) {
		if (providerId) {
			throw new Error(`Unknown API-key model provider: ${providerId}`);
		}
		printInfo("API key setup cancelled.");
		return false;
	}

	if (provider.id === "lm-studio") {
		const setup = await promptLmStudioProviderSetup();
		if (!setup) {
			printInfo("LM Studio setup cancelled.");
			return false;
		}

		const modelsJsonPath = getModelsJsonPath(authPath);
		const result = upsertProviderConfig(modelsJsonPath, setup.providerId, {
			baseUrl: setup.baseUrl,
			apiKey: setup.apiKeyConfig,
			api: setup.api,
			authHeader: setup.authHeader,
			models: setup.modelIds.map((id) => ({ id })),
		});
		if (!result.ok) {
			printWarning(result.error);
			return false;
		}

		printSuccess("Saved LM Studio provider.");
		await verifyCustomProvider(setup, authPath);
		return true;
	}

	if (provider.id === "litellm") {
		const setup = await promptLiteLlmProviderSetup();
		if (!setup) {
			printInfo("LiteLLM setup cancelled.");
			return false;
		}

		const modelsJsonPath = getModelsJsonPath(authPath);
		const result = upsertProviderConfig(modelsJsonPath, setup.providerId, {
			baseUrl: setup.baseUrl,
			apiKey: setup.apiKeyConfig,
			api: setup.api,
			authHeader: setup.authHeader,
			models: setup.modelIds.map((id) => ({ id })),
		});
		if (!result.ok) {
			printWarning(result.error);
			return false;
		}

		printSuccess("Saved LiteLLM provider.");
		await verifyCustomProvider(setup, authPath);
		return true;
	}

	if (provider.id === "__custom__") {
		const setup = await promptCustomProviderSetup();
		if (!setup) {
			printInfo("Custom provider setup cancelled.");
			return false;
		}

		const modelsJsonPath = getModelsJsonPath(authPath);
		const result = upsertProviderConfig(modelsJsonPath, setup.providerId, {
			baseUrl: setup.baseUrl,
			apiKey: setup.apiKeyConfig,
			api: setup.api,
			authHeader: setup.authHeader,
			models: setup.modelIds.map((id) => ({ id })),
		});
		if (!result.ok) {
			printWarning(result.error);
			return false;
		}

		printSuccess(`Saved custom provider: ${setup.providerId}`);
		await verifyCustomProvider(setup, authPath);
		return true;
	}

	printSection(`API Key: ${provider.label}`);
	if (provider.envVar) {
		printInfo(`Tip: to avoid writing secrets to disk, set ${provider.envVar} in your shell or .env.`);
	}

	// Pi asks for whatever this provider needs (a key, or e.g. Cloudflare's account
	// and gateway, Bedrock's profile or token). Esc cancels.
	const modelRuntime = await createModelRuntime(authPath);
	const interaction = terminalAuthInteraction(provider.label, new AbortController().signal);
	const signedIn = await modelRuntime
		.login(provider.id, "api_key", {
			...interaction,
			prompt: async (prompt: AuthPrompt) => {
				if (prompt.type !== "secret") return interaction.prompt(prompt);
				const secret = await promptSecret(prompt.message, prompt.signal, validateApiKeyInput);
				// An empty key would be saved as a credential that fails every request.
				if (!secret) throw new SetupCancelledError("no API key entered");
				return secret;
			},
		})
		.then(() => true)
		.catch((error: unknown) => {
			if (!(error instanceof SetupCancelledError)) throw error;
			if (provider.envVar) printInfo(`Or set ${provider.envVar} and run feynman again.`);
			return false;
		});
	if (!signedIn) return false;
	printSuccess(`Saved ${provider.label} credentials in auth storage.`);

	const baseUrl = await promptText("Base URL override (optional, include /v1 for OpenAI-compatible endpoints)", "");
	if (baseUrl) {
		const modelsJsonPath = getModelsJsonPath(authPath);
		const result = upsertProviderBaseUrl(modelsJsonPath, provider.id, baseUrl);
		if (result.ok) {
			printSuccess(`Saved baseUrl override for ${provider.id} in models.json.`);
		} else {
			printWarning(result.error);
		}
	}
	await refreshProviderModels(modelRuntime, provider.id);

	return true;
}

async function resolveAvailableModelSpec(authPath: string, input: string): Promise<string | undefined> {
	const normalizedInput = input.trim().replace(/^([^/:]+):(.+)$/, "$1/$2").toLowerCase();
	if (!normalizedInput) {
		return undefined;
	}

	const available = await getAvailableModelRecords(authPath);
	const fullSpecMatch = available.find((model) => `${model.provider}/${model.id}`.toLowerCase() === normalizedInput);
	if (fullSpecMatch) {
		return `${fullSpecMatch.provider}/${fullSpecMatch.id}`;
	}

	const exactIdMatches = available.filter((model) => model.id.toLowerCase() === normalizedInput);
	if (exactIdMatches.length === 1) {
		return `${exactIdMatches[0]!.provider}/${exactIdMatches[0]!.id}`;
	}

	// When multiple providers expose the same bare model ID, prefer providers the
	// user explicitly configured in auth storage.
	if (exactIdMatches.length > 1) {
		const credentials = await (await createModelRuntime(authPath)).listCredentials();
		const configuredProviders = new Set(credentials.map((credential) => credential.providerId));
		const configuredMatches = exactIdMatches.filter((model) => configuredProviders.has(model.provider));
		if (configuredMatches.length === 1) {
			return `${configuredMatches[0]!.provider}/${configuredMatches[0]!.id}`;
		}
	}

	return undefined;
}

// The default model Pi will launch with, read through Pi's SettingsManager.
export function getCurrentModelSpec(settingsPath: string): string | undefined {
	const settings = SettingsManager.create(process.cwd(), dirname(settingsPath));
	const provider = settings.getDefaultProvider();
	const model = settings.getDefaultModel();
	return provider && model ? `${provider}/${model}` : undefined;
}

export async function printModelList(settingsPath: string, authPath: string): Promise<void> {
	const status = await collectModelStatus(settingsPath, authPath);
	if (status.availableModels.length === 0) {
		printWarning("No authenticated Pi models are currently available.");
		for (const line of status.guidance) {
			printInfo(line);
		}
		return;
	}

	let lastProvider: string | undefined;
	for (const spec of status.availableModels) {
		const [provider] = spec.split("/", 1);
		if (provider !== lastProvider) {
			lastProvider = provider;
			printSection(provider);
		}
		const markers = [
			spec === status.current ? "current" : undefined,
			spec === status.recommended ? "recommended" : undefined,
		].filter(Boolean);
		printInfo(`${spec}${markers.length > 0 ? ` (${markers.join(", ")})` : ""}`);
	}
}

export async function authenticateModelProvider(authPath: string, settingsPath?: string): Promise<boolean> {
	const choices = [
		"OAuth login (recommended: ChatGPT, Claude Max, Copilot, ...)",
		"API key or custom provider (OpenAI, Anthropic, Google, local/self-hosted, ...)",
		"Cancel",
	];
	const selection = await promptChoice("How do you want to authenticate?", choices, 0);

	if (selection === 0) {
		return loginModelProvider(authPath, undefined, settingsPath);
	}

	if (selection === 1) {
		const configured = await configureApiKeyProvider(authPath);
		if (configured) {
			await maybeSetRecommendedDefaultModel(settingsPath, authPath);
		}
		return configured;
	}

	printInfo("Authentication cancelled.");
	return false;
}

// Sign in with ChatGPT sends a stable installation ID. Pi's own /login keeps it
// as `deviceId` in the agent settings.json; share that one.
// Pi's own device ID, the one its /login sends, kept in the agent settings.
export async function getOrCreateDeviceId(authPath: string): Promise<string> {
	const settings = SettingsManager.create(process.cwd(), dirname(authPath));
	const deviceId = settings.getOrCreateDeviceId();
	await settings.flush();
	return deviceId;
}

// A provider answers invalid_grant when it rejects the authorization code, and
// the browser comes back with no code when the sign-in was denied or lost a
// redirect; a stale browser session usually causes both. Signing out there (or
// using a private window) and retrying fixes it.
export function describeOAuthLoginFailure(providerId: string, error: unknown): unknown {
	if (!(error instanceof Error) || !/invalid_grant|Missing authorization code/.test(error.message)) return error;
	const alternative = providerId === "openai" ? " Or sign in with `feynman model login openai-codex` instead." : "";
	return new Error(
		`${error.message}\nThe sign-in was rejected, usually because of a stale browser session. Sign out of the provider's site in your browser, or use a private window, then run \`feynman model login ${providerId}\` again.${alternative}`,
	);
}

// Pi's /login refreshes the provider's model list from the network after
// signing in (OpenRouter keys get the models that key may use); do the same,
// so the recommended default comes from that list. A failure keeps the saved list.
async function refreshProviderModels(modelRuntime: ModelRuntime, providerId: string): Promise<void> {
	await modelRuntime.refresh({ providers: [providerId], allowNetwork: true, signal: AbortSignal.timeout(15_000) }).catch(() => undefined);
}

// Runs Pi's own login prompts (selects, secrets, text, browser URLs) in the terminal.
function terminalAuthInteraction(providerLabel: string, signal: AbortSignal): AuthInteraction {
	return {
		prompt: async (prompt: AuthPrompt) => {
			if (prompt.type === "select") {
				return promptSelect(
					prompt.message,
					prompt.options.map((option) => ({
						value: option.id,
						label: option.label,
						hint: option.description,
					})),
					undefined,
					prompt.signal,
				);
			}
			if (prompt.type === "secret") {
				return promptSecret(prompt.message, prompt.signal);
			}
			// An empty answer here fails the login with "Missing authorization code";
			// keep asking, since the browser callback can still finish meanwhile.
			const required = prompt.type === "manual_code" ? "Paste the redirect URL or code, or finish signing in in the browser." : undefined;
			return promptText(prompt.message, "", prompt.placeholder, prompt.signal, required);
		},
		notify: (event: AuthEvent) => {
			if (event.type === "auth_url") {
				printSection(`Login: ${providerLabel}`);
				if (openUrl(event.url)) {
					printInfo("Opened the login URL in your browser.");
				} else {
					printWarning("Couldn't open your browser automatically.");
				}
				printInfo(`Auth URL: ${event.url}`);
				if (event.instructions) {
					printInfo(event.instructions);
				}
				return;
			}
			if (event.type === "device_code") {
				printSection(`Login: ${providerLabel}`);
				printInfo(`Visit ${event.verificationUri} and enter code: ${event.userCode}`);
				openUrl(event.verificationUri);
				return;
			}
			if (event.type === "progress" || event.type === "info") {
				printInfo(event.message);
			}
		},
		signal,
	};
}

export async function loginModelProvider(authPath: string, providerId?: string, settingsPath?: string): Promise<boolean> {
	if (providerId) {
		const resolvedProvider = await resolveModelProviderForCommand(authPath, providerId);
		if (!resolvedProvider) {
			throw new Error(`Unknown model provider: ${providerId}`);
		}
		if (resolvedProvider.kind === "api-key") {
			const configured = await configureApiKeyProvider(authPath, resolvedProvider.id);
			if (configured) {
				await maybeSetRecommendedDefaultModel(settingsPath, authPath);
			}
			return configured;
		}
	}

	const provider = providerId ? await resolveOAuthProvider(authPath, providerId) : await selectOAuthProvider(authPath, "login");
	if (!provider) {
		if (providerId) {
			throw new Error(`Unknown model provider: ${providerId}`);
		}
		printInfo("Login cancelled.");
		return false;
	}

	const modelRuntime = await createModelRuntime(authPath);
	const abortController = new AbortController();

	const deviceId = await getOrCreateDeviceId(authPath);
	await modelRuntime.login(provider.id, "oauth", terminalAuthInteraction(provider.name ?? provider.id, abortController.signal), { getDeviceId: () => deviceId }).catch((error: unknown) => {
		throw describeOAuthLoginFailure(provider.id, error);
	});

	printSuccess(`Model provider login complete: ${provider.id}`);
	await refreshProviderModels(modelRuntime, provider.id);

	await maybeSetRecommendedDefaultModel(settingsPath, authPath);

	return true;
}

export async function logoutModelProvider(authPath: string, providerId?: string): Promise<void> {
	const modelRuntime = await createModelRuntime(authPath);
	if (providerId) {
		const resolvedProvider = await resolveModelProviderForCommand(authPath, providerId);
		if (resolvedProvider) {
			await modelRuntime.logout(resolvedProvider.id);
			printSuccess(`Model provider logout complete: ${resolvedProvider.id}`);
			return;
		}

		const normalizedProviderId = normalizeProviderId(providerId);
		const credentials = await modelRuntime.listCredentials();
		if (credentials.some((credential) => credential.providerId === normalizedProviderId)) {
			await modelRuntime.logout(normalizedProviderId);
			printSuccess(`Model provider logout complete: ${normalizedProviderId}`);
			return;
		}

		throw new Error(`Unknown model provider: ${providerId}`);
	}

	const provider = await selectOAuthProvider(authPath, "logout");
	if (!provider) {
		printInfo("Logout cancelled.");
		return;
	}

	await modelRuntime.logout(provider.id);
	printSuccess(`Model provider logout complete: ${provider.id}`);
}

// Explains why `feynman model set <spec>` found no usable model.
async function describeUnavailableModelSpec(authPath: string, spec: string): Promise<string> {
	const input = spec.trim().replace(/^([^/:]+):(.+)$/, "$1/$2").toLowerCase();
	const known = (await getSupportedModelRecords(authPath)).find(
		(model) => `${model.provider}/${model.id}`.toLowerCase() === input || model.id.toLowerCase() === input,
	);
	if (known) {
		const knownSpec = `${known.provider}/${known.id}`;
		if (isProClassModelSpec(knownSpec)) {
			return `Pro-class model disabled: ${knownSpec}. Choose an approved research model.`;
		}
		if (isLocalModelProvider(authPath, known.provider)) {
			return `${knownSpec} has no API key. Pi only lists a local provider when it has one: add "apiKey": "local" to the ${known.provider} provider in ${getModelsJsonPath(authPath)}.`;
		}
		return `${knownSpec} has no credentials. Run \`feynman model login ${known.provider}\` first.`;
	}
	const modelId = input.slice(input.lastIndexOf("/") + 1);
	const matches = (await getAvailableModelRecords(authPath))
		.map((model) => `${model.provider}/${model.id}`)
		.filter((candidate) => candidate.toLowerCase().includes(modelId))
		.slice(0, 5);
	const suggestion = matches.length > 0 ? ` Did you mean ${matches.join(", ")}?` : "";
	return `Unknown model: ${spec}.${suggestion} Run \`feynman model list\` to see available models.`;
}

export async function setDefaultModelSpec(settingsPath: string, authPath: string, spec: string): Promise<void> {
	const resolvedSpec = await resolveAvailableModelSpec(authPath, spec);
	if (!resolvedSpec) {
		throw new Error(await describeUnavailableModelSpec(authPath, spec));
	}

	const [provider, ...rest] = resolvedSpec.split("/");
	// Pi's SettingsManager merges only the changed keys under its lock.
	const settings = SettingsManager.create(process.cwd(), dirname(settingsPath));
	settings.setDefaultModelAndProvider(provider!, rest.join("/"));
	await settings.flush();
	printSuccess(`Research default model set to ${resolvedSpec}`);
}

export async function selectDefaultModel(settingsPath: string, authPath: string): Promise<void> {
	const status = await collectModelStatus(settingsPath, authPath);
	if (status.availableModels.length === 0) {
		printWarning("No authenticated Pi models are currently available.");
		for (const line of status.guidance) {
			printInfo(line);
		}
		return;
	}
	const spec = await promptSelect(
		"Choose the default research model:",
		status.availableModels.map((value) => ({
			value,
			label: value,
			hint: value === status.current ? "current" : value === status.recommended ? "recommended" : undefined,
		})),
		status.current ?? status.recommended,
	);
	await setDefaultModelSpec(settingsPath, authPath, spec);
}

export async function runModelSetup(settingsPath: string, authPath: string): Promise<void> {
	let status = await collectModelStatus(settingsPath, authPath);

	while (status.availableModels.length === 0) {
		const choices = [
			"OAuth login (recommended: ChatGPT, Claude Max, Copilot, ...)",
			"API key or custom provider (OpenAI, Anthropic, ZAI, Kimi, MiniMax, ...)",
			"Cancel",
		];
		const selection = await promptChoice("Choose how to configure model access:", choices, 0);
		if (selection === 2) throw new SetupCancelledError();
		// Esc inside a provider list goes back to this menu instead of ending setup.
		const done = await (selection === 0
			? loginModelProvider(authPath, undefined, settingsPath)
			: configureApiKeyProvider(authPath)
		).catch((error: unknown) => {
			if (error instanceof SetupCancelledError) return false;
			throw error;
		});
		if (!done) {
			status = await collectModelStatus(settingsPath, authPath);
			continue;
		}
		status = await collectModelStatus(settingsPath, authPath);
		if (status.availableModels.length === 0) {
			printWarning("No authenticated models are available yet.");
			printInfo("If you configured a custom provider, ensure it has `apiKey` set in models.json.");
			printInfo("Tip: run `feynman doctor` to see models.json path + load errors.");
		}
	}

	if (status.currentValid) {
		printInfo(`Model: ${status.current}`);
		return;
	}

	const recommended = status.recommended ?? status.availableModels[0];
	if (recommended) {
		await setDefaultModelSpec(settingsPath, authPath, recommended);
	}
}
