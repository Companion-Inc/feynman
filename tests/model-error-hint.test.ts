import test from "node:test";
import assert from "node:assert/strict";

import { modelErrorHint } from "../extensions/research-tools/model-error-hint.js";

test("common provider errors get a cause and a fix", () => {
	const cases: Array<[string, string, RegExp]> = [
		["github-copilot", '400 {"error":{"message":"The requested model is not supported.","code":"model_not_supported"}}', /can't use this model/],
		["openrouter", "402: This request requires more credits", /out of credits/],
		["google", '{"error":{"code":429,"message":"You exceeded your current quota"}}', /quota/],
		["anthropic", '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}', /feynman model login anthropic/],
		["google", '{"error":{"code":503,"message":"This model is currently experiencing high demand."}}', /temporary/],
		["llmhub", "Request timed out.", /temporary/],
	];
	for (const [provider, error, expected] of cases) assert.match(modelErrorHint(provider, error) ?? "", expected, error);
	assert.equal(modelErrorHint("openai", "Something unexpected"), undefined);
});

test("a provider's sentence names the provider", () => {
	assert.match(modelErrorHint("google", "429 quota") ?? "", /^google /);
});

test("the hint waits until the run settles and skips errors Pi retried past", async () => {
	const { registerModelErrorHint } = await import("../extensions/research-tools/model-error-hint.js");
	const handlers: Record<string, (event: unknown, ctx: unknown) => void> = {};
	registerModelErrorHint({ on: (name: string, handler: (event: unknown, ctx: unknown) => void) => { handlers[name] = handler; } } as never);
	const notes: string[] = [];
	const ctx = { hasUI: true, ui: { notify: (text: string) => notes.push(text) } };
	const failed = { role: "assistant", stopReason: "error", provider: "google", errorMessage: "429 quota" };
	handlers.message_end!({ message: failed }, ctx);
	assert.equal(notes.length, 0);
	handlers.message_end!({ message: { role: "assistant", stopReason: "stop", provider: "google" } }, ctx);
	handlers.agent_settled!({ aborted: false }, ctx);
	assert.equal(notes.length, 0);
	handlers.message_end!({ message: failed }, ctx);
	handlers.agent_settled!({ aborted: false }, ctx);
	assert.equal(notes.length, 1);
	assert.match(notes[0]!, /quota/);
});
