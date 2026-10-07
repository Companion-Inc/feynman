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
