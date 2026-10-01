import assert from "node:assert/strict";
import test from "node:test";

import { validateApiKeyInput } from "../src/setup/prompts.js";

test("API key input rejects characters a request header cannot carry", () => {
	assert.equal(validateApiKeyInput("sk-proj-AbC123_xyz.-"), undefined);
	assert.equal(validateApiKeyInput(""), undefined);
	// A Korean IME turned the first key character into U+C5EC, which failed
	// every request with "Cannot convert argument to a ByteString".
	assert.match(validateApiKeyInput("sk-여abc") ?? "", /keyboard input language/);
	assert.match(validateApiKeyInput("sk-abc def") ?? "", /ASCII/);
});
