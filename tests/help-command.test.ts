import assert from "node:assert/strict";
import test from "node:test";

import { registerDiscoveryCommands } from "../extensions/research-tools/discovery.js";
import { registerHelpCommand } from "../extensions/research-tools/help.js";

test("Feynman help omits generic scheduler and process package commands", async () => {
	const registered = new Map<string, { handler: (_args: string[], ctx: unknown) => Promise<void> }>();
	const liveCommandNames = [
		"agents",
		"run",
		"chain",
		"parallel",
		"ps",
		"schedule-prompt",
		"search",
		"web-results",
		"preview",
		"hotkeys",
		"new",
		"quit",
		"exit",
	];
	const pi = {
		getCommands: () => [
			...liveCommandNames.map((name) => ({ name, description: `${name} command` })),
			...Array.from(registered, ([name, command]) => ({ name, description: `${name} command`, ...command })),
		],
		registerCommand: (name: string, command: { handler: (_args: string[], ctx: unknown) => Promise<void> }) => {
			registered.set(name, command);
		},
	};
	const selectedItems: string[][] = [];
	const ctx = {
		ui: {
			select: async (_title: string, items: string[]) => {
				selectedItems.push(items);
				return undefined;
			},
			setEditorText: () => undefined,
			notify: () => undefined,
		},
	};

	registerHelpCommand(pi as any);
	await registered.get("help")?.handler([], ctx);

	const helpItems = selectedItems[0] ?? [];
	assert.ok(helpItems.some((item) => item.startsWith("/search ")));
	assert.ok(helpItems.some((item) => item.startsWith("/web-results ")));
	assert.ok(helpItems.some((item) => item.startsWith("/preview ")));
	assert.ok(helpItems.some((item) => item.startsWith("/hotkeys ")));
	assert.equal(helpItems.some((item) => item.startsWith("/ps ")), false);
	assert.equal(helpItems.some((item) => item.startsWith("/schedule-prompt ")), false);
});

test("Feynman tool browser omits generic scheduler and process package tools", async () => {
	type RegisteredCommand = {
		description?: string;
		handler: (_args: string[], ctx: unknown) => Promise<void>;
	};
	const repoRoot = "/tmp/feynman";
	const localSourceInfo = {
		source: "cli",
		path: `${repoRoot}/extensions/research-tools.ts`,
		scope: "temporary",
		origin: "top-level",
	};
	const windowsLocalSourceInfo = {
		...localSourceInfo,
		path: "C:\\feynman\\extensions\\research-tools.ts",
	};
	const packageSourceInfo = (source: string) => ({
		source,
		path: `${repoRoot}/node_modules/${source.replace(/^npm:/, "")}/dist/index.js`,
		scope: "project",
		origin: "package",
	});
	const registered = new Map<string, RegisteredCommand>();
	const pi = {
		getCommands: () => [],
		getAllTools: () => [
			{
				name: "alpha_search",
				description: "search papers",
				parameters: { properties: { query: {} } },
				sourceInfo: localSourceInfo,
			},
			{
				name: "hf_dataset_info",
				description: "inspect datasets",
				parameters: { properties: { dataset: {} } },
				sourceInfo: windowsLocalSourceInfo,
			},
			{
				name: "web_search",
				description: "web search",
				parameters: { properties: { query: {} } },
				sourceInfo: packageSourceInfo("npm:pi-web-access"),
			},
			{
				name: "document_parse",
				description: "parse documents",
				parameters: { properties: { path: {} } },
				sourceInfo: packageSourceInfo("npm:pi-docparser"),
			},
			{
				name: "subagent",
				description: "delegate research tasks",
				parameters: { properties: { agent: {}, task: {} } },
				sourceInfo: packageSourceInfo("npm:pi-subagents"),
			},
			{
				name: "schedule_prompt",
				description: "schedule a prompt",
				parameters: { properties: { prompt: {} } },
				sourceInfo: packageSourceInfo("npm:pi-schedule-prompt"),
			},
			{
				name: "process_list",
				description: "list background processes",
				parameters: { properties: {} },
				sourceInfo: packageSourceInfo("npm:pi-processes"),
			},
		],
		registerCommand: (name: string, command: RegisteredCommand) => {
			registered.set(name, command);
		},
	};
	const selectedItems: string[][] = [];
	const ctx = {
		ui: {
			select: async (_title: string, items: string[]) => {
				selectedItems.push(items);
				return undefined;
			},
			setEditorText: () => undefined,
			notify: () => undefined,
		},
	};

	registerDiscoveryCommands(pi as any);
	await registered.get("tools")?.handler([], ctx);

	const toolItems = selectedItems[0] ?? [];
	assert.ok(toolItems.some((item) => item.startsWith("alpha_search ") && item.endsWith("[extension]")));
	assert.ok(toolItems.some((item) => item.startsWith("hf_dataset_info ") && item.endsWith("[extension]")));
	assert.ok(toolItems.some((item) => item.startsWith("web_search ")));
	assert.ok(toolItems.some((item) => item.startsWith("document_parse ")));
	assert.ok(toolItems.some((item) => item.startsWith("subagent ")));
	assert.equal(toolItems.some((item) => item.startsWith("schedule_prompt ")), false);
	assert.equal(toolItems.some((item) => item.startsWith("process_list ")), false);
});
