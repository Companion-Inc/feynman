import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { searchArxiv } from "./science-database-arxiv.js";
import { searchOpenAlex } from "./science-database-openalex.js";
import { searchPreprints } from "./science-database-preprints.js";
import { searchPubMed } from "./science-database-pubmed.js";
import { isEuropePmcFullTextQuery, searchEuropePmcFullText } from "./science-database-europepmc-fulltext.js";

type ScienceDatabaseSource = "arxiv" | "biorxiv" | "crossref" | "europepmc" | "medrxiv" | "openalex" | "pubmed" | "semanticscholar";

type ScienceDatabaseSearchParams = {
	limit?: number;
	query: string;
	sort?: "pub_date" | "relevance";
	source: ScienceDatabaseSource;
};

const CROSSREF_BASE = "https://api.crossref.org";
const EUROPE_PMC_SEARCH_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
const SEMANTIC_SCHOLAR_BASE = "https://api.semanticscholar.org/graph/v1";
const SEMANTIC_SCHOLAR_FIELDS = "title,year,authors,venue,citationCount,externalIds,openAccessPdf,abstract";
const SEMANTIC_SCHOLAR_KEY_URL = "https://www.semanticscholar.org/product/api#api-key-form";
const SEMANTIC_SCHOLAR_ABSTRACT_CHARS = 600;
const SEMANTIC_SCHOLAR_DEFAULT_RETRY_MS = 1_000;
const SEMANTIC_SCHOLAR_MAX_RETRY_MS = 5_000;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 25_000;
const SCIENCE_DATABASE_SOURCE_IDS = [
	"arxiv",
	"biorxiv",
	"crossref",
	"europepmc",
	"medrxiv",
	"openalex",
	"pubmed",
	"semanticscholar",
] as const;
const SCIENCE_DATABASE_SOURCE_SCHEMA = Type.Unsafe({
	description: "Database to search.",
	enum: [...SCIENCE_DATABASE_SOURCE_IDS],
	type: "string",
});
function formatText(value: unknown): string {
	return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function recordValue(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
	return undefined;
}

function safeLimit(value: number | undefined): number {
	if (!Number.isFinite(value) || value === undefined) return DEFAULT_LIMIT;
	return Math.max(1, Math.min(Math.floor(value), MAX_LIMIT));
}

function cleanQuery(query: string): string {
	const clean = query.trim();
	if (!clean) throw new Error("Science database search requires a non-empty query.");
	return clean;
}

class ScienceDatabaseRequestError extends Error {
	constructor(message: string, readonly status: number, readonly retryAfterMs?: number) {
		super(message);
	}
}

function retryAfterMs(value: string | null): number | undefined {
	const seconds = numberValue(value ?? undefined);
	return seconds === undefined || seconds < 0 ? undefined : seconds * 1000;
}

async function fetchJson(url: URL, headers: Record<string, string> = {}): Promise<unknown> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			headers: { accept: "application/json", ...headers },
			signal: controller.signal,
		});
		if (!response.ok) {
			throw new ScienceDatabaseRequestError(
				`Science database request failed: ${response.status} ${response.statusText}`,
				response.status,
				retryAfterMs(response.headers.get("retry-after")),
			);
		}
		return response.json();
	} finally {
		clearTimeout(timeout);
	}
}

function firstString(value: unknown): string | undefined {
	if (typeof value === "string") return stringValue(value);
	if (Array.isArray(value)) {
		for (const item of value) {
			const text = firstString(item);
			if (text) return text;
		}
	}
	return undefined;
}

function dateParts(value: unknown): string | undefined {
	const parts = arrayValue(recordValue(value)["date-parts"])[0];
	if (!Array.isArray(parts)) return undefined;
	return parts.map((part) => String(part).padStart(2, "0")).join("-");
}

function doiUrl(doi: string | undefined): string | undefined {
	return doi ? `https://doi.org/${doi}` : undefined;
}

function crossrefAuthors(value: unknown): string[] {
	return arrayValue(value)
		.map((author) => {
			const record = recordValue(author);
			return [stringValue(record.given), stringValue(record.family)].filter(Boolean).join(" ") || stringValue(record.name);
		})
		.filter((name): name is string => Boolean(name))
		.slice(0, 8);
}

async function searchCrossref(params: ScienceDatabaseSearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const url = new URL(`${CROSSREF_BASE}/works`);
	const mailto = process.env.CROSSREF_MAILTO?.trim() || process.env.NCBI_EMAIL?.trim();
	url.search = new URLSearchParams({
		query,
		rows: String(limit),
		select: "DOI,title,published-print,published-online,issued,container-title,author,is-referenced-by-count,URL,type",
		...(mailto ? { mailto } : {}),
	}).toString();
	const payload = recordValue(await fetchJson(url));
	const message = recordValue(payload.message);
	const results = arrayValue(message.items).flatMap((item) => {
		const record = recordValue(item);
		const doi = stringValue(record.DOI);
		return [{
			doi,
			title: firstString(record.title),
			container: firstString(record["container-title"]),
			type: stringValue(record.type),
			publicationDate: dateParts(record["published-print"]) ?? dateParts(record["published-online"]) ?? dateParts(record.issued),
			authors: crossrefAuthors(record.author),
			citationCount: numberValue(record["is-referenced-by-count"]),
			url: stringValue(record.URL) ?? doiUrl(doi),
			...(doiUrl(doi) ? { doiUrl: doiUrl(doi) } : {}),
		}];
	});
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "crossref",
		query,
		totalCount: numberValue(message["total-results"]) ?? results.length,
		returned: results.length,
		results,
		provenance: {
			docs: "https://www.crossref.org/documentation/retrieve-metadata/rest-api/",
			endpoints: [url.toString()],
		},
	};
}

async function searchEuropePmc(params: ScienceDatabaseSearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	if (isEuropePmcFullTextQuery(query)) return searchEuropePmcFullText({ limit, query });
	const url = new URL(EUROPE_PMC_SEARCH_URL);
	url.search = new URLSearchParams({
		query,
		resultType: "lite",
		cursorMark: "*",
		pageSize: String(limit),
		format: "json",
	}).toString();
	const payload = recordValue(await fetchJson(url));
	const results = arrayValue(recordValue(payload.resultList).result).flatMap((item) => {
		const record = recordValue(item);
		const id = stringValue(record.id);
		const source = stringValue(record.source);
		if (!id || !source) return [];
		const doi = stringValue(record.doi);
		return [{
			id,
			source,
			pmid: stringValue(record.pmid),
			pmcid: stringValue(record.pmcid),
			doi,
			title: stringValue(record.title),
			authors: stringValue(record.authorString),
			journal: stringValue(record.journalTitle),
			publicationYear: numberValue(record.pubYear),
			publicationType: stringValue(record.pubType),
			citedByCount: numberValue(record.citedByCount),
			isOpenAccess: record.isOpenAccess === "Y",
			inPmc: record.inPMC === "Y",
			hasReferences: record.hasReferences === "Y",
			hasTextMinedTerms: record.hasTextMinedTerms === "Y",
			url: `https://europepmc.org/article/${encodeURIComponent(source)}/${encodeURIComponent(id)}`,
			...(doiUrl(doi) ? { doiUrl: doiUrl(doi) } : {}),
		}];
	});
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "europepmc",
		query,
		totalCount: numberValue(payload.hitCount) ?? results.length,
		returned: results.length,
		hasMore: Boolean(stringValue(payload.nextCursorMark)),
		results,
		provenance: {
			docs: "https://europepmc.org/RestfulWebService",
			endpoints: [url.toString()],
		},
	};
}

async function fetchSemanticScholar(url: URL): Promise<unknown> {
	const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY?.trim();
	const headers: Record<string, string> = apiKey ? { "x-api-key": apiKey } : {};
	for (let attempt = 0; ; attempt += 1) {
		try {
			return await fetchJson(url, headers);
		} catch (error) {
			if (!(error instanceof ScienceDatabaseRequestError) || error.status !== 429) throw error;
			if (attempt >= 1) {
				throw new ScienceDatabaseRequestError(apiKey
					? "Semantic Scholar rate-limited this API key (HTTP 429) after one retry. Wait and retry, or search with source openalex."
					: `Semantic Scholar's shared anonymous pool is rate-limited (HTTP 429) after one retry. Set SEMANTIC_SCHOLAR_API_KEY (free key: ${SEMANTIC_SCHOLAR_KEY_URL}) or search with source openalex.`, 429);
			}
			const waitMs = Math.min(error.retryAfterMs ?? SEMANTIC_SCHOLAR_DEFAULT_RETRY_MS, SEMANTIC_SCHOLAR_MAX_RETRY_MS);
			await new Promise((resolve) => setTimeout(resolve, waitMs));
		}
	}
}

function truncateText(value: string | undefined, maxChars: number): string | undefined {
	if (!value || value.length <= maxChars) return value;
	return `${value.slice(0, maxChars).trimEnd()}…`;
}

function semanticScholarSearchUrl(query: string, limit: number, sort: string): URL {
	const relevance = sort === "relevance";
	const url = new URL(`${SEMANTIC_SCHOLAR_BASE}/paper/search${relevance ? "" : "/bulk"}`);
	url.search = new URLSearchParams({
		query,
		fields: SEMANTIC_SCHOLAR_FIELDS,
		...(relevance ? { limit: String(limit) } : { sort }),
	}).toString();
	return url;
}

// Bulk search sorted by citation count surfaces seminal papers that relevance
// ranking misses; it returns up to 1,000 rows, so only the top `limit` are kept.
async function searchSemanticScholar(params: ScienceDatabaseSearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	let sort = params.sort === "relevance" ? "relevance" : params.sort === "pub_date" ? "publicationDate:desc" : "citationCount:desc";
	const endpoints = [semanticScholarSearchUrl(query, limit, sort)];
	let note: string | undefined;
	let payload: Record<string, unknown>;
	try {
		payload = recordValue(await fetchSemanticScholar(endpoints[0]!));
	} catch (error) {
		// The anonymous pool rate-limits relevance search far more often than bulk search.
		const anonymous = !process.env.SEMANTIC_SCHOLAR_API_KEY?.trim();
		if (sort !== "relevance" || !anonymous || !(error instanceof ScienceDatabaseRequestError) || error.status !== 429) throw error;
		sort = "citationCount:desc";
		endpoints.push(semanticScholarSearchUrl(query, limit, sort));
		note = `Relevance search was rate-limited (HTTP 429) on Semantic Scholar's shared anonymous pool, so these are citation-sorted bulk results. A free SEMANTIC_SCHOLAR_API_KEY avoids this: ${SEMANTIC_SCHOLAR_KEY_URL}`;
		payload = recordValue(await fetchSemanticScholar(endpoints[1]!));
	}
	const results = arrayValue(payload.data).slice(0, limit).flatMap((item) => {
		const record = recordValue(item);
		const paperId = stringValue(record.paperId);
		if (!paperId) return [];
		const externalIds = recordValue(record.externalIds);
		const doi = stringValue(externalIds.DOI);
		return [{
			paperId,
			title: stringValue(record.title),
			year: numberValue(record.year),
			authors: arrayValue(record.authors).map((author) => stringValue(recordValue(author).name)).filter(Boolean).slice(0, 8),
			venue: stringValue(record.venue),
			citationCount: numberValue(record.citationCount),
			doi,
			arxivId: stringValue(externalIds.ArXiv),
			pmid: stringValue(externalIds.PubMed),
			openAccessPdf: stringValue(recordValue(record.openAccessPdf).url),
			abstract: truncateText(stringValue(record.abstract), SEMANTIC_SCHOLAR_ABSTRACT_CHARS),
			url: `https://www.semanticscholar.org/paper/${paperId}`,
			...(doiUrl(doi) ? { doiUrl: doiUrl(doi) } : {}),
		}];
	});
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "semanticscholar",
		query,
		sort,
		...(note ? { note } : {}),
		totalCount: numberValue(payload.total) ?? results.length,
		returned: results.length,
		results,
		provenance: {
			docs: "https://api.semanticscholar.org/api-docs/graph",
			license: "https://www.semanticscholar.org/product/api/license",
			endpoints: endpoints.map((endpoint) => endpoint.toString()),
		},
	};
}

async function scienceDatabaseSearch(params: ScienceDatabaseSearchParams): Promise<Record<string, unknown>> {
	if (params.source === "arxiv") return searchArxiv(params);
	if (params.source === "biorxiv") return searchPreprints(params, "biorxiv");
	if (params.source === "medrxiv") return searchPreprints(params, "medrxiv");
	if (params.source === "pubmed") return searchPubMed(params);
	if (params.source === "crossref") return searchCrossref(params);
	if (params.source === "semanticscholar") return searchSemanticScholar(params);
	if (params.source === "openalex") {
		return searchOpenAlex({
			limit: params.limit,
			query: params.query,
			source: params.source,
		});
	}
	return searchEuropePmc(params);
}

export function registerScienceDatabaseTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "feynman_science_database_search",
		label: "Science Database Search",
		description:
			"Search read-only scholarly literature databases: Semantic Scholar (citation-sorted by default), OpenAlex, arXiv ID lookup, PubMed (search, metadata, ID conversion, related articles, citation matching, copyright, PMC full-text routing), Europe PMC (metadata and open-access full-text sections), bioRxiv/medRxiv preprints, and Crossref DOI metadata. Returns stable identifiers, bounded section snippets when requested, source URLs, and endpoint provenance.",
		promptSnippet: "Search Semantic Scholar, OpenAlex, PubMed, Europe PMC metadata and open-access full-text sections, bioRxiv/medRxiv, or Crossref, or look up arXiv IDs, for source-backed literature evidence.",
		promptGuidelines: [
			"Use feynman_science_database_search to find and pin down papers before making source-backed claims: Semantic Scholar for general discovery (prefer the default citation-count sort, which surfaces seminal work and is the least rate-limited; use sort=pub_date only when recency matters); OpenAlex for cross-discipline works (prefix the query with `semantic:` for embedding search that finds conceptual and recent matches keyword search misses), citation graphs, authors, venues, and OA status; arXiv only to look up known arXiv IDs (it has no topic search); PubMed for biomedical search, PMID metadata, PMID/PMCID/DOI conversion, related articles, citation matching, and copyright checks; Europe PMC for open-access full-text section snippets; bioRxiv/medRxiv for preprint DOI lookup, date/category windows, and published-preprint links; Crossref for DOI metadata.",
			"Exact literature modes: `openalex_search_works`, `openalex_get_work`, `openalex_citations`, `openalex_references`, `openalex_search_authors`, `openalex_get_author`, `openalex_venue_info`, and `arxiv_get_papers` (the arxiv source also accepts bare IDs such as 2309.08600). PubMed accepts `pmid:`, `convert:`, `related:`, `fulltext:`, `copyright:`, and `citation` prefixes; Europe PMC accepts `fulltext:`/`sections:` with a PMCID or PMID.",
			"Preserve returned PMIDs, PMCIDs, DOIs, arXiv IDs, Semantic Scholar paper IDs, preprint DOIs, OpenAlex W/A/S IDs, author ORCIDs, citation/reference counts, OA status, Europe PMC full-text statuses and section inventories, source URLs, and endpoint provenance in research artifacts and answers.",
			"Treat database summaries as retrieval evidence, then verify decisive claims against the full paper when needed.",
		],
		parameters: Type.Object({
			source: SCIENCE_DATABASE_SOURCE_SCHEMA,
			query: Type.String({
				description:
					"Search query, exact literature command, identifier, paper title, or DOI. Examples: semantic: spending more inference compute instead of a bigger model year_from=2024, openalex_search_works:CRISPR year_from=2024 open_access_only=true, openalex_get_work:W2741809807, openalex_citations:W2741809807, openalex_search_authors:Jennifer Doudna, arxiv_get_papers:2309.08600,2401.00001, pmid:35486828, convert:35486828 id_type=pmid, fulltext:PMC9046468, citation journal=Nature year=2022 volume=604 first_page=123 author=Doudna.",
			}),
			limit: Type.Optional(Type.Number({ description: `Maximum records to return. Defaults to ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.` })),
			sort: Type.Optional(Type.Union([
				Type.Literal("relevance"),
				Type.Literal("pub_date"),
			], { description: "PubMed sort order. For semanticscholar, prefer the default citation-count sort; use pub_date (newest first) only when recency matters. relevance falls back to the default when the anonymous pool is rate-limited. Ignored for other sources." })),
		}),
		async execute(_toolCallId, params) {
			const result = await scienceDatabaseSearch(params as ScienceDatabaseSearchParams);
			return {
				content: [{ type: "text", text: formatText(result) }],
				details: result,
			};
		},
	});
}

export const testableScienceDatabases = {
	scienceDatabaseSearch,
};
