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

function textResponse(body: string, contentType = "application/xml"): Response {
	return new Response(body, {
		status: 200,
		headers: { "content-type": contentType },
	});
}

const pubmedXml = [
	"<PubmedArticleSet>",
	"<PubmedArticle>",
	"<MedlineCitation>",
	"<PMID>35486828</PMID>",
	"<Article>",
	"<Journal><Title>Nature</Title><ISOAbbreviation>Nature</ISOAbbreviation><JournalIssue><Volume>604</Volume><Issue>7906</Issue><PubDate><Year>2022</Year><Month>Apr</Month><Day>14</Day></PubDate></JournalIssue></Journal>",
	"<ArticleTitle>Programmable gene editing example.</ArticleTitle>",
	"<Abstract><AbstractText>Structured abstract text.</AbstractText><CopyrightInformation>Copyright 2022 The Authors.</CopyrightInformation></Abstract>",
	"<Pagination><MedlinePgn>123-130</MedlinePgn></Pagination>",
	"<AuthorList><Author><LastName>Doudna</LastName><ForeName>Jennifer</ForeName><Initials>J</Initials><AffiliationInfo><Affiliation>Example Lab</Affiliation></AffiliationInfo></Author></AuthorList>",
	"<Language>eng</Language>",
	"<PublicationTypeList><PublicationType>Journal Article</PublicationType></PublicationTypeList>",
	"</Article>",
	"<MeshHeadingList><MeshHeading><DescriptorName>Gene Editing</DescriptorName></MeshHeading></MeshHeadingList>",
	"</MedlineCitation>",
	"<PubmedData><ArticleIdList><ArticleId IdType='pubmed'>35486828</ArticleId><ArticleId IdType='pmc'>PMC9046468</ArticleId><ArticleId IdType='doi'>10.1038/example</ArticleId></ArticleIdList></PubmedData>",
	"</PubmedArticle>",
	"</PubmedArticleSet>",
].join("");

const jatsXml = [
	"<article xmlns:xlink='http://www.w3.org/1999/xlink'>",
	"<front><article-meta>",
	"<article-id pub-id-type='pmid'>35486828</article-id><article-id pub-id-type='doi'>10.1038/example</article-id>",
	"<title-group><article-title>PMC full text title</article-title></title-group>",
	"<abstract><p>Open abstract text.</p></abstract>",
	"<permissions><copyright-statement>Copyright 2022 The Authors.</copyright-statement><copyright-year>2022</copyright-year><license license-type='cc-by' xlink:href='https://creativecommons.org/licenses/by/4.0/'/></permissions>",
	"</article-meta></front>",
	"<body><sec><title>Introduction</title><p>Intro body.</p></sec><sec><title>Methods</title><p>Methods body.</p></sec></body>",
	"</article>",
].join("");

test("PubMed source supports metadata, ID conversion, related links, full text, copyright, and citation lookup modes", async () => {
	process.env.NCBI_EMAIL = "research@example.edu";
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = String(input);
		requests.push(url);
		if (url.includes("/efetch.fcgi")) return textResponse(pubmedXml);
		if (url.includes("idconv/api")) {
			return jsonResponse({
				status: "ok",
				records: [{
					"requested-id": "35486828",
					pmid: "35486828",
					pmcid: "PMC9046468",
					doi: "10.1038/example",
				}],
			});
		}
		if (url.includes("/elink.fcgi")) {
			return jsonResponse({
				linksets: [{
					dbfrom: "pubmed",
					ids: ["35486828"],
					linksetdbs: [{
						dbto: "pubmed",
						linkname: "pubmed_pubmed",
						links: ["35500001", "35500002", "35500003"],
					}],
				}],
			});
		}
		if (url.includes("europepmc") && url.includes("/search")) {
			return jsonResponse({
				resultList: {
					result: [{
						id: "35486828",
						pmid: "35486828",
						pmcid: "PMC9046468",
						doi: "10.1038/example",
						title: "Search full text title",
						isOpenAccess: "Y",
					}],
				},
			});
		}
		if (url.includes("europepmc") && url.includes("/PMC9046468/fullTextXML")) return textResponse(jatsXml);
		if (url.includes("/ecitmatch.cgi")) return textResponse("Nature|2022|604|123|Doudna|citation-1|35486828\n", "text/plain");
		throw new Error(`unexpected URL ${url}`);
	};

	const tools = registerTools();
	const tool = tools.get("feynman_science_database_search");
	assert.ok(tool);

	const metadata = await tool.execute("pubmed-metadata", {
		source: "pubmed",
		query: "pmid:35486828",
		limit: 1,
	});
	const metadataDetails = metadata.details as {
		mode: string;
		results: Array<{
			authors: Array<{ affiliations?: string[]; lastName?: string }>;
			doi?: string;
			meshTerms?: string[];
			pmid?: string;
			pmcid?: string;
			title?: string;
		}>;
		source: string;
	};
	assert.equal(metadataDetails.source, "pubmed");
	assert.equal(metadataDetails.mode, "metadata");
	assert.equal(metadataDetails.results[0]?.pmid, "35486828");
	assert.equal(metadataDetails.results[0]?.pmcid, "PMC9046468");
	assert.equal(metadataDetails.results[0]?.doi, "10.1038/example");
	assert.match(metadataDetails.results[0]?.title ?? "", /Programmable/);
	assert.equal(metadataDetails.results[0]?.authors[0]?.lastName, "Doudna");
	assert.equal(metadataDetails.results[0]?.authors[0]?.affiliations?.[0], "Example Lab");
	assert.deepEqual(metadataDetails.results[0]?.meshTerms, ["Gene Editing"]);

	const converted = await tool.execute("pubmed-convert", {
		source: "pubmed",
		query: "convert:35486828 id_type=pmid",
		limit: 1,
	});
	const convertedDetails = converted.details as { mode: string; results: Array<{ doi?: string; pmcid?: string; requestedId?: string }> };
	assert.equal(convertedDetails.mode, "id-conversion");
	assert.equal(convertedDetails.results[0]?.requestedId, "35486828");
	assert.equal(convertedDetails.results[0]?.pmcid, "PMC9046468");
	assert.equal(convertedDetails.results[0]?.doi, "10.1038/example");

	const related = await tool.execute("pubmed-related", {
		source: "pubmed",
		query: "related:35486828 link_type=pubmed_pubmed max_results=2",
		limit: 2,
	});
	const relatedDetails = related.details as { linkType: string; mode: string; returned: number; linksets: Array<{ linksetdbs: Array<{ links: string[] }> }> };
	assert.equal(relatedDetails.mode, "related");
	assert.equal(relatedDetails.linkType, "pubmed_pubmed");
	assert.equal(relatedDetails.returned, 2);
	assert.deepEqual(relatedDetails.linksets[0]?.linksetdbs[0]?.links, ["35500001", "35500002"]);

	const fulltext = await tool.execute("pubmed-fulltext", {
		source: "pubmed",
		query: "fulltext:PMC9046468",
		limit: 1,
	});
	const fulltextDetails = fulltext.details as { delegatedSource: string; mode: string; results: Array<{ doi?: string; fullTextStatus?: string; license?: { type?: string }; sectionCount?: number; sections?: Array<{ textSnippet?: string }> }> };
	assert.equal(fulltextDetails.mode, "fulltext");
	assert.match(fulltextDetails.delegatedSource, /Europe PMC/);
	assert.equal(fulltextDetails.results[0]?.fullTextStatus, "retrieved");
	assert.equal(fulltextDetails.results[0]?.doi, "10.1038/example");
	assert.equal(fulltextDetails.results[0]?.license?.type, "cc-by");
	assert.equal(fulltextDetails.results[0]?.sectionCount, 2);
	assert.match(fulltextDetails.results[0]?.sections?.[0]?.textSnippet ?? "", /Intro body/);

	const copyright = await tool.execute("pubmed-copyright", {
		source: "pubmed",
		query: "copyright:35486828",
		limit: 1,
	});
	const copyrightDetails = copyright.details as { mode: string; results: Array<{ license?: { isOpenAccess?: boolean; type?: string }; source?: string }>; summary: { foundInPmc: number; openAccessCount: number } };
	assert.equal(copyrightDetails.mode, "copyright");
	assert.equal(copyrightDetails.results[0]?.source, "pmc");
	assert.equal(copyrightDetails.results[0]?.license?.type, "cc-by");
	assert.equal(copyrightDetails.results[0]?.license?.isOpenAccess, true);
	assert.equal(copyrightDetails.summary.foundInPmc, 1);
	assert.equal(copyrightDetails.summary.openAccessCount, 1);

	const citation = await tool.execute("pubmed-citation", {
		source: "pubmed",
		query: "citation journal=Nature year=2022 volume=604 first_page=123 author=Doudna",
		limit: 1,
	});
	const citationDetails = citation.details as { mode: string; results: Array<{ pmid?: string; status?: string }> };
	assert.equal(citationDetails.mode, "citation-lookup");
	assert.equal(citationDetails.results[0]?.pmid, "35486828");
	assert.equal(citationDetails.results[0]?.status, "found");

	assert.equal(new URL(requests.find((url) => url.includes("/efetch.fcgi"))!).searchParams.get("email"), "research@example.edu");
	assert.equal(new URL(requests.find((url) => url.includes("idconv/api"))!).searchParams.get("idtype"), "pmid");
	assert.equal(new URL(requests.find((url) => url.includes("/elink.fcgi"))!).searchParams.get("linkname"), "pubmed_pubmed");
	assert.equal(new URL(requests.find((url) => url.includes("/ecitmatch.cgi"))!).searchParams.get("db"), "pubmed");
});

test("PubMed metadata tool preserves collective author affiliations", async () => {
	globalThis.fetch = async (input) => {
		assert.ok(String(input).includes("/efetch.fcgi"));
		return textResponse(pubmedXml.replace("</AuthorList>", "<Author><CollectiveName>Clinical Research Consortium</CollectiveName><AffiliationInfo><Affiliation>University Hospital</Affiliation></AffiliationInfo><AffiliationInfo><Affiliation>Research Network</Affiliation></AffiliationInfo></Author></AuthorList>"));
	};
	const result = await registerTools().get("feynman_science_database_search")!.execute("pubmed-group-affiliations", {
		source: "pubmed",
		query: "pmid:35486828",
		limit: 1,
	});
	const details = result.details as { results: Array<{ authors: Array<Record<string, unknown>> }> };
	assert.deepEqual(details.results[0]?.authors, [
		{ lastName: "Doudna", foreName: "Jennifer", initials: "J", affiliations: ["Example Lab"] },
		{ collectiveName: "Clinical Research Consortium", affiliations: ["University Hospital", "Research Network"] },
	]);
});
