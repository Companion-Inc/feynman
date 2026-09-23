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

test("science database tool searches public literature and DOI metadata sources", async () => {
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
		query: "crispr",
		limit: 1,
		sort: "pub_date",
	});

	const crossrefDetails = crossref?.details as { results: Array<{ doi?: string; title?: string }> };
	const europePmcDetails = europepmc?.details as { hasMore: boolean; results: Array<{ pmcid?: string; pmid?: string; url?: string }> };
	const arxivDetails = arxiv?.details as { results: Array<{ arxivId?: string; pdfUrl?: string; primaryCategory?: string }> };

	assert.equal(crossrefDetails.results[0]?.doi, "10.1234/crossref");
	assert.equal(crossrefDetails.results[0]?.title, "Crossref CRISPR metadata");
	assert.equal(europePmcDetails.hasMore, true);
	assert.equal(europePmcDetails.results[0]?.pmid, "12345678");
	assert.equal(europePmcDetails.results[0]?.pmcid, "PMC123456");
	assert.equal(europePmcDetails.results[0]?.url, "https://europepmc.org/article/MED/12345678");
	assert.equal(arxivDetails.results[0]?.arxivId, "2601.01234v1");
	assert.equal(arxivDetails.results[0]?.primaryCategory, "q-bio.BM");
	assert.equal(arxivDetails.results[0]?.pdfUrl, "https://arxiv.org/pdf/2601.01234v1");
	assert.equal(new URL(requests[0]!).searchParams.get("rows"), "1");
	assert.equal(new URL(requests[1]!).searchParams.get("resultType"), "lite");
	assert.equal(new URL(requests[2]!).searchParams.get("sortBy"), "submittedDate");
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
