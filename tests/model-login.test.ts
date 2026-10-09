import test from "node:test";
import assert from "node:assert/strict";

import { describeOAuthLoginFailure } from "../src/model/commands.js";

test("a rejected ChatGPT sign-in says how to retry", () => {
	const error = describeOAuthLoginFailure("openai", new Error('OpenAI OAuth token request failed (400): {\n  "error": "invalid_grant"\n}')) as Error;
	assert.match(error.message, /invalid_grant/);
	assert.match(error.message, /private window/);
	assert.match(error.message, /feynman model login openai`/);
	assert.match(error.message, /feynman model login openai-codex/);
});

test("a rejected sign-in for another provider names that provider; other errors pass through", () => {
	const rejected = describeOAuthLoginFailure("anthropic", new Error("Token exchange failed: invalid_grant")) as Error;
	assert.match(rejected.message, /feynman model login anthropic`/);
	assert.doesNotMatch(rejected.message, /openai-codex/);
	const other = new Error("Login cancelled");
	assert.equal(describeOAuthLoginFailure("openai", other), other);
});
