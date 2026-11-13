import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { registerScienceDatabaseTools } from "../extensions/research-tools/science-databases.js";

type Tool = {
	name: string;
	execute: (id: string, params: Record<string, unknown>) => Promise<{ details: unknown }>;
};
type Article = {
	title?: string;
	abstract?: string;
	sections: Array<{ title: string; textSnippet: string }>;
	figureCaptions?: Array<{ caption: string }>;
	tableCaptions?: Array<{ caption: string }>;
	nFigures?: number;
	nTables?: number;
	nReferences?: number;
};
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

async function fulltext(source: string, xml: string): Promise<Article> {
	globalThis.fetch = async (input) => {
		const url = String(input);
		if (url.includes("/search?")) return Response.json({ resultList: { result: [{ pmcid: "PMC123", isOpenAccess: "Y" }] } });
		assert.ok(url.endsWith("/PMC123/fullTextXML"));
		return new Response(xml);
	};
	const tools = new Map<string, Tool>();
	registerScienceDatabaseTools({ registerTool: (tool: Tool) => tools.set(tool.name, tool) } as never);
	const result = await tools.get("feynman_science_database_search")!.execute("jats-test", {
		source, query: "fulltext:PMC123", limit: 1,
	});
	return (result.details as { results: Article[] }).results[0]!;
}

for (const source of ["pubmed", "europepmc"]) {
	for (const [markup, expected] of [
		["Effects of <italic>BRCA1</italic> mutation.", "Effects of BRCA1 mutation."],
		["H<sub>2</sub>O and 10<sup>2</sup> samples.", "H2O and 102 samples."],
		["A<italic>X</italic>B<italic>Y</italic>C", "AXBYC"],
		["The <italic>BRCA<bold>1</bold></italic> &amp; <italic>BRCA2</italic> genes.", "The BRCA1 & BRCA2 genes."],
		[" 001 ", "001"],
	]) {
		test(`${source} full text preserves inline order: ${markup}`, async () => {
			const article = await fulltext(source, `<article><front><article-meta><title-group><article-title>${markup}</article-title></title-group><abstract><p>${markup}</p><p>Next paragraph.</p></abstract></article-meta></front><body><sec><title>${markup}</title><p>${markup}</p><p>Next paragraph.</p></sec></body></article>`);
			assert.equal(article.title, expected);
			assert.equal(article.abstract, `${expected} Next paragraph.`);
			assert.equal(article.sections[0]?.title, expected);
			assert.equal(article.sections[0]?.textSnippet, `${expected} ${expected} Next paragraph.`);
		});
	}
}

test("Europe PMC keeps ordered captions separate from section snippets", async () => {
	const article = await fulltext("europepmc", `<article><front><article-meta><title-group><article-title>Title</article-title></title-group></article-meta></front><body><sec><title>Results</title><p>Before <italic>gene</italic> result.</p><fig id="f1"><label>Figure 1</label><caption><p>A<italic>X</italic>B</p><p>Next.</p></caption></fig><p>After result.</p><table-wrap id="t1"><caption><p>H<sub>2</sub>O</p></caption></table-wrap></sec></body><back><ref-list><ref id="r1"/></ref-list></back></article>`);
	assert.equal(article.sections[0]?.textSnippet, "Results Before gene result. After result.");
	assert.equal(article.figureCaptions?.[0]?.caption, "AXB Next.");
	assert.equal(article.tableCaptions?.[0]?.caption, "H2O");
	assert.equal(article.nFigures, 1);
	assert.equal(article.nTables, 1);
	assert.equal(article.nReferences, 1);
});

for (const source of ["pubmed", "europepmc"]) {
	test(`${source} keeps section and abstract snippet bounds`, async () => {
		const paragraph = `A<italic>X</italic>B ${"word ".repeat(700)}`;
		const article = await fulltext(source, `<article><front><article-meta><title-group><article-title>Plain title</article-title></title-group><abstract><p>${paragraph}</p></abstract></article-meta></front><body>${Array.from({ length: 12 }, (_, index) => `<sec><title>Section ${index + 1}</title><p>${paragraph}</p></sec>`).join("")}</body></article>`);
		assert.equal(article.title, "Plain title");
		assert.ok(article.abstract?.startsWith("AXB word "));
		assert.ok(article.abstract!.length <= 2_003);
		assert.ok(article.abstract?.endsWith("..."));
		assert.equal(article.sections.length, 10);
		assert.ok(article.sections[0]!.textSnippet.startsWith("Section 1 AXB word "));
		assert.ok(article.sections.every((section) => section.textSnippet.length <= 1_203 && section.textSnippet.endsWith("...")));
	});
}

test("Europe PMC pairs caption IDs with their own text across nested sections", async () => {
	const figure = (id: number) => `<fig id="f${id}"><label>Figure ${id}</label><caption><p>Caption <italic>${id}</italic>.</p></caption></fig>`;
	const table = (id: number) => `<table-wrap id="t${id}"><label>Table ${id}</label><caption><p>Table <italic>${id}</italic>.</p></caption></table-wrap>`;
	const article = await fulltext("europepmc", `<article><body><sec><title>Results</title>${figure(1)}${table(1)}<sec><title>Nested</title>${figure(2)}${table(2)}</sec>${figure(3)}${table(3)}</sec></body></article>`);
	assert.deepEqual(article.figureCaptions, [1, 2, 3].map((id) => ({ id: `f${id}`, label: `Figure ${id}`, caption: `Caption ${id}.` })));
	assert.deepEqual(article.tableCaptions, [1, 2, 3].map((id) => ({ id: `t${id}`, label: `Table ${id}`, caption: `Table ${id}.` })));
	assert.equal(article.nFigures, 3);
	assert.equal(article.nTables, 3);
});
