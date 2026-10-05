import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerAlphaTools } from "../extensions/research-tools/alpha.js";

type AlphaTool = { execute: (id: string, params: Record<string, unknown>) => Promise<{ details: Record<string, unknown> }> };

test("alphaXiv tools answer from OpenAlex and arXiv when alphaXiv does not answer", async (t) => {
	// No ~/.ahub login in this home, so every alphaXiv call fails with "Not logged in".
	const home = mkdtempSync(join(tmpdir(), "feynman-alpha-fallback-"));
	const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, fetch: globalThis.fetch };
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	globalThis.fetch = (async (input: string | URL | Request) => {
		const url = new URL(String(input));
		if (url.hostname === "api.openalex.org") {
			return Response.json({ meta: { count: 1 }, results: [{ id: "https://openalex.org/W1", title: "Sparse Autoencoders Find Highly Interpretable Features", authorships: [] }] });
		}
		if (url.hostname === "export.arxiv.org") {
			return new Response(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2309.08600v3</id><title>Sparse Autoencoders Find Highly Interpretable Features in Language Models</title><summary>We use sparse autoencoders.</summary><published>2023-09-15T00:00:00Z</published><author><name>Hoagy Cunningham</name></author></entry></feed>`);
		}
		throw new Error(`unexpected request ${url}`);
	}) as typeof fetch;
	t.after(() => {
		process.env.HOME = saved.HOME;
		process.env.USERPROFILE = saved.USERPROFILE;
		globalThis.fetch = saved.fetch;
	});

	const tools = new Map<string, AlphaTool>();
	registerAlphaTools({ registerTool: (tool: { name: string }) => tools.set(tool.name, tool as unknown as AlphaTool), on: () => () => {} } as unknown as ExtensionAPI, true);

	const search = await tools.get("alpha_search")!.execute("s", { query: "sparse autoencoders interpretability" });
	assert.match(String(search.details.fallbackNote), /^alphaXiv did not answer \(Not logged in.*\); these results are from OpenAlex semantic search\.$/);
	assert.ok(Array.isArray(search.details.results));

	const paper = await tools.get("alpha_get_paper")!.execute("p", { paper: "https://arxiv.org/abs/2309.08600", section: "methodology" });
	assert.match(String(paper.details.fallbackNote), /these results are from arXiv metadata and abstract/);
	assert.match(JSON.stringify(paper.details), /Sparse Autoencoders Find Highly Interpretable Features in Language Models/);

	const asked = await tools.get("alpha_ask_paper")!.execute("a", { paper: "2309.08600", question: "What dictionary size works best?" });
	assert.match(String(asked.details.fallbackNote), /the question was not answered/);
	assert.match(JSON.stringify(asked.details), /We use sparse autoencoders\./);

	await assert.rejects(tools.get("alpha_get_paper")!.execute("q", { paper: "not-an-arxiv-id" }), /alphaXiv did not answer this call/);
});
