import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// About 1 in 5 users who started /deepresearch never answered its approval
// question; long workflows continue after the plan unless review was asked for.
for (const name of ["deepresearch", "lit"]) {
	test(`/${name} continues after writing its plan unless the user asked to review it`, () => {
		const prompt = readFileSync(`prompts/${name}.md`, "utf8");
		assert.match(prompt, /continue immediately in the same turn/);
		assert.doesNotMatch(prompt, /stop and ask for explicit confirmation before gathering evidence/);
	});
}

test("the system prompt says to run Python as python3", () => {
	assert.match(readFileSync(".feynman/SYSTEM.md", "utf8"), /run Python as `python3`/);
});

// On Pi 1.6.0, /lit batched the workflow-script write and the subagent call
// together twice in a row, so subagent read the script before it existed.
for (const name of ["deepresearch", "lit", "summarize"]) {
	test(`/${name} launches its workflow script only after the write succeeds, not in parallel with it`, () => {
		const prompt = readFileSync(`prompts/${name}.md`, "utf8");
		assert.match(prompt, /-workflow\.js/);
		assert.match(prompt, /after the write succeeds, in a later tool call \(not in parallel with the write\)/i);
	});
}
