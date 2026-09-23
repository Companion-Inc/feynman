import type { ExtensionAPI, ToolInfo } from "@earendil-works/pi-coding-agent";

import { isPublicLivePackageToolName } from "../../metadata/commands.mjs";

function formatSourceLabel(sourceInfo: { source: string; path: string }): string {
	const normalizedPath = sourceInfo.path.replaceAll("\\", "/");
	if (
		(sourceInfo.source === "local" || sourceInfo.source === "cli") &&
		(
			normalizedPath.endsWith("/extensions/research-tools.ts") ||
			normalizedPath.includes("/extensions/research-tools/")
		)
	) {
		return "extension";
	}
	if (sourceInfo.source === "local") {
		if (normalizedPath.includes("/prompts/")) return "workflow";
		if (normalizedPath.includes("/extensions/")) return "extension";
		return "local";
	}
	return sourceInfo.source.replace(/^npm:/, "").replace(/^git:/, "");
}

function isFeynmanLocalTool(tool: ToolInfo): boolean {
	if (tool.sourceInfo.source !== "local" && tool.sourceInfo.source !== "cli") return false;
	const normalizedPath = tool.sourceInfo.path.replaceAll("\\", "/");
	return (
		normalizedPath.endsWith("/extensions/research-tools.ts") ||
		normalizedPath.includes("/extensions/research-tools/")
	);
}

function isPublicTool(tool: ToolInfo): boolean {
	return isFeynmanLocalTool(tool) || isPublicLivePackageToolName(tool.name);
}

function summarizeToolParameters(tool: ToolInfo): string {
	const properties =
		tool.parameters &&
		typeof tool.parameters === "object" &&
		"properties" in tool.parameters &&
		tool.parameters.properties &&
		typeof tool.parameters.properties === "object"
			? Object.keys(tool.parameters.properties as Record<string, unknown>)
			: [];
	return properties.length > 0 ? properties.join(", ") : "no parameters";
}

function formatToolLine(tool: ToolInfo): string {
	const source = formatSourceLabel(tool.sourceInfo);
	return `${tool.name} — ${tool.description ?? ""} [${source}]`;
}

export function registerDiscoveryCommands(pi: ExtensionAPI): void {
	pi.registerCommand("tools", {
		description: "Browse public research tools with their source and parameter summary.",
		handler: async (_args, ctx) => {
			const tools = pi
				.getAllTools()
				.filter(isPublicTool)
				.slice()
				.sort((left, right) => left.name.localeCompare(right.name));
			const selected = await ctx.ui.select("Tools", tools.map((tool) => formatToolLine(tool)));
			if (!selected) return;

			const toolName = selected.split(" — ")[0] ?? selected;
			const tool = tools.find((entry) => entry.name === toolName);
			if (!tool) return;
			ctx.ui.notify(`${tool.name}: ${summarizeToolParameters(tool)}`, "info");
		},
	});
}
