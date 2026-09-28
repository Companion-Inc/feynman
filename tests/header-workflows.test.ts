import assert from "node:assert/strict";
import test from "node:test";

import { getResearchWorkflows } from "../extensions/research-tools/header.js";

test("the startup header lists only Feynman's workflows, not other packages' prompts", () => {
	const commands = [
		{ name: "lit", description: "Literature review", source: "prompt" },
		{ name: "deepresearch", description: "Deep research", source: "prompt" },
		{ name: "parallel-review", description: "Parallel subagents review", source: "prompt" },
		{ name: "review-loop", description: "Review/fix loop until clean", source: "prompt" },
		{ name: "help", description: "Help", source: "extension" },
	];
	const workflows = getResearchWorkflows({ getCommands: () => commands } as never, process.cwd());
	assert.deepEqual(workflows.map((workflow) => workflow.name), ["/deepresearch", "/lit"]);
});
