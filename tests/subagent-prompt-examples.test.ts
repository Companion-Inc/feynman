import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const repoRoot = join(import.meta.dirname, "..");
const scannedDirs = ["prompts", "skills", ".feynman", "website/src/content/docs"];

// pi-subagents' own validator for structured parallel `tasks` items. Models copy the
// runs.all examples in our prompts into `subagent {tasks: [...]}`, so every example item
// (minus its runs.all `key`) must pass this validator.
const piSubagentsDir = join(dirname(createRequire(import.meta.url).resolve("pi-subagents")), "..");
const { buildStructuredWorkflowScript } = (await import(
	pathToFileURL(join(piSubagentsDir, "src/workflows/structured-workflow-scripts.js")).href
)) as { buildStructuredWorkflowScript: (kind: "tasks", steps: unknown[]) => string };

function markdownFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return markdownFiles(path);
		return /\.mdx?$/.test(name) ? [path] : [];
	});
}

function arrayLiteralAfter(text: string, start: number): string {
	let depth = 0;
	let quote: string | undefined;
	for (let index = start; index < text.length; index += 1) {
		const char = text[index];
		if (quote) {
			if (char === "\\") index += 1;
			else if (char === quote) quote = undefined;
			continue;
		}
		if (char === '"' || char === "'" || char === "`") quote = char;
		else if (char === "[") depth += 1;
		else if (char === "]" && --depth === 0) return text.slice(start, index + 1);
	}
	throw new Error(`unterminated array literal at offset ${start}`);
}

function exampleItemLists(markdown: string): { label: string; items: unknown[] }[] {
	const lists: { label: string; items: unknown[] }[] = [];
	const text = [...markdown.matchAll(/```(?:js|javascript|ts|json)\n([\s\S]*?)```/g)].map((block) => block[1]).join("\n");
	for (const match of text.matchAll(/runs\.all\(\s*\[|"?tasks"?\s*:\s*\[/g)) {
		const literal = arrayLiteralAfter(text, match.index + match[0].length - 1);
		const items = new Function(`return ${literal};`)() as unknown[];
		const isRunsAll = match[0].startsWith("runs.all");
		lists.push({
			label: isRunsAll ? "runs.all" : "tasks",
			items: isRunsAll
				? items.map((item) => {
						const { key: _key, ...rest } = item as Record<string, unknown>;
						return rest;
					})
				: items,
		});
	}
	return lists;
}

test("prompt subagent examples only use fields pi-subagents accepts on parallel items", () => {
	const scanned: string[] = [];
	const failures: string[] = [];
	for (const dir of scannedDirs) {
		for (const file of markdownFiles(join(repoRoot, dir))) {
			const lists = exampleItemLists(readFileSync(file, "utf8"));
			if (lists.length > 0) scanned.push(relative(repoRoot, file));
			for (const { label, items } of lists) {
				try {
					buildStructuredWorkflowScript("tasks", items);
				} catch (error) {
					failures.push(`${relative(repoRoot, file)} (${label}): ${(error as Error).message}`);
				}
			}
		}
	}
	assert.ok(scanned.includes("prompts/deepresearch.md"), `deepresearch example not scanned: ${scanned.join(", ")}`);
	assert.ok(scanned.includes("prompts/summarize.md"), `summarize example not scanned: ${scanned.join(", ")}`);
	assert.ok(scanned.includes("prompts/lit.md"), `lit example not scanned: ${scanned.join(", ")}`);
	assert.deepEqual(failures, []);
});
