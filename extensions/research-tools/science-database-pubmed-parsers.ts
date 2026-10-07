import { XMLParser } from "fast-xml-parser";

const SECTION_TEXT_SNIPPET_CHARS = 1_200;
const MAX_SECTIONS_RETURNED = 10;

const xmlParser = new XMLParser({
	ignoreAttributes: false,
	removeNSPrefix: true,
});

// Object-mode parsing groups tags and loses the order of mixed inline text.
const orderedTextParser = new XMLParser({
	preserveOrder: true,
	removeNSPrefix: true,
	trimValues: false,
	parseTagValue: false,
});

function recordValue(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function listValue(value: unknown): unknown[] {
	if (value === undefined || value === null) return [];
	return Array.isArray(value) ? value : [value];
}

function stringValue(value: unknown): string | undefined {
	if (typeof value === "string" && value.trim()) return value.trim();
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	return undefined;
}

function numberValue(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
	return undefined;
}

function prune<T extends Record<string, unknown>>(record: T): Record<string, unknown> {
	return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function textValue(value: unknown): string | undefined {
	if (typeof value === "string" || typeof value === "number") return stringValue(value);
	if (Array.isArray(value)) {
		const parts = value.map((item) => textValue(item)).filter((item): item is string => Boolean(item));
		return parts.length ? parts.join(" ").replace(/\s+/g, " ").trim() : undefined;
	}
	const record = recordValue(value);
	const direct = stringValue(record["#text"]);
	if (direct) return direct;
	const parts = Object.entries(record)
		.filter(([key]) => !key.startsWith("@_"))
		.map(([, item]) => textValue(item))
		.filter((item): item is string => Boolean(item));
	return parts.length ? parts.join(" ").replace(/\s+/g, " ").trim() : undefined;
}

function orderedChildren(value: unknown, tag: string): unknown[] {
	return listValue(value).flatMap((node) => {
		const children = recordValue(node)[tag];
		return children === undefined ? [] : [children];
	});
}

function orderedText(value: unknown): string {
	if (typeof value === "string" || typeof value === "number") return String(value);
	if (Array.isArray(value)) return value.map((node) => orderedText(node)).join("");
	return Object.entries(recordValue(value))
		.filter(([key]) => key !== ":@" && !key.startsWith("?"))
		.map(([, children]) => orderedText(children))
		.join("");
}

function orderedTextValue(value: unknown): string | undefined {
	return orderedText(value).replace(/\s+/g, " ").trim() || undefined;
}

function orderedPubmedArticles(xml: string): unknown[] {
	const set = orderedChildren(orderedTextParser.parse(xml), "PubmedArticleSet")[0];
	return orderedChildren(set, "PubmedArticle");
}

function dateObject(value: unknown): Record<string, string> | undefined {
	const record = recordValue(value);
	const monthMap: Record<string, string> = {
		Jan: "01",
		Feb: "02",
		Mar: "03",
		Apr: "04",
		May: "05",
		Jun: "06",
		Jul: "07",
		Aug: "08",
		Sep: "09",
		Oct: "10",
		Nov: "11",
		Dec: "12",
	};
	const year = textValue(record.Year);
	const monthRaw = textValue(record.Month);
	const day = textValue(record.Day);
	const month = monthRaw ? (monthMap[monthRaw] ?? (/^\d+$/.test(monthRaw) ? monthRaw.padStart(2, "0") : monthRaw)) : undefined;
	const output = prune({
		year,
		month,
		day: day && /^\d+$/.test(day) ? day.padStart(2, "0") : day,
	});
	return Object.keys(output).length ? output as Record<string, string> : undefined;
}

function parseArticleIds(article: Record<string, unknown>): Record<string, string> {
	const identifiers: Record<string, string> = {};
	const citation = recordValue(article.MedlineCitation);
	const pmid = textValue(citation.PMID);
	if (pmid) identifiers.pmid = pmid;
	const articleIds = recordValue(recordValue(article.PubmedData).ArticleIdList).ArticleId;
	for (const item of listValue(articleIds)) {
		const record = recordValue(item);
		const idType = stringValue(record["@_IdType"])?.toLowerCase();
		const value = textValue(item);
		if (!idType || !value) continue;
		if (idType === "pubmed") identifiers.pmid = value;
		else if (idType === "pmc") identifiers.pmc = value;
		else if (idType === "doi") identifiers.doi = value;
		else if (idType === "pii") identifiers.pii = value;
	}
	return identifiers;
}

function parseAuthors(value: unknown): Array<Record<string, unknown>> {
	return listValue(value).map((item) => {
		const author = recordValue(item);
		const collective = textValue(author.CollectiveName);
		if (collective) return { collectiveName: collective, affiliations: [] };
		const affiliations = listValue(author.AffiliationInfo)
			.flatMap((info) => listValue(recordValue(info).Affiliation))
			.map((affiliation) => textValue(affiliation))
			.filter((affiliation): affiliation is string => Boolean(affiliation));
		return prune({
			lastName: textValue(author.LastName),
			foreName: textValue(author.ForeName),
			initials: textValue(author.Initials),
			affiliations,
		});
	});
}

function parsePubmedArticle(value: unknown, orderedArticle: unknown): Record<string, unknown> {
	const articleRoot = recordValue(value);
	const citation = recordValue(articleRoot.MedlineCitation);
	const article = recordValue(citation.Article);
	const journal = recordValue(article.Journal);
	const issue = recordValue(journal.JournalIssue);
	const orderedCitation = orderedChildren(orderedArticle, "MedlineCitation")[0];
	const orderedContent = orderedChildren(orderedCitation, "Article")[0];
	const orderedAbstract = orderedChildren(orderedContent, "Abstract")[0];
	const abstractParts = orderedChildren(orderedAbstract, "AbstractText")
		.map((part) => orderedTextValue(part))
		.filter((part): part is string => Boolean(part));
	const publicationTypes = listValue(recordValue(article.PublicationTypeList).PublicationType)
		.map((item) => textValue(item))
		.filter((item): item is string => Boolean(item));
	const meshTerms = listValue(recordValue(citation.MeshHeadingList).MeshHeading)
		.map((heading) => textValue(recordValue(heading).DescriptorName))
		.filter((term): term is string => Boolean(term));
	const identifiers = parseArticleIds(articleRoot);
	const citationRecord = prune({
		volume: textValue(issue.Volume),
		issue: textValue(issue.Issue),
		pages: textValue(recordValue(article.Pagination).MedlinePgn),
	});
	return prune({
		identifiers,
		pmid: identifiers.pmid,
		pmcid: identifiers.pmc,
		doi: identifiers.doi,
		title: orderedTextValue(orderedChildren(orderedContent, "ArticleTitle")[0]),
		abstract: abstractParts.length ? abstractParts.join("\n") : undefined,
		journal: prune({
			title: textValue(journal.Title),
			isoAbbreviation: textValue(journal.ISOAbbreviation),
		}),
		authors: parseAuthors(recordValue(article.AuthorList).Author),
		publicationDate: dateObject(issue.PubDate) ?? dateObject(article.ArticleDate),
		meshTerms,
		articleTypes: publicationTypes,
		language: textValue(article.Language),
		citation: citationRecord,
		url: identifiers.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${identifiers.pmid}/` : undefined,
		doiUrl: identifiers.doi ? `https://doi.org/${identifiers.doi}` : undefined,
	});
}

export function parsePubmedArticles(xml: string): Record<string, unknown>[] {
	const parsed = recordValue(xmlParser.parse(xml));
	const set = recordValue(parsed.PubmedArticleSet);
	const orderedArticles = orderedPubmedArticles(xml);
	return listValue(set.PubmedArticle).map((article, index) => parsePubmedArticle(article, orderedArticles[index]));
}

function jatsArticleId(meta: Record<string, unknown>, type: string): string | undefined {
	for (const item of listValue(meta["article-id"])) {
		const record = recordValue(item);
		if (stringValue(record["@_pub-id-type"])?.toLowerCase() === type) return textValue(item);
	}
	return undefined;
}

function truncateText(value: string | undefined, limit: number): string | undefined {
	if (!value) return undefined;
	const clean = value.replace(/\s+/g, " ").trim();
	return clean.length > limit ? `${clean.slice(0, limit).trimEnd()}...` : clean;
}

function sectionText(section: unknown): string {
	const record = recordValue(section);
	const title = textValue(record.title);
	const bodyParts = Object.entries(record)
		.filter(([key]) => !key.startsWith("@_") && !["title", "fig", "table-wrap", "sec"].includes(key))
		.map(([, value]) => textValue(value))
		.filter((value): value is string => Boolean(value));
	return [title, ...bodyParts].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export function parseFullTextXml(xml: string, pmcid: string, fallback: Record<string, unknown> = {}): Record<string, unknown> {
	const parsed = recordValue(xmlParser.parse(xml));
	const article = recordValue(parsed.article);
	const meta = recordValue(recordValue(article.front)["article-meta"]);
	const body = recordValue(article.body);
	const sections = listValue(body.sec)
		.map((section, index) => {
			const record = recordValue(section);
			const title = textValue(record.title) ?? `Section ${index + 1}`;
			return {
				index: index + 1,
				title,
				textSnippet: truncateText(sectionText(section), SECTION_TEXT_SNIPPET_CHARS),
			};
		})
		.filter((section) => section.textSnippet)
		.slice(0, MAX_SECTIONS_RETURNED);
	const permissions = recordValue(meta.permissions);
	const license = recordValue(permissions.license);
	const licenseType = stringValue(license["@_license-type"]);
	const licenseUrl = stringValue(license["@_href"]);
	return prune({
		inputId: pmcid,
		pmcid,
		pmid: jatsArticleId(meta, "pmid") ?? stringValue(fallback.pmid),
		doi: jatsArticleId(meta, "doi") ?? stringValue(fallback.doi),
		title: textValue(recordValue(meta["title-group"])["article-title"]) ?? stringValue(fallback.title),
		abstract: truncateText(textValue(recordValue(meta.abstract).p), 2_000) ?? stringValue(fallback.abstractText),
		fullTextStatus: "retrieved",
		fullTextAvailable: true,
		sectionCount: sections.length,
		sections,
		license: prune({
			type: licenseType,
			url: licenseUrl,
			isOpenAccess: Boolean(licenseType || licenseUrl),
		}),
		copyright: prune({
			statement: textValue(permissions["copyright-statement"]),
			year: numberValue(textValue(permissions["copyright-year"])),
		}),
		rawXmlBytes: Buffer.byteLength(xml, "utf8"),
		url: `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`,
		contentPolicy: "Returned section snippets are bounded; raw fullTextXML is not included in tool output.",
	});
}

export function copyrightFromPubmedXml(xml: string): Map<string, Record<string, unknown>> {
	const map = new Map<string, Record<string, unknown>>();
	const parsed = recordValue(xmlParser.parse(xml));
	const set = recordValue(parsed.PubmedArticleSet);
	const orderedArticles = orderedPubmedArticles(xml);
	for (const [index, rawArticle] of listValue(set.PubmedArticle).entries()) {
		const article = parsePubmedArticle(rawArticle, orderedArticles[index]);
		const pmid = stringValue(article.pmid);
		if (!pmid) continue;
		const pubmedArticle = recordValue(rawArticle);
		const copyright = textValue(recordValue(recordValue(recordValue(pubmedArticle.MedlineCitation).Article).Abstract).CopyrightInformation);
		map.set(pmid, { article, copyright });
	}
	return map;
}
