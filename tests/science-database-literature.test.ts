import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { registerScienceDatabaseTools } from "../extensions/research-tools/science-databases.js";

type Tool = {
	execute: (toolCallId: string, params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; details: unknown }>;
	name: string;
};

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
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

function atomResponse(entries: string, total = 1, start = 0): Response {
	return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
	xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"
	xmlns:arxiv="http://arxiv.org/schemas/atom">
	<opensearch:totalResults>${total}</opensearch:totalResults>
	<opensearch:startIndex>${start}</opensearch:startIndex>
	${entries}
</feed>`, {
		status: 200,
		headers: { "content-type": "application/atom+xml" },
	});
}

function arxivEntry(id = "2309.08600v1"): string {
	return `<entry>
		<id>http://arxiv.org/abs/${id}</id>
		<title>Sparse Autoencoders Find Highly Interpretable Features</title>
		<summary> Sparse autoencoders reveal features. </summary>
		<author><name>Bricken</name></author>
		<published>2023-09-15T00:00:00Z</published>
		<updated>2023-09-15T00:00:00Z</updated>
		<arxiv:primary_category term="cs.LG" />
		<category term="cs.LG" />
		<arxiv:doi>10.48550/arXiv.2309.08600</arxiv:doi>
		<arxiv:journal_ref>Test Journal</arxiv:journal_ref>
		<arxiv:comment>12 pages</arxiv:comment>
		<link title="pdf" type="application/pdf" href="http://arxiv.org/pdf/${id}" />
	</entry>`;
}

function work(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: "https://openalex.org/W4386839891",
		doi: "https://doi.org/10.48550/arxiv.2309.08600",
		title: "Sparse Autoencoders Find Highly Interpretable Features",
		publication_year: 2023,
		publication_date: "2023-09-15",
		type: "preprint",
		language: "en",
		authorships: [{
			author_position: "first",
			is_corresponding: true,
			author: { id: "https://openalex.org/A5065535610", display_name: "Author One", orcid: "https://orcid.org/0000-0001" },
			institutions: [{ display_name: "Anthropic" }],
		}],
		primary_location: {
			license: "cc-by",
			source: { id: "https://openalex.org/S4306402512", display_name: "arXiv", issn_l: "2331-8422", type: "repository" },
		},
		best_oa_location: { license: "cc-by", pdf_url: "https://arxiv.org/pdf/2309.08600" },
		open_access: { is_oa: true, oa_status: "green", oa_url: "https://arxiv.org/abs/2309.08600" },
		primary_topic: { display_name: "Machine learning" },
		keywords: [{ display_name: "interpretability" }],
		cited_by_count: 100,
		referenced_works_count: 1,
		referenced_works: ["https://openalex.org/WREF1"],
		counts_by_year: [{ year: 2025, cited_by_count: 30 }],
		abstract_inverted_index: { Sparse: [0], autoencoders: [1], work: [2] },
		...overrides,
	};
}

function author(): Record<string, unknown> {
	return {
		id: "https://openalex.org/A5065535610",
		display_name: "Author One",
		orcid: "https://orcid.org/0000-0001",
		works_count: 12,
		cited_by_count: 345,
		summary_stats: { h_index: 8, i10_index: 6 },
		last_known_institutions: [{ display_name: "Anthropic" }],
		topics: [{ display_name: "Mechanistic interpretability" }],
		counts_by_year: [{ year: 2025, cited_by_count: 20 }],
	};
}

function source(): Record<string, unknown> {
	return {
		id: "https://openalex.org/S4306402512",
		display_name: "arXiv",
		issn_l: "2331-8422",
		issn: ["2331-8422"],
		type: "repository",
		works_count: 2000000,
		cited_by_count: 30000000,
		summary_stats: { h_index: 600, i10_index: 90000 },
		is_oa: true,
		homepage_url: "https://arxiv.org/",
		counts_by_year: [{ year: 2025, works_count: 100000 }],
	};
}

test("science database tool exposes exact literature parity names for OpenAlex and arXiv", async () => {
	const seen: string[] = [];
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		seen.push(url.toString());
		if (url.origin === "https://api.openalex.org") {
			if (url.pathname === "/works/W4386839891") return jsonResponse(work());
			if (url.pathname === "/authors/A5065535610") return jsonResponse(author());
			if (url.pathname === "/sources/S4306402512") return jsonResponse(source());
			if (url.pathname === "/works" && url.searchParams.get("search") === "sparse autoencoders") {
				assert.equal(url.searchParams.get("filter"), "publication_year:2023-2024,open_access.is_oa:true");
				return jsonResponse({ meta: { count: 1 }, results: [work()] });
			}
			if (url.pathname === "/works" && url.searchParams.get("filter") === "cites:W4386839891") {
				return jsonResponse({ meta: { count: 1 }, results: [work({ id: "https://openalex.org/WCITER", title: "Citing work" })] });
			}
			if (url.pathname === "/works" && url.searchParams.get("filter") === "openalex:WREF1") {
				return jsonResponse({ meta: { count: 1 }, results: [work({ id: "https://openalex.org/WREF1", title: "Reference work" })] });
			}
			if (url.pathname === "/authors" && url.searchParams.get("search") === "Author One") {
				return jsonResponse({ meta: { count: 1 }, results: [author()] });
			}
			if (url.pathname === "/works" && url.searchParams.get("filter") === "author.id:A5065535610") {
				return jsonResponse({ meta: { count: 1 }, results: [work()] });
			}
		}
		if (url.origin === "https://export.arxiv.org") {
			assert.equal(url.searchParams.has("search_query"), false);
			if (url.searchParams.get("id_list") === "2309.08600,2309.08600v1") {
				return atomResponse(arxivEntry("2309.08600v1"), 1, 0);
			}
			if (url.searchParams.get("id_list") === "2309.08600") {
				return atomResponse(arxivEntry(), 1, 0);
			}
		}
		throw new Error(`unexpected URL ${url.toString()}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	assert.ok(tool);

	const searchWorks = await tool.execute("openalex-search-works", {
		source: "openalex",
		query: "openalex_search_works:sparse autoencoders year_from=2023 year_to=2024 open_access_only=true max_records=5",
	});
	const getWork = await tool.execute("openalex-get-work", { source: "openalex", query: "openalex_get_work:W4386839891" });
	const citations = await tool.execute("openalex-citations", { source: "openalex", query: "openalex_citations:W4386839891 max_records=2" });
	const references = await tool.execute("openalex-references", { source: "openalex", query: "openalex_references:W4386839891 max_records=2" });
	const searchAuthors = await tool.execute("openalex-search-authors", { source: "openalex", query: "openalex_search_authors:Author One" });
	const getAuthor = await tool.execute("openalex-get-author", { source: "openalex", query: "openalex_get_author:A5065535610 works_sample=1" });
	const venueInfo = await tool.execute("openalex-venue-info", { source: "openalex", query: "openalex_venue_info:S4306402512" });
	const arxivBareId = await tool.execute("arxiv-bare-id", { source: "arxiv", query: "https://arxiv.org/abs/2309.08600" });
	const arxivGet = await tool.execute("arxiv-get-papers", { source: "arxiv", query: "arxiv_get_papers:2309.08600,2309.08600v1" });

	const searchDetails = searchWorks.details as { mode: string; records: Array<{ openalex_id: string; source: { source_id: string } }> };
	const workDetails = getWork.details as { mode: string; abstract: string; referenced_works: string[] };
	const citationDetails = citations.details as { mode: string; records: Array<{ openalex_id: string }> };
	const referenceDetails = references.details as { mode: string; reference_ids: string[]; records: Array<{ openalex_id: string }> };
	const authorSearchDetails = searchAuthors.details as { mode: string; records: Array<{ author_id: string; h_index: number }> };
	const authorDetails = getAuthor.details as { mode: string; top_works: Array<{ openalex_id: string }> };
	const venueDetails = venueInfo.details as { mode: string; source_id: string; records: Array<{ display_name: string }> };
	const arxivBareIdDetails = arxivBareId.details as { mode: string; records: Array<{ arxiv_id: string; version: number; doi: string; abstract: string }> };
	const arxivGetDetails = arxivGet.details as { mode: string; duplicates: Array<Record<string, unknown>>; n_found: number; records: Array<{ arxiv_id: string }> };

	assert.equal(searchDetails.mode, "openalex_search_works");
	assert.equal(searchDetails.records[0]?.openalex_id, "W4386839891");
	assert.equal(searchDetails.records[0]?.source.source_id, "S4306402512");
	assert.equal(workDetails.abstract, "Sparse autoencoders work");
	assert.deepEqual(workDetails.referenced_works, ["WREF1"]);
	assert.equal(citationDetails.records[0]?.openalex_id, "WCITER");
	assert.deepEqual(referenceDetails.reference_ids, ["WREF1"]);
	assert.equal(referenceDetails.records[0]?.openalex_id, "WREF1");
	assert.equal(authorSearchDetails.records[0]?.author_id, "A5065535610");
	assert.equal(authorSearchDetails.records[0]?.h_index, 8);
	assert.equal(authorDetails.top_works[0]?.openalex_id, "W4386839891");
	assert.equal(venueDetails.source_id, "S4306402512");
	assert.equal(venueDetails.records[0]?.display_name, "arXiv");
	assert.equal(arxivBareIdDetails.mode, "arxiv_get_papers");
	assert.equal(arxivBareIdDetails.records[0]?.arxiv_id, "2309.08600");
	assert.equal(arxivBareIdDetails.records[0]?.version, 1);
	assert.equal(arxivBareIdDetails.records[0]?.abstract, "Sparse autoencoders reveal features.");
	assert.equal(arxivGetDetails.n_found, 1);
	assert.deepEqual(arxivGetDetails.duplicates, [{ requested: "2309.08600v1", resolved_as: "2309.08600" }]);
	assert.ok(seen.some((url) => url.includes("openalex_search_works")) === false);
});

test("arxiv source rejects topic search and points to the discovery sources", async () => {
	globalThis.fetch = async (input) => {
		throw new Error(`unexpected URL ${String(input)}`);
	};
	const tool = registerTools().get("feynman_science_database_search");
	assert.ok(tool);

	await assert.rejects(
		tool.execute("arxiv-topic", { source: "arxiv", query: "sparse autoencoders interpretability" }),
		/only looks up papers by ID; search topics with source semanticscholar or openalex/,
	);
	await assert.rejects(
		tool.execute("arxiv-search-command", { source: "arxiv", query: "arxiv_search:sparse autoencoders category=cs.LG" }),
		/arXiv topic search was removed/,
	);
});

test("arxiv source never expands external XML entities from the feed", async () => {
	globalThis.fetch = async () => new Response(`<?xml version="1.0"?>
<!DOCTYPE feed [<!ENTITY local_file SYSTEM "file:///etc/passwd">]>
<feed xmlns="http://www.w3.org/2005/Atom">
	<entry><id>http://arxiv.org/abs/2309.08600v1</id><title>&local_file;</title></entry>
</feed>`, { status: 200, headers: { "content-type": "application/atom+xml" } });
	const tool = registerTools().get("feynman_science_database_search");
	assert.ok(tool);

	const outcome = await tool.execute("arxiv-xxe", { source: "arxiv", query: "2309.08600" }).then(
		(result) => result.content.map((part) => part.text).join("\n"),
		(error: unknown) => String(error),
	);
	assert.doesNotMatch(outcome, /root:/);
});
