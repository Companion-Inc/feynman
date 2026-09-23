import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";

import { registerScienceDatabaseTools } from "../extensions/research-tools/science-databases.js";

type Tool = {
	execute: (toolCallId: string, params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; details: unknown }>;
	name: string;
	promptSnippet?: string;
};

type SemanticScholarDetails = {
	source: string;
	sort: string;
	note?: string;
	totalCount: number;
	returned: number;
	results: Array<{ paperId: string; title?: string; arxivId?: string; doi?: string; abstract?: string; openAccessPdf?: string; citationCount?: number; authors: string[] }>;
	provenance: { endpoints: string[] };
};

// Recorded 2026-09-23 from /graph/v1/paper/search/bulk?query=test-time compute scaling LLM reasoning&sort=citationCount:desc (first 10 rows).
const bulkFixture = JSON.parse(readFileSync(new URL("./fixtures/semanticscholar-bulk-test-time-compute.json", import.meta.url), "utf8")) as { total: number; data: unknown[] };

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;

afterEach(() => {
	globalThis.fetch = originalFetch;
	if (originalApiKey === undefined) delete process.env.SEMANTIC_SCHOLAR_API_KEY;
	else process.env.SEMANTIC_SCHOLAR_API_KEY = originalApiKey;
});

function searchTool(): Tool {
	const tools = new Map<string, Tool>();
	registerScienceDatabaseTools({
		registerTool(tool: Tool) {
			tools.set(tool.name, tool);
		},
	} as never);
	const tool = tools.get("feynman_science_database_search");
	assert.ok(tool);
	return tool;
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}

test("semanticscholar defaults to citation-sorted bulk search and keeps only the top rows", async () => {
	delete process.env.SEMANTIC_SCHOLAR_API_KEY;
	const requests: Array<{ url: URL; headers: Headers }> = [];
	globalThis.fetch = async (input, init) => {
		requests.push({ url: new URL(String(input)), headers: new Headers(init?.headers) });
		return jsonResponse(bulkFixture);
	};

	const result = await searchTool().execute("s2-bulk", {
		source: "semanticscholar",
		query: "test-time compute scaling LLM reasoning",
		limit: 3,
	});
	const details = result.details as SemanticScholarDetails;

	assert.equal(requests.length, 1);
	assert.equal(requests[0]!.url.pathname, "/graph/v1/paper/search/bulk");
	assert.equal(requests[0]!.url.searchParams.get("sort"), "citationCount:desc");
	assert.equal(requests[0]!.url.searchParams.get("fields"), "title,year,authors,venue,citationCount,externalIds,openAccessPdf,abstract");
	assert.equal(requests[0]!.url.searchParams.has("limit"), false);
	assert.equal(requests[0]!.headers.has("x-api-key"), false);
	assert.equal(details.source, "semanticscholar");
	assert.equal(details.sort, "citationCount:desc");
	assert.equal(details.totalCount, 218);
	assert.equal(details.returned, 3);
	assert.equal(details.results[1]?.title, "Scaling LLM Test-Time Compute Optimally Can be More Effective than Scaling Parameters for Reasoning");
	assert.equal(details.results[1]?.citationCount, 499);
	assert.equal(details.results[1]?.abstract, undefined);
	assert.equal(details.results[1]?.openAccessPdf, undefined);
	assert.equal(details.results[0]?.arxivId, "2408.15240");
	assert.equal(details.results[0]?.doi, "10.48550/arXiv.2408.15240");
	assert.ok((details.results[0]?.abstract?.length ?? 0) <= 601);
	assert.ok(result.content[0]!.text.length < 20_000, "the tool result stays bounded");
});

test("semanticscholar relevance mode uses relevance search and sends the API key header", async () => {
	process.env.SEMANTIC_SCHOLAR_API_KEY = "s2-test-key";
	const requests: Array<{ url: URL; headers: Headers }> = [];
	globalThis.fetch = async (input, init) => {
		requests.push({ url: new URL(String(input)), headers: new Headers(init?.headers) });
		return jsonResponse({ total: 1, offset: 0, data: [bulkFixture.data[1]] });
	};

	const result = await searchTool().execute("s2-relevance", {
		source: "semanticscholar",
		query: "test-time compute",
		limit: 2,
		sort: "relevance",
	});
	const details = result.details as SemanticScholarDetails;

	assert.equal(requests[0]!.url.pathname, "/graph/v1/paper/search");
	assert.equal(requests[0]!.url.searchParams.get("limit"), "2");
	assert.equal(requests[0]!.url.searchParams.has("sort"), false);
	assert.equal(requests[0]!.headers.get("x-api-key"), "s2-test-key");
	assert.equal(details.sort, "relevance");
	assert.equal(details.results[0]?.authors[0], "C. Snell");
	assert.equal(details.provenance.endpoints[0]?.includes("s2-test-key"), false);
});

test("semanticscholar retries one 429 and then succeeds", async () => {
	delete process.env.SEMANTIC_SCHOLAR_API_KEY;
	let calls = 0;
	globalThis.fetch = async () => {
		calls += 1;
		if (calls === 1) return jsonResponse({ message: "Too Many Requests.", code: "429" }, 429, { "retry-after": "0" });
		return jsonResponse(bulkFixture);
	};

	const result = await searchTool().execute("s2-retry", { source: "semanticscholar", query: "speculative decoding", sort: "pub_date", limit: 1 });

	assert.equal(calls, 2);
	assert.equal((result.details as SemanticScholarDetails).sort, "publicationDate:desc");
	assert.equal((result.details as SemanticScholarDetails).returned, 1);
});

test("semanticscholar stops after one retry and explains how to get a key", async () => {
	delete process.env.SEMANTIC_SCHOLAR_API_KEY;
	let calls = 0;
	globalThis.fetch = async () => {
		calls += 1;
		return jsonResponse({ message: "Too Many Requests.", code: "429" }, 429, { "retry-after": "0" });
	};

	await assert.rejects(
		searchTool().execute("s2-429", { source: "semanticscholar", query: "sparse autoencoders" }),
		/rate-limited \(HTTP 429\) after one retry\. Set SEMANTIC_SCHOLAR_API_KEY \(free key: https:\/\/www\.semanticscholar\.org\/product\/api#api-key-form\)/,
	);
	assert.equal(calls, 2);
});

test("anonymous semanticscholar relevance search falls back to citation-sorted bulk search after a 429", async () => {
	delete process.env.SEMANTIC_SCHOLAR_API_KEY;
	const paths: string[] = [];
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		paths.push(url.pathname);
		if (url.pathname === "/graph/v1/paper/search") {
			return jsonResponse({ message: "Too Many Requests.", code: "429" }, 429, { "retry-after": "0" });
		}
		return jsonResponse(bulkFixture);
	};

	const result = await searchTool().execute("s2-fallback", {
		source: "semanticscholar",
		query: "speculative decoding",
		sort: "relevance",
		limit: 2,
	});
	const details = result.details as SemanticScholarDetails;

	assert.deepEqual(paths, ["/graph/v1/paper/search", "/graph/v1/paper/search", "/graph/v1/paper/search/bulk"]);
	assert.equal(details.sort, "citationCount:desc");
	assert.equal(details.returned, 2);
	assert.match(details.note ?? "", /rate-limited \(HTTP 429\).*SEMANTIC_SCHOLAR_API_KEY/);
	assert.equal(details.provenance.endpoints.length, 2);
});

test("keyed semanticscholar relevance search still fails after a 429", async () => {
	process.env.SEMANTIC_SCHOLAR_API_KEY = "s2-test-key";
	let calls = 0;
	globalThis.fetch = async () => {
		calls += 1;
		return jsonResponse({ message: "Too Many Requests.", code: "429" }, 429, { "retry-after": "0" });
	};

	await assert.rejects(
		searchTool().execute("s2-keyed-429", { source: "semanticscholar", query: "speculative decoding", sort: "relevance" }),
		/rate-limited this API key \(HTTP 429\)/,
	);
	assert.equal(calls, 2);
});
