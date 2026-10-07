import assert from "node:assert/strict";
import { test } from "node:test";

import { copyrightFromPubmedXml, parseFullTextXml, parsePubmedArticles } from "../extensions/research-tools/science-database-pubmed-parsers.js";

function articleXml(title: string, abstract = "", pmid = "12345"): string {
	return `<PubmedArticle><MedlineCitation><PMID>${pmid}</PMID><Article>
		<ArticleTitle>${title}</ArticleTitle>${abstract}
	</Article></MedlineCitation></PubmedArticle>`;
}

for (const [title, expected] of [
	["Effects of <i>BRCA1</i> mutation.", "Effects of BRCA1 mutation."],
	["H<sub>2</sub>O exposure and 10<sup>2</sup> samples.", "H2O exposure and 102 samples."],
	["A<i>X</i>B", "AXB"],
	["AB<i>X</i>", "ABX"],
	["<i>Entirely italic title</i>", "Entirely italic title"],
	["The <i>BRCA<b>1</b></i> and <i>BRCA<b>2</b></i> genes.", "The BRCA1 and BRCA2 genes."],
	["  Plain &amp; unformatted title.  ", "Plain & unformatted title."],
]) {
	test(`PubMed preserves title text: ${title}`, () => {
		const [article] = parsePubmedArticles(`<PubmedArticleSet>${articleXml(title)}</PubmedArticleSet>`);
		assert.equal(article?.title, expected);
	});
}

test("PubMed preserves nested abstract markup, section boundaries, and XML entities", () => {
	const abstract = `<Abstract>
		<AbstractText Label="RESULTS" NlmCategory="RESULTS">Treatment reduced <i>KRAS</i> expression &amp; <i>BRAF<b>V600E</b></i> activity.</AbstractText>
		<AbstractText Label="CONCLUSIONS">H<sub>2</sub>O exposure. Second <i>marked</i> section.</AbstractText>
		<AbstractText>Plain final section.</AbstractText>
		<CopyrightInformation>Copyright 2026 The Authors.</CopyrightInformation>
	</Abstract>`;
	const xml = `<PubmedArticleSet>${articleXml("A<i>X</i>B", abstract)}</PubmedArticleSet>`;
	const expected = "Treatment reduced KRAS expression & BRAFV600E activity.\nH2O exposure. Second marked section.\nPlain final section.";
	assert.equal(parsePubmedArticles(xml)[0]?.abstract, expected);
	const copyright = copyrightFromPubmedXml(xml).get("12345");
	assert.equal((copyright?.article as Record<string, unknown>).title, "AXB");
	assert.equal((copyright?.article as Record<string, unknown>).abstract, expected);
	assert.equal(copyright?.copyright, "Copyright 2026 The Authors.");
});

test("PubMed pairs ordered text with the correct article and preserves metadata", () => {
	const first = articleXml("First <i>title</i>", "<Abstract><AbstractText>First <i>abstract</i>.</AbstractText></Abstract>", "101");
	const second = articleXml("Second <i>title</i>", "<AuthorList><Author><LastName>Lee</LastName><AffiliationInfo><Affiliation>Example Lab</Affiliation></AffiliationInfo></Author></AuthorList><Language>eng</Language>", "202");
	const articles = parsePubmedArticles(`<PubmedArticleSet>${first}${second}</PubmedArticleSet>`);
	assert.equal(articles[0]?.pmid, "101");
	assert.equal(articles[0]?.title, "First title");
	assert.equal(articles[0]?.abstract, "First abstract.");
	assert.equal(articles[1]?.pmid, "202");
	assert.equal(articles[1]?.title, "Second title");
	assert.equal(articles[1]?.abstract, undefined);
	assert.equal(articles[1]?.language, "eng");
	assert.deepEqual(articles[1]?.authors, [{ lastName: "Lee", affiliations: ["Example Lab"] }]);
	assert.equal(parsePubmedArticles("<PubmedArticleSet/>").length, 0);
});

test("PubMed ordered text parsing does not change the JATS full-text parser", () => {
	const xml = `<article><front><article-meta><article-id pub-id-type="pmid">101</article-id>
		<title-group><article-title>JATS title</article-title></title-group><abstract><p>JATS abstract.</p></abstract>
	</article-meta></front><body><sec><title>Methods</title><p>Example method.</p></sec></body></article>`;
	const article = parseFullTextXml(xml, "PMC101");
	assert.equal(article.title, "JATS title");
	assert.equal(article.abstract, "JATS abstract.");
	assert.deepEqual(article.sections, [{ index: 1, title: "Methods", textSnippet: "Methods Example method." }]);
});
