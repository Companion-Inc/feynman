import assert from "node:assert/strict";
import test from "node:test";

import type { JsonObject, Tool, ToolCall } from "@earendil-works/pi-ai";
import { validateToolArguments } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerAlphaTools } from "../extensions/research-tools/alpha.js";

test("Pi runtime validation omits null alpha_get_paper sections without losing optional arrays", () => {
	const tools = new Map<string, Tool>();
	const fakePi = {
		registerTool(tool: Parameters<ExtensionAPI["registerTool"]>[0]) {
			tools.set(tool.name, tool as unknown as Tool);
		},
		on() {
			return () => {};
		},
	};
	registerAlphaTools(fakePi as unknown as ExtensionAPI);

	const tool = tools.get("alpha_get_paper");
	assert.ok(tool);
	const providerSchema = JSON.parse(JSON.stringify(tool.parameters)) as {
		required?: string[];
		properties?: { sections?: Record<string, unknown> };
	};
	assert.deepEqual(providerSchema.required, ["paper"]);
	assert.equal(providerSchema.properties?.sections?.type, "array");
	assert.equal(providerSchema.properties?.sections?.uniqueItems, undefined);

	const validate = (arguments_: JsonObject) =>
		validateToolArguments(tool, {
			type: "toolCall",
			id: "typebox-regression",
			name: tool.name,
			arguments: arguments_,
		} satisfies ToolCall);

	assert.deepEqual(validate({ paper: "2401.00001" }), { paper: "2401.00001" });
	assert.deepEqual(validate({ paper: "2401.00001", sections: ["methodology", "results"] }), {
		paper: "2401.00001",
		sections: ["methodology", "results"],
	});
	assert.deepEqual(validate({ paper: "2401.00001", sections: null }), {
		paper: "2401.00001",
	});
	assert.throws(
		() => validate({ paper: "2401.00001", sections: "methodology" }),
		/Validation failed for tool "alpha_get_paper":[\s\S]*sections: must be array/,
	);
});
