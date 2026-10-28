import assert from "node:assert/strict";
import test from "node:test";

import { visibleWidth } from "@earendil-works/pi-tui";

import { installFeynmanHeader } from "../extensions/research-tools/header.js";

type HeaderFactory = (_tui: unknown, theme: {
	fg: (_color: string, text: string) => string;
	bold: (text: string) => string;
}) => {
	render: (width: number) => string[];
	invalidate: () => void;
};

test("Feynman header truncates long workflow names within terminal width", async () => {
	let headerFactory: HeaderFactory | undefined;
	const pi = {
		getCommands: () => [
			{
				source: "prompt",
				name: "gather-context-and-clarify",
				description: "Use subagents to gather context, then ask clarifying questions before execution.",
			},
		],
		getAllTools: () => [],
	};
	const ctx = {
		hasUI: true,
		model: { provider: "openai", id: "gpt-5.5" },
		cwd: process.cwd(),
		sessionManager: {
			getBranch: () => [],
			getSessionName: () => "test",
			getSessionId: () => "session-1",
		},
		ui: {
			setHeader: (factory: HeaderFactory) => {
				headerFactory = factory;
			},
		},
	};
	const cache = {};

	await installFeynmanHeader(pi as any, ctx as any, cache);
	assert.ok(headerFactory);

	const theme = {
		fg: (_color: string, text: string) => text,
		bold: (text: string) => text,
	};
	for (const width of [121, 50]) {
		const lines = headerFactory(undefined, theme).render(width);
		for (const line of lines) {
			assert.ok(
				visibleWidth(line) <= width,
				`expected line width ${visibleWidth(line)} to fit terminal width ${width}: ${line}`,
			);
		}
		assert.doesNotMatch(lines.join("\n"), /\/gather-context-and-clarifyUse/);
	}
	for (const width of [0, 1, 2, 3]) {
		assert.doesNotThrow(() => headerFactory!(undefined, theme).render(width), `render(${width}) threw`);
	}
});
