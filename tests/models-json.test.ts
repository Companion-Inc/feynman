import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { apiKeyReference, migrateBareEnvApiKeys, upsertProviderConfig } from "../src/model/models-json.js";
import { createModelRegistry } from "../src/model/registry.js";

test("upsertProviderConfig creates models.json and merges provider config", () => {
	const dir = mkdtempSync(join(tmpdir(), "feynman-models-"));
	const modelsPath = join(dir, "models.json");

	const first = upsertProviderConfig(modelsPath, "custom", {
		baseUrl: "http://localhost:11434/v1",
		apiKey: "ollama",
		api: "openai-completions",
		authHeader: true,
		models: [{ id: "llama3.1:8b" }],
	});
	assert.deepEqual(first, { ok: true });

	const second = upsertProviderConfig(modelsPath, "custom", {
		baseUrl: "http://localhost:9999/v1",
	});
	assert.deepEqual(second, { ok: true });

	const parsed = JSON.parse(readFileSync(modelsPath, "utf8")) as any;
	assert.equal(parsed.providers.custom.baseUrl, "http://localhost:9999/v1");
	assert.equal(parsed.providers.custom.api, "openai-completions");
	assert.equal(parsed.providers.custom.authHeader, true);
	assert.deepEqual(parsed.providers.custom.models, [{ id: "llama3.1:8b" }]);
});

test("upsertProviderConfig writes LiteLLM proxy config with master key", () => {
	const dir = mkdtempSync(join(tmpdir(), "feynman-litellm-"));
	const modelsPath = join(dir, "models.json");

	const result = upsertProviderConfig(modelsPath, "litellm", {
		baseUrl: "http://localhost:4000/v1",
		apiKey: "LITELLM_MASTER_KEY",
		api: "openai-completions",
		authHeader: true,
		models: [{ id: "gpt-4o" }],
	});
	assert.deepEqual(result, { ok: true });

	const parsed = JSON.parse(readFileSync(modelsPath, "utf8")) as any;
	assert.equal(parsed.providers.litellm.baseUrl, "http://localhost:4000/v1");
	assert.equal(parsed.providers.litellm.apiKey, "LITELLM_MASTER_KEY");
	assert.equal(parsed.providers.litellm.api, "openai-completions");
	assert.equal(parsed.providers.litellm.authHeader, true);
	assert.deepEqual(parsed.providers.litellm.models, [{ id: "gpt-4o" }]);
});

test("upsertProviderConfig writes LiteLLM proxy config without master key", () => {
	const dir = mkdtempSync(join(tmpdir(), "feynman-litellm-"));
	const modelsPath = join(dir, "models.json");

	const result = upsertProviderConfig(modelsPath, "litellm", {
		baseUrl: "http://localhost:4000/v1",
		apiKey: "local",
		api: "openai-completions",
		authHeader: false,
		models: [{ id: "llama3" }],
	});
	assert.deepEqual(result, { ok: true });

	const parsed = JSON.parse(readFileSync(modelsPath, "utf8")) as any;
	assert.equal(parsed.providers.litellm.baseUrl, "http://localhost:4000/v1");
	assert.equal(parsed.providers.litellm.apiKey, "local");
	assert.equal(parsed.providers.litellm.api, "openai-completions");
	assert.equal(parsed.providers.litellm.authHeader, false);
	assert.deepEqual(parsed.providers.litellm.models, [{ id: "llama3" }]);
});

test("upsertProviderConfig rejects provider ids with path traversal chars", () => {
	const dir = mkdtempSync(join(tmpdir(), "feynman-models-"));
	const modelsPath = join(dir, "models.json");

	const withDots = upsertProviderConfig(modelsPath, "../etc/passwd", {
		baseUrl: "http://localhost:11434/v1",
	});
	assert.equal(withDots.ok, false);
	assert.ok(withDots.ok === false && "error" in withDots);

	const withSlash = upsertProviderConfig(modelsPath, "foo/bar", {
		baseUrl: "http://localhost:11434/v1",
	});
	assert.equal(withSlash.ok, false);
});

test("bare environment variable names in apiKey become $NAME, which Pi resolves", async () => {
	const dir = mkdtempSync(join(tmpdir(), "feynman-models-env-"));
	const modelsJsonPath = join(dir, "models.json");
	const provider = (apiKey: string) => ({ baseUrl: "http://localhost:4000/v1", api: "openai-completions", apiKey, models: [{ id: "m" }] });
	writeFileSync(modelsJsonPath, JSON.stringify({
		providers: {
			litellm: provider("LITELLM_MASTER_KEY"),
			local: provider("local"),
			literal: provider("sk-proj-AbC123"),
			dollar: provider("$MY_KEY"),
			command: provider("!op read secret"),
		},
	}));
	writeFileSync(join(dir, "auth.json"), "{}\n");

	assert.deepEqual(migrateBareEnvApiKeys(modelsJsonPath), ["litellm"]);
	const keys = Object.fromEntries(Object.entries(JSON.parse(readFileSync(modelsJsonPath, "utf8")).providers).map(([id, p]) => [id, (p as { apiKey: string }).apiKey]));
	assert.deepEqual(keys, { litellm: "$LITELLM_MASTER_KEY", local: "local", literal: "sk-proj-AbC123", dollar: "$MY_KEY", command: "!op read secret" });
	assert.deepEqual(migrateBareEnvApiKeys(modelsJsonPath), []);

	process.env.LITELLM_MASTER_KEY = "sk-real-secret";
	try {
		const registry = await createModelRegistry(join(dir, "auth.json"));
		assert.equal(await registry.getApiKeyForProvider("litellm"), "sk-real-secret");
	} finally {
		delete process.env.LITELLM_MASTER_KEY;
	}
	assert.equal(apiKeyReference("OPENAI_API_KEY"), "$OPENAI_API_KEY");
	assert.equal(apiKeyReference("sk-abc"), "sk-abc");
});
