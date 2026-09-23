import { XMLParser } from "fast-xml-parser";

type SearchParams = {
	query: string;
};

const ARXIV_QUERY_URL = "https://export.arxiv.org/api/query";
const MAX_ARXIV_EXACT_RESULTS = 100;
const REQUEST_TIMEOUT_MS = 25_000;

const xmlParser = new XMLParser({
	ignoreAttributes: false,
	removeNSPrefix: true,
});

function recordValue(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cleanQuery(query: string): string {
	const clean = query.trim();
	if (!clean) throw new Error("Science database search requires a non-empty query.");
	return clean;
}

async function fetchText(url: URL, accept: string): Promise<string> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			headers: { accept },
			signal: controller.signal,
		});
		if (!response.ok) {
			throw new Error(`Science database request failed: ${response.status} ${response.statusText}`);
		}
		return response.text();
	} finally {
		clearTimeout(timeout);
	}
}

function doiUrl(doi: string | undefined): string | undefined {
	return doi ? `https://doi.org/${doi}` : undefined;
}

function arxivArray(value: unknown): unknown[] {
	if (value === undefined || value === null) return [];
	return Array.isArray(value) ? value : [value];
}

function arxivAuthors(value: unknown): string[] {
	return arxivArray(value)
		.map((author) => stringValue(recordValue(author).name))
		.filter((name): name is string => Boolean(name))
		.slice(0, 8);
}

function arxivLinks(value: unknown): Array<Record<string, unknown>> {
	return arxivArray(value).map((link) => recordValue(link));
}

function parseToolKeyValueQuery(query: string): { flags: Record<string, string>; text: string } {
	const flags: Record<string, string> = {};
	const textParts: string[] = [];
	for (const part of query.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []) {
		const match = part.match(/^([a-z_]+)=(.+)$/i);
		if (match?.[1] && match[2] !== undefined) flags[match[1].toLowerCase()] = match[2].replace(/^"|"$/g, "");
		else textParts.push(part);
	}
	return { flags, text: textParts.join(" ").replace(/^"|"$/g, "").trim() };
}

function stripGetPapersCommand(query: string): string {
	return query.trim().replace(/^arxiv_get_papers(?::|\s+)?/i, "").trim();
}

function normalizeArxivId(raw: string): string | undefined {
	let clean = raw.trim();
	clean = clean.replace(/^https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf)\//i, "");
	clean = clean.replace(/^arxiv:/i, "");
	clean = clean.replace(/\.pdf$/i, "");
	return clean || undefined;
}

function splitArxivVersion(id: string | undefined): { arxivId?: string; version?: number } {
	if (!id) return {};
	const match = id.match(/^(.*?)(?:v(\d+))?$/);
	return {
		arxivId: match?.[1] || id,
		version: match?.[2] ? Number(match[2]) : undefined,
	};
}

function parseArxivEntry(entry: Record<string, unknown>): Record<string, unknown> | undefined {
	const idUrl = stringValue(entry.id);
	if (!idUrl) return undefined;
	const idVersioned = idUrl.split("/abs/").pop() ?? idUrl.split("/").pop();
	const split = splitArxivVersion(idVersioned);
	const doi = stringValue(entry.doi);
	const pdfLink = arxivLinks(entry.link).find((link) => stringValue(link["@_title"]) === "pdf" || stringValue(link["@_type"]) === "application/pdf");
	return {
		arxiv_id: split.arxivId,
		version: split.version,
		id_versioned: idVersioned,
		title: stringValue(entry.title)?.replace(/\s+/g, " "),
		abstract: stringValue(entry.summary)?.replace(/\s+/g, " "),
		authors: arxivAuthors(entry.author),
		published: stringValue(entry.published),
		updated: stringValue(entry.updated),
		primary_category: stringValue(recordValue(entry.primary_category)["@_term"]),
		categories: arxivArray(entry.category).map((category) => stringValue(recordValue(category)["@_term"])).filter(Boolean),
		doi,
		journal_ref: stringValue(entry.journal_ref),
		comment: stringValue(entry.comment),
		abs_url: idUrl,
		pdf_url: stringValue(pdfLink?.["@_href"]),
		...(doiUrl(doi) ? { doi_url: doiUrl(doi) } : {}),
	};
}

function arxivFeedEntries(feed: Record<string, unknown>): Record<string, unknown>[] {
	const entries = arxivArray(feed.entry).map(recordValue);
	if (entries.length === 1 && stringValue(entries[0]?.id)?.includes("/api/errors")) {
		throw new Error(`arXiv API error: ${stringValue(entries[0]?.summary) ?? stringValue(entries[0]?.title) ?? "unknown error"}`);
	}
	return entries;
}

async function getArxivPapers(query: string): Promise<Record<string, unknown>> {
	const parsed = parseToolKeyValueQuery(stripGetPapersCommand(query));
	const requested = (parsed.flags.ids ?? parsed.text).split(/[,\s]+/).map((id) => id.trim()).filter(Boolean).slice(0, MAX_ARXIV_EXACT_RESULTS);
	const arxivIdPattern = /^(\d{4}\.\d{4,5}|[a-z][a-z-]*(\.[A-Za-z-]+)?\/\d{7})(v\d+)?$/;
	const ids: string[] = [];
	const notFound: string[] = [];
	for (const raw of requested) {
		const normalized = normalizeArxivId(raw);
		if (normalized && arxivIdPattern.test(normalized)) ids.push(normalized);
		else notFound.push(raw);
	}
	if (!ids.length) {
		throw new Error(`No arXiv IDs found in "${query}". The arxiv source only looks up papers by ID; search topics with source semanticscholar or openalex.`);
	}
	const rows: Record<string, unknown>[] = [];
	const duplicates: Array<Record<string, unknown>> = [];
	const url = new URL(ARXIV_QUERY_URL);
	url.search = new URLSearchParams({ id_list: ids.join(","), max_results: String(ids.length) }).toString();
	const xml = await fetchText(url, "application/atom+xml, application/xml;q=0.9, text/xml;q=0.8");
	const feed = recordValue(xmlParser.parse(xml).feed);
	const byId = new Map<string, Record<string, unknown>>();
	for (const row of arxivFeedEntries(feed).map(parseArxivEntry).filter((item): item is Record<string, unknown> => Boolean(item))) {
		if (row.arxiv_id) byId.set(String(row.arxiv_id), row);
		if (row.id_versioned) byId.set(String(row.id_versioned), row);
	}
	const seen = new Map<Record<string, unknown>, string>();
	for (const id of ids) {
		const bare = id.replace(/v\d+$/i, "");
		const row = byId.get(id) ?? byId.get(bare);
		if (!row) notFound.push(id);
		else if (seen.has(row)) duplicates.push({ requested: id, resolved_as: seen.get(row) });
		else {
			seen.set(row, id);
			rows.push(row);
		}
	}
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "arxiv",
		query,
		mode: "arxiv_get_papers",
		n_requested: requested.length,
		n_found: rows.length,
		duplicates,
		not_found: notFound,
		records: rows,
		results: rows,
		provenance: { docs: "https://info.arxiv.org/help/api/user-manual.html", endpoints: [url.toString()] },
	};
}

// arXiv's API is lexical and ranks concept queries poorly, so this source only
// resolves known IDs; topic discovery goes through Semantic Scholar or OpenAlex.
export async function searchArxiv(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	if (/^arxiv_search\b/i.test(query)) {
		throw new Error("arXiv topic search was removed. Search with source semanticscholar or openalex, then look up arXiv IDs here.");
	}
	return getArxivPapers(query);
}
