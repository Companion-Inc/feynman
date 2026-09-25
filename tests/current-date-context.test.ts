import assert from "node:assert/strict";
import test from "node:test";

import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

import {
	buildCurrentDateResearchContext,
	registerCurrentDateResearchContext,
} from "../extensions/research-tools/current-date.js";

test("current-date research context states the date and source-verification rules", () => {
	const context = buildCurrentDateResearchContext(new Date(2026, 7, 12, 9));
	assert.match(context, /current date is 2026-08-12/i);
	assert.match(context, /verify against current sources/i);
	assert.match(context, /Do not reject evidence only because its date is later than your training data/i);
});

test("before_agent_start adds current-date context as a system-prompt section", () => {
	let handler:
		| ((event: BeforeAgentStartEvent) => BeforeAgentStartEventResult | void)
		| undefined;
	const pi = {
		on(event: string, candidate: typeof handler) {
			if (event === "before_agent_start") handler = candidate;
		},
	} as unknown as ExtensionAPI;

	registerCurrentDateResearchContext(pi, () => new Date(2026, 7, 12, 9));
	assert.ok(handler);
	const event = {
		type: "before_agent_start",
		prompt: "Find the latest research.",
		systemPrompt: "Base prompt.",
		systemPromptOptions: {} as unknown as BeforeAgentStartEvent["systemPromptOptions"],
	} satisfies BeforeAgentStartEvent;
	const result = handler(event);
	assert.equal(result?.systemPrompt, undefined);
	assert.equal(
		event.systemPromptOptions.sections.current_date,
		buildCurrentDateResearchContext(new Date(2026, 7, 12, 9)),
	);
});
