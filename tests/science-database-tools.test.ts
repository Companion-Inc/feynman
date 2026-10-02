import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { registerScienceDatabaseTools } from "../extensions/research-tools/science-databases.js";

type Tool = {
	execute: (toolCallId: string, params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; details: unknown }>;
	name: string;
	promptGuidelines?: string[];
	promptSnippet?: string;
};

const originalFetch = globalThis.fetch;
const originalNcbiEmail = process.env.NCBI_EMAIL;

afterEach(() => {
	globalThis.fetch = originalFetch;
	if (originalNcbiEmail === undefined) delete process.env.NCBI_EMAIL;
	else process.env.NCBI_EMAIL = originalNcbiEmail;
});

function registerTools(): Map<string, Tool> {
	const tools = new Map<string, Tool>();
	registerScienceDatabaseTools({
		registerTool(tool: Tool) {
			tools.set(tool.name, tool);
		},
	} as never);
	return tools;
}

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

test("science database tool searches PubMed through ESearch and ESummary", async () => {
	process.env.NCBI_EMAIL = "research@example.edu";
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = String(input);
		requests.push(url);
		if (url.includes("/esearch.fcgi")) {
			return jsonResponse({
				esearchresult: {
					count: "2",
					idlist: ["123", "456"],
					querytranslation: "crispr cancer",
				},
			});
		}
		if (url.includes("/esummary.fcgi")) {
			return jsonResponse({
				result: {
					uids: ["123", "456"],
					"123": {
						uid: "123",
						title: "CRISPR screen in cancer.",
						fulljournalname: "Example Journal",
						pubdate: "2026 Jan",
						authors: [{ name: "Ada A" }, { name: "Turing T" }],
						articleids: [{ idtype: "doi", value: "10.1000/example" }],
						pubtype: ["Journal Article"],
					},
					"456": {
						uid: "456",
						title: "Second result.",
						source: "Nature",
						pubdate: "2025 Dec",
						authors: [],
					},
				},
			});
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tools = registerTools();
	const result = await tools.get("feynman_science_database_search")?.execute("call-1", {
		source: "pubmed",
		query: "CRISPR cancer",
		limit: 2,
		sort: "pub_date",
	});
	const details = result?.details as { results: Array<{ doi?: string; pmid: string; title: string }>; returned: number; source: string };

	assert.equal(tools.has("feynman_science_database_search"), true);
	assert.equal(details.source, "pubmed");
	assert.equal(details.returned, 2);
	assert.equal(details.results[0]?.pmid, "123");
	assert.equal(details.results[0]?.doi, "10.1000/example");
	assert.match(details.results[0]?.title ?? "", /CRISPR/);
	assert.equal(new URL(requests[0]!).searchParams.get("tool"), "feynman");
	assert.equal(new URL(requests[0]!).searchParams.get("email"), "research@example.edu");
	assert.equal(new URL(requests[0]!).searchParams.get("sort"), "pub_date");
	assert.equal(new URL(requests[1]!).searchParams.get("id"), "123,456");
	assert.match(tools.get("feynman_science_database_search")?.promptSnippet ?? "", /PubMed/);
});

test("science database tool searches literature sources and looks up arXiv IDs", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = String(input);
		requests.push(url);
		if (url.includes("api.crossref.org")) {
			return jsonResponse({
				message: {
					"total-results": 1,
					items: [{
						DOI: "10.1234/crossref",
						title: ["Crossref CRISPR metadata"],
						"container-title": ["Metadata Journal"],
						"published-online": { "date-parts": [[2026, 2, 3]] },
						author: [{ given: "Ada", family: "Lovelace" }],
						"is-referenced-by-count": 12,
						URL: "https://doi.org/10.1234/crossref",
						type: "journal-article",
					}],
				},
			});
		}
		if (url.includes("europepmc")) {
			return jsonResponse({
				hitCount: 1,
				nextCursorMark: "next",
				resultList: {
					result: [{
						id: "12345678",
						source: "MED",
						pmid: "12345678",
						pmcid: "PMC123456",
						doi: "10.1234/epmc",
						title: "Europe PMC CRISPR record",
						authorString: "Lovelace A",
						journalTitle: "Life Science Journal",
						pubYear: "2026",
						pubType: "research-article",
						citedByCount: "7",
						isOpenAccess: "Y",
						inPMC: "Y",
						hasReferences: "Y",
						hasTextMinedTerms: "Y",
					}],
				},
			});
		}
		if (url.includes("export.arxiv.org")) {
			return new Response([
				"<?xml version='1.0' encoding='UTF-8'?>",
				"<feed xmlns:opensearch='http://a9.com/-/spec/opensearch/1.1/' xmlns:arxiv='http://arxiv.org/schemas/atom' xmlns='http://www.w3.org/2005/Atom'>",
				"<opensearch:totalResults>1</opensearch:totalResults>",
				"<entry>",
				"<id>https://arxiv.org/abs/2601.01234v1</id>",
				"<title> arXiv CRISPR preprint </title>",
				"<summary> CRISPR preprint summary. </summary>",
				"<published>2026-01-02T00:00:00Z</published>",
				"<updated>2026-01-03T00:00:00Z</updated>",
				"<author><name>Ada Lovelace</name></author>",
				"<arxiv:primary_category term='q-bio.BM'/>",
				"<category term='q-bio.BM'/>",
				"<arxiv:doi>10.1234/arxiv</arxiv:doi>",
				"<arxiv:journal_ref>Preprint Journal</arxiv:journal_ref>",
				"<link href='https://arxiv.org/pdf/2601.01234v1' title='pdf' type='application/pdf'/>",
				"</entry>",
				"</feed>",
			].join(""), { status: 200, headers: { "content-type": "application/atom+xml" } });
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tools = registerTools();
	const crossref = await tools.get("feynman_science_database_search")?.execute("call-crossref", {
		source: "crossref",
		query: "crispr metadata",
		limit: 1,
	});
	const europepmc = await tools.get("feynman_science_database_search")?.execute("call-epmc", {
		source: "europepmc",
		query: "crispr",
		limit: 1,
	});
	const arxiv = await tools.get("feynman_science_database_search")?.execute("call-arxiv", {
		source: "arxiv",
		query: "2601.01234v1",
	});

	const crossrefDetails = crossref?.details as { results: Array<{ doi?: string; title?: string }> };
	const europePmcDetails = europepmc?.details as { hasMore: boolean; results: Array<{ pmcid?: string; pmid?: string; url?: string }> };
	const arxivDetails = arxiv?.details as { results: Array<{ id_versioned?: string; pdf_url?: string; primary_category?: string }> };

	assert.equal(crossrefDetails.results[0]?.doi, "10.1234/crossref");
	assert.equal(crossrefDetails.results[0]?.title, "Crossref CRISPR metadata");
	assert.equal(europePmcDetails.hasMore, true);
	assert.equal(europePmcDetails.results[0]?.pmid, "12345678");
	assert.equal(europePmcDetails.results[0]?.pmcid, "PMC123456");
	assert.equal(europePmcDetails.results[0]?.url, "https://europepmc.org/article/MED/12345678");
	assert.equal(arxivDetails.results[0]?.id_versioned, "2601.01234v1");
	assert.equal(arxivDetails.results[0]?.primary_category, "q-bio.BM");
	assert.equal(arxivDetails.results[0]?.pdf_url, "https://arxiv.org/pdf/2601.01234v1");
	assert.equal(new URL(requests[0]!).searchParams.get("rows"), "1");
	assert.equal(new URL(requests[1]!).searchParams.get("resultType"), "lite");
	assert.equal(new URL(requests[2]!).searchParams.get("id_list"), "2601.01234v1");
	assert.match(tools.get("feynman_science_database_search")?.promptSnippet ?? "", /Europe PMC/);
});

test("science database tool searches bioRxiv and medRxiv preprint sources", async () => {
	const requests: Array<{ body?: string; method: string; url: string }> = [];
	globalThis.fetch = async (input, init) => {
		const url = String(input);
		requests.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
		if (url.includes("api.biorxiv.org/details/biorxiv")) {
			return jsonResponse({
				collection: [{
					doi: "10.1101/2026.01.01.000001",
					title: "Kinase biology preprint",
					authors: "Lovelace A",
					date: "2026-01-02",
					version: "1",
					type: "new results",
					license: "cc_by",
					category: "cell biology",
					abstract: "A kinase biology study.",
					published: "NA",
				}],
			});
		}
		if (url.includes("api.biorxiv.org/details/medrxiv")) {
			return jsonResponse({
				collection: [{
					doi: "10.1101/2020.09.09.20191205",
					title: "Clinical preprint",
					authors: "Turing A",
					date: "2020-09-10",
					version: "2",
					type: "new results",
					license: "cc_by_nc_nd",
					category: "infectious diseases",
					abstract: "A clinical preprint.",
					published: "NA",
				}],
			});
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tools = registerTools();
	const biorxiv = await tools.get("feynman_science_database_search")?.execute("call-biorxiv", {
		source: "biorxiv",
		query: "kinase",
		limit: 1,
	});
	const medrxiv = await tools.get("feynman_science_database_search")?.execute("call-medrxiv", {
		source: "medrxiv",
		query: "10.1101/2020.09.09.20191205",
		limit: 1,
	});

	const biorxivDetails = biorxiv?.details as { results: Array<{ doi?: string; title?: string }>; searchMode: string };
	const medrxivDetails = medrxiv?.details as { results: Array<{ doi?: string; url?: string }>; searchMode: string };

	assert.equal(biorxivDetails.searchMode, "recent-60-day-filter");
	assert.equal(biorxivDetails.results[0]?.title, "Kinase biology preprint");
	assert.equal(medrxivDetails.searchMode, "doi");
	assert.equal(medrxivDetails.results[0]?.doi, "10.1101/2020.09.09.20191205");
	assert.match(tools.get("feynman_science_database_search")?.promptSnippet ?? "", /bioRxiv/);
});

test("Crossref requests run one at a time at the pool's pace", async () => {
	const { withCrossrefPacing } = await import("../extensions/research-tools/science-databases.js");
	const starts: number[] = [];
	let running = 0;
	let maxRunning = 0;
	const request = () => withCrossrefPacing(true, async () => {
		starts.push(Date.now());
		running += 1;
		maxRunning = Math.max(maxRunning, running);
		await new Promise((resolve) => setTimeout(resolve, 20));
		running -= 1;
	});
	await Promise.all([request(), request(), request()]);
	assert.equal(maxRunning, 1);
	for (let index = 1; index < starts.length; index += 1) {
		assert.ok(starts[index]! - starts[index - 1]! >= 390, `gap ${starts[index]! - starts[index - 1]!}ms`);
	}
});

test("a failed database request names the service that failed", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () => new Response("down", { status: 503, statusText: "Service Temporarily Unavailable" })) as typeof fetch;
	try {
		const tools = new Map<string, { execute: (id: string, params: Record<string, unknown>) => Promise<unknown> }>();
		registerScienceDatabaseTools({ registerTool: (tool: { name: string; execute: never }) => tools.set(tool.name, tool), on: () => () => {} } as never);
		await assert.rejects(
			tools.get("feynman_science_database_search")!.execute("x", { source: "europepmc", query: "crispr" }),
			/www\.ebi\.ac\.uk request failed: 503 Service Temporarily Unavailable/,
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("science search accepts the \"null\" some models send for omitted optional fields", async () => {
	const { validateToolArguments } = await import("@earendil-works/pi-ai");
	const tools = new Map<string, { prepareArguments: (args: unknown) => unknown; parameters: unknown; name: string }>();
	registerScienceDatabaseTools({ registerTool: (tool: never) => tools.set((tool as { name: string }).name, tool), on: () => () => {} } as never);
	const tool = tools.get("feynman_science_database_search")!;
	const validate = (args: Record<string, unknown>) =>
		validateToolArguments(tool as never, { type: "toolCall", id: "t", name: tool.name, arguments: tool.prepareArguments(args) as never });

	assert.deepEqual(validate({ source: "openalex", query: "x", sort: "null" }), { source: "openalex", query: "x" });
	assert.deepEqual(validate({ source: "pubmed", query: "x", sort: " Relevance ", limit: "5" }), { source: "pubmed", query: "x", sort: "relevance", limit: 5 });
	assert.throws(() => validate({ source: "pubmed", query: "x", sort: "newest" }), /sort/);
});

test("arXiv lookups are paced three seconds apart and a 429 is retried once", async (t) => {
	const { ARXIV_MIN_GAP_MS } = await import("../extensions/research-tools/science-database-arxiv.js");
	assert.equal(ARXIV_MIN_GAP_MS, 3000);
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const originalFetch = globalThis.fetch;
	const starts: number[] = [];
	globalThis.fetch = (async () => {
		starts.push(starts.length);
		if (starts.length === 1) return new Response("", { status: 429, statusText: "Unknown Error" });
		return new Response("<feed xmlns='http://www.w3.org/2005/Atom'></feed>");
	}) as typeof fetch;
	try {
		const tools = new Map<string, { execute: (id: string, params: Record<string, unknown>) => Promise<unknown> }>();
		registerScienceDatabaseTools({ registerTool: (tool: { name: string; execute: never }) => tools.set(tool.name, tool), on: () => () => {} } as never);
		const pending = tools.get("feynman_science_database_search")!.execute("ax", { source: "arxiv", query: "2309.08600" });
		for (let i = 0; i < 20 && starts.length < 2; i += 1) {
			await new Promise((resolve) => setImmediate(resolve));
			t.mock.timers.tick(ARXIV_MIN_GAP_MS);
		}
		await pending;
		assert.equal(starts.length, 2);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
