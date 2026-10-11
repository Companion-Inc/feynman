import assert from "node:assert/strict";
import { test } from "node:test";

import { copyrightFromPubmedXml, parsePubmedArticles } from "../extensions/research-tools/science-database-pubmed-parsers.js";

function articleXml(authors: string): string {
	return `<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>12345</PMID><Article>
		<ArticleTitle>Affiliation example</ArticleTitle><AuthorList>${authors}</AuthorList>
	</Article></MedlineCitation></PubmedArticle></PubmedArticleSet>`;
}

for (const affiliations of [[], ["Example Lab"], ["Example Lab", "University Hospital"], ["Example Lab", "University Hospital", "Research Institute"]]) {
	test(`PubMed preserves ${affiliations.length} author affiliations`, () => {
		const entries = affiliations.map((name, index) => `<AffiliationInfo><Affiliation>${name}</Affiliation><Identifier Source="ROR">organization-${index}</Identifier></AffiliationInfo>`).join("");
		const [article] = parsePubmedArticles(articleXml(`<Author><LastName>Lee</LastName><ForeName>Alex</ForeName>${entries}</Author>`));
		assert.deepEqual(article?.authors, [{ lastName: "Lee", foreName: "Alex", affiliations }]);
	});
}

for (const affiliations of [[], ["University Hospital"], ["University Hospital", "Research Network"]]) {
	test(`PubMed preserves ${affiliations.length} collective author affiliations`, () => {
		const entries = affiliations.map((name) => `<AffiliationInfo><Affiliation>${name}</Affiliation></AffiliationInfo>`).join("");
		const xml = articleXml(`<Author><CollectiveName>Clinical Research Consortium</CollectiveName>${entries}</Author>`);
		const expected = [{ collectiveName: "Clinical Research Consortium", affiliations }];
		assert.deepEqual(parsePubmedArticles(xml)[0]?.authors, expected);
		assert.deepEqual((copyrightFromPubmedXml(xml).get("12345")?.article as Record<string, unknown>).authors, expected);
	});
}

test("PubMed keeps collective and individual affiliations with their own author", () => {
	const xml = articleXml(`
		<Author><LastName>Lee</LastName><AffiliationInfo><Affiliation>First Lab</Affiliation></AffiliationInfo></Author>
		<Author><CollectiveName>Clinical Research Consortium</CollectiveName><AffiliationInfo><Affiliation>University Hospital</Affiliation></AffiliationInfo><AffiliationInfo><Affiliation>Research Network</Affiliation></AffiliationInfo></Author>
		<Author><LastName>Patel</LastName><AffiliationInfo><Affiliation>Second Institute</Affiliation></AffiliationInfo></Author>
	`);
	assert.deepEqual(parsePubmedArticles(xml)[0]?.authors, [
		{ lastName: "Lee", affiliations: ["First Lab"] },
		{ collectiveName: "Clinical Research Consortium", affiliations: ["University Hospital", "Research Network"] },
		{ lastName: "Patel", affiliations: ["Second Institute"] },
	]);
});

test("PubMed keeps repeated affiliations with their own author in metadata and copyright results", () => {
	const xml = articleXml(`
		<Author><LastName>Lee</LastName><AffiliationInfo><Affiliation>First Lab</Affiliation></AffiliationInfo><AffiliationInfo><Affiliation>First Hospital</Affiliation></AffiliationInfo></Author>
		<Author><LastName>Patel</LastName><AffiliationInfo><Affiliation>Second Institute</Affiliation></AffiliationInfo></Author>
	`);
	const expected = [
		{ lastName: "Lee", affiliations: ["First Lab", "First Hospital"] },
		{ lastName: "Patel", affiliations: ["Second Institute"] },
	];
	assert.deepEqual(parsePubmedArticles(xml)[0]?.authors, expected);
	const copyrightArticle = copyrightFromPubmedXml(xml).get("12345")?.article as Record<string, unknown>;
	assert.deepEqual(copyrightArticle.authors, expected);
});
