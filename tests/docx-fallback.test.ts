import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { docxText, registerDocxFallback } from "../extensions/research-tools/docx-fallback.js";

// Written by macOS textutil from a plain-text draft.
const fixtures = join(import.meta.dirname, "fixtures");

test("docxText reads paragraphs, tabs, and XML entities from a Word file", () => {
	assert.equal(
		docxText(readFileSync(join(fixtures, "thesis-draft.docx"))),
		'Thesis Draft: Résumé & Results <2026>\n\nChapter 1\tIntroduction\nSparse autoencoders find "interpretable" features.',
	);
	assert.equal(docxText(Buffer.from("not a zip")), undefined);
});

test("a document_parse failure for missing LibreOffice returns the .docx text instead", () => {
	let handler: ((event: unknown, ctx: unknown) => unknown) | undefined;
	registerDocxFallback({ on: (_event: string, fn: typeof handler) => { handler = fn; } } as unknown as ExtensionAPI);
	const failure = (path: string, text = "LibreOffice is not installed. Please install LibreOffice to convert office documents.") => ({
		toolName: "document_parse",
		isError: true,
		input: { path },
		content: [{ type: "text", text }],
	});

	const result = handler!(failure("@thesis-draft.docx"), { cwd: fixtures }) as { isError: boolean; content: Array<{ text: string }> };
	assert.equal(result.isError, false);
	assert.match(result.content[0]!.text, /^LibreOffice is not installed, so this is the document's paragraph text/);
	assert.match(result.content[0]!.text, /Chapter 1\tIntroduction/);

	assert.equal(handler!(failure("slides.pptx"), { cwd: fixtures }), undefined);
	assert.equal(handler!(failure("thesis-draft.docx", "PDF is encrypted"), { cwd: fixtures }), undefined);
	assert.equal(handler!({ ...failure("thesis-draft.docx"), isError: false }, { cwd: fixtures }), undefined);
});
