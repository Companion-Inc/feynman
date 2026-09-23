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
const originalOpenAlexApiKey = process.env.OPENALEX_API_KEY;

afterEach(() => {
	globalThis.fetch = originalFetch;
	if (originalOpenAlexApiKey === undefined) delete process.env.OPENALEX_API_KEY;
	else process.env.OPENALEX_API_KEY = originalOpenAlexApiKey;
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

function work(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: "https://openalex.org/W2064815984",
		doi: "https://doi.org/10.1038/nbt.3199",
		title: "CRISPR base editing in mammalian cells",
		publication_year: 2016,
		publication_date: "2016-04-20",
		type: "article",
		language: "en",
		is_retracted: false,
		authorships: [{
			author_position: "first",
			is_corresponding: true,
			author: {
				id: "https://openalex.org/A5065535610",
				display_name: "Jennifer Doudna",
				orcid: "https://orcid.org/0000-0001-0000-0000",
			},
			institutions: [{ display_name: "University of California, Berkeley" }],
		}],
		primary_location: {
			license: "cc-by",
			source: {
				id: "https://openalex.org/S106963461",
				display_name: "Nature Biotechnology",
				issn_l: "1087-0156",
				type: "journal",
			},
		},
		best_oa_location: { license: "cc-by", pdf_url: "https://example.org/paper.pdf" },
		open_access: { is_oa: true, oa_status: "gold", oa_url: "https://example.org/paper" },
		primary_topic: { display_name: "Genome editing" },
		keywords: [{ display_name: "CRISPR" }],
		cited_by_count: 1200,
		fwci: 9.1,
		referenced_works_count: 1,
		referenced_works: ["https://openalex.org/WREF1"],
		counts_by_year: [{ year: 2025, cited_by_count: 100 }],
		abstract_inverted_index: { CRISPR: [0], edits: [1], cells: [2] },
		...overrides,
	};
}

function author(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: "https://openalex.org/A5065535610",
		display_name: "Jennifer Doudna",
		orcid: "https://orcid.org/0000-0001-0000-0000",
		works_count: 500,
		cited_by_count: 100000,
		summary_stats: { h_index: 160, i10_index: 400 },
		last_known_institutions: [{ display_name: "University of California, Berkeley" }],
		topics: [{ display_name: "Genome editing" }],
		...overrides,
	};
}

function source(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: "https://openalex.org/S106963461",
		display_name: "Nature Biotechnology",
		issn_l: "1087-0156",
		issn: ["1087-0156", "1546-1696"],
		type: "journal",
		works_count: 100000,
		cited_by_count: 5000000,
		summary_stats: { h_index: 500, i10_index: 20000 },
		is_oa: false,
		homepage_url: "https://www.nature.com/nbt/",
		...overrides,
	};
}

test("science database tool exposes OpenAlex works, graph, authors, sources, and key redaction", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		requests.push(url.toString());
		assert.equal(url.origin, "https://api.openalex.org");
		if (url.pathname === "/works" && url.searchParams.get("search") === "CRISPR base editing") {
			assert.equal(url.searchParams.get("sort"), "relevance_score:desc");
			assert.equal(url.searchParams.get("per-page"), "2");
			return jsonResponse({ meta: { count: 2 }, results: [work()] });
		}
		if (url.pathname === "/works" && url.searchParams.get("filter") === "doi:10.1038/nbt.3199") {
			assert.equal(url.searchParams.get("sort"), "cited_by_count:desc");
			assert.equal(url.searchParams.get("per-page"), "20");
			return jsonResponse({
				meta: { count: 2 },
				results: [
					work({ cited_by_count: 1200 }),
					work({ id: "https://openalex.org/WLOW", title: "Duplicate DOI claimant", cited_by_count: 2 }),
				],
			});
		}
		if (url.pathname === "/works" && url.searchParams.get("filter") === "cites:W2064815984") {
			return jsonResponse({ meta: { count: 1 }, results: [work({ id: "https://openalex.org/WCITER", title: "A citing work" })] });
		}
		if (url.pathname === "/works/W2064815984") {
			assert.equal(url.searchParams.get("select"), "id,referenced_works");
			return jsonResponse({ id: "https://openalex.org/W2064815984", referenced_works: ["https://openalex.org/WREF1"] });
		}
		if (url.pathname === "/works" && url.searchParams.get("filter") === "openalex:WREF1") {
			assert.equal(url.searchParams.get("per-page"), "1");
			return jsonResponse({ meta: { count: 1 }, results: [work({ id: "https://openalex.org/WREF1", title: "Referenced work" })] });
		}
		if (url.pathname === "/authors" && url.searchParams.get("search") === "Jennifer Doudna") {
			return jsonResponse({ meta: { count: 1 }, results: [author()] });
		}
		if (url.pathname === "/authors/A5065535610") {
			return jsonResponse(author());
		}
		if (url.pathname === "/sources" && url.searchParams.get("search") === "Nature Biotechnology") {
			return jsonResponse({ meta: { count: 1 }, results: [source()] });
		}
		if (url.pathname === "/sources/S106963461") {
			return jsonResponse(source());
		}
		if (url.pathname === "/rate-limit") {
			return jsonResponse({ rate_limit: { daily_remaining_usd: 0.95 } });
		}
		throw new Error(`unexpected URL ${url.toString()}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	const search = await tool?.execute("call-openalex-search", { source: "openalex", query: "CRISPR base editing", limit: 2 });
	const detail = await tool?.execute("call-openalex-detail", { source: "openalex", query: "doi:10.1038/nbt.3199", limit: 1 });
	const citations = await tool?.execute("call-openalex-citations", { source: "openalex", query: "citations:W2064815984", limit: 1 });
	const references = await tool?.execute("call-openalex-references", { source: "openalex", query: "references:W2064815984", limit: 1 });
	const authorSearch = await tool?.execute("call-openalex-author-search", { source: "openalex", query: "authors:Jennifer Doudna", limit: 1 });
	const authorDetail = await tool?.execute("call-openalex-author-detail", { source: "openalex", query: "author:A5065535610", limit: 1 });
	const sourceSearch = await tool?.execute("call-openalex-source-search", { source: "openalex", query: "sources:Nature Biotechnology", limit: 1 });
	const sourceDetail = await tool?.execute("call-openalex-source-detail", { source: "openalex", query: "source:S106963461", limit: 1 });
	const rateLimit = await tool?.execute("call-openalex-rate-limit", { source: "openalex", query: "rate-limit", limit: 1 });

	const searchDetails = search?.details as { anonymousBudgetWarning?: string; credentialStatus: string; results: Array<{ openalexId: string; source: { sourceId: string }; authors: Array<{ authorId: string; orcid: string }> }> };
	const detailDetails = detail?.details as { doiClaimants: Array<{ openalexId: string; citedByCount: number }>; doiResolutionNote: string; results: Array<{ abstract: string; referencedWorks: string[] }> };
	const citationDetails = citations?.details as { mode: string; results: Array<{ openalexId: string; title: string }> };
	const referenceDetails = references?.details as { mode: string; referenceIds: string[]; results: Array<{ openalexId: string; title: string }> };
	const authorSearchDetails = authorSearch?.details as { mode: string; results: Array<{ authorId: string; name: string }> };
	const authorDetailDetails = authorDetail?.details as { mode: string; results: Array<{ authorId: string; hIndex: number }> };
	const sourceSearchDetails = sourceSearch?.details as { mode: string; results: Array<{ sourceId: string; displayName: string }> };
	const sourceDetailDetails = sourceDetail?.details as { mode: string; results: Array<{ sourceId: string; issnL: string }> };
	const rateLimitDetails = rateLimit?.details as { error: string; mode: string; returned: number; results: Array<Record<string, unknown>> };

	assert.match(searchDetails.credentialStatus, /^OPENALEX_API_KEY missing\. Get a free OpenAlex API key at https:\/\/openalex\.org\/settings\/api/);
	assert.match(searchDetails.anonymousBudgetWarning ?? "", /OPENALEX_API_KEY/);
	assert.equal(searchDetails.results[0]?.openalexId, "W2064815984");
	assert.equal(searchDetails.results[0]?.source.sourceId, "S106963461");
	assert.equal(searchDetails.results[0]?.authors[0]?.authorId, "A5065535610");
	assert.equal(searchDetails.results[0]?.authors[0]?.orcid, "https://orcid.org/0000-0001-0000-0000");
	assert.equal(detailDetails.doiClaimants.length, 2);
	assert.equal(detailDetails.doiClaimants[0]?.openalexId, "W2064815984");
	assert.match(detailDetails.doiResolutionNote, /selected the most-cited claimant W2064815984/);
	assert.equal(detailDetails.results[0]?.abstract, "CRISPR edits cells");
	assert.deepEqual(detailDetails.results[0]?.referencedWorks, ["WREF1"]);
	assert.equal(citationDetails.mode, "citations");
	assert.equal(citationDetails.results[0]?.openalexId, "WCITER");
	assert.equal(referenceDetails.mode, "references");
	assert.deepEqual(referenceDetails.referenceIds, ["WREF1"]);
	assert.equal(referenceDetails.results[0]?.title, "Referenced work");
	assert.equal(authorSearchDetails.mode, "author-search");
	assert.equal(authorSearchDetails.results[0]?.authorId, "A5065535610");
	assert.equal(authorDetailDetails.mode, "author-detail");
	assert.equal(authorDetailDetails.results[0]?.hIndex, 160);
	assert.equal(sourceSearchDetails.mode, "source-search");
	assert.equal(sourceSearchDetails.results[0]?.displayName, "Nature Biotechnology");
	assert.equal(sourceDetailDetails.mode, "source-detail");
	assert.equal(sourceDetailDetails.results[0]?.issnL, "1087-0156");
	assert.equal(rateLimitDetails.mode, "rate-limit");
	assert.equal(rateLimitDetails.error, "openalex_key_required");
	assert.equal(rateLimitDetails.returned, 0);
	assert.ok(requests.every((url) => !url.includes("api_key=")));
	assert.match(tool?.promptSnippet ?? "", /OpenAlex/);
	assert.match(tool?.promptGuidelines?.join("\n") ?? "", /OpenAlex W\/A\/S IDs/);

	process.env.OPENALEX_API_KEY = "secret-key";
	const keyed = await tool?.execute("call-openalex-keyed", { source: "openalex", query: "CRISPR base editing", limit: 2 });
	const keyedDetails = keyed?.details as { credentialStatus: string; provenance: { endpoints: string[] } };
	assert.equal(keyedDetails.credentialStatus, "OPENALEX_API_KEY present");
	assert.equal(requests.at(-1)?.includes("api_key=secret-key"), true);
	assert.equal(keyedDetails.provenance.endpoints[0]?.includes("secret-key"), false);
	assert.equal(keyedDetails.provenance.endpoints[0]?.includes("%5Bredacted%5D"), true);
	const keyedRateLimit = await tool?.execute("call-openalex-keyed-rate-limit", { source: "openalex", query: "rate-limit", limit: 1 });
	const keyedRateLimitDetails = keyedRateLimit?.details as { credentialStatus: string; provenance: { endpoints: string[] }; results: Array<Record<string, unknown>> };
	assert.equal(keyedRateLimitDetails.credentialStatus, "OPENALEX_API_KEY present");
	assert.equal(requests.at(-1)?.includes("api_key=secret-key"), true);
	assert.equal(keyedRateLimitDetails.provenance.endpoints[0]?.includes("secret-key"), false);
	assert.deepEqual(keyedRateLimitDetails.results[0]?.rate_limit, { daily_remaining_usd: 0.95 });
});

test("OpenAlex semantic mode sends search.semantic without a sort and keeps the key out of provenance", async () => {
	process.env.OPENALEX_API_KEY = "secret-key";
	const requests: URL[] = [];
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		requests.push(url);
		return jsonResponse({
			meta: { count: 50 },
			results: [work({ id: "https://openalex.org/W4406492615", title: "Scaling LLM Test-Time Compute Optimally can be More Effective than Scaling Model Parameters" })],
		});
	};

	const result = await registerTools().get("feynman_science_database_search")?.execute("call-openalex-semantic", {
		source: "openalex",
		query: "semantic: spending more inference compute instead of a bigger model year_from=2024",
		limit: 3,
	});
	const details = result?.details as { mode: string; sort: string; results: Array<{ openalexId?: string }>; provenance: { endpoints: string[] } };

	assert.equal(requests[0]?.searchParams.get("search.semantic"), "spending more inference compute instead of a bigger model");
	assert.equal(requests[0]?.searchParams.has("search"), false);
	assert.equal(requests[0]?.searchParams.has("sort"), false);
	assert.equal(requests[0]?.searchParams.get("filter"), "publication_year:>2023");
	assert.equal(requests[0]?.searchParams.get("api_key"), "secret-key");
	assert.equal(details.mode, "work-semantic-search");
	assert.equal(details.sort, "semantic");
	assert.equal(details.results[0]?.openalexId, "W4406492615");
	assert.equal(details.provenance.endpoints[0]?.includes("secret-key"), false);
});

test("OpenAlex failures without a key explain how to get a free key", async () => {
	delete process.env.OPENALEX_API_KEY;
	globalThis.fetch = async () => new Response("Anonymous search is temporarily rate-limited", { status: 429, statusText: "Too Many Requests" });

	await assert.rejects(
		registerTools().get("feynman_science_database_search")!.execute("call-openalex-429", { source: "openalex", query: "sparse autoencoders" }),
		/429 Too Many Requests\. Anonymous search is temporarily rate-limited Get a free OpenAlex API key at https:\/\/openalex\.org\/settings\/api and set OPENALEX_API_KEY/,
	);
	await assert.rejects(
		registerTools().get("feynman_science_database_search")!.execute("call-openalex-exact-429", { source: "openalex", query: "openalex_search_works:sparse autoencoders" }),
		/openalex\.org\/settings\/api/,
	);
});
