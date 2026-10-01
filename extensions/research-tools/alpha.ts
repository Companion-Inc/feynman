import {
	askPaper,
	annotatePaper,
	clearPaperAnnotation,
	disconnect,
	getPaper,
	isLoggedIn,
	listPaperAnnotations,
	readPaperCode,
	searchPapers,
} from "@companion-ai/alpha-hub/lib";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { extractPaperSections } from "./alpha-sections.js";
import { searchArxiv } from "./science-database-arxiv.js";
import { searchOpenAlex } from "./science-database-openalex.js";

function formatText(value: unknown): string {
	if (typeof value === "string") return value;
	return JSON.stringify(value, null, 2);
}

// alphaXiv's API has changed without notice before; when a call fails, point
// the model at the other paper sources instead of leaving it on a broken tool.
const ARXIV_ID = /(?:^|arxiv\.org\/(?:abs|pdf)\/|alphaxiv\.org\/(?:abs|overview)\/)(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?)/i;

// When alphaXiv does not answer (expired login, outage), answer from another
// paper source and say so first, instead of failing the research step.
async function withPaperFallback<T>(
	run: () => Promise<T>,
	fallback?: { source: string; run: () => Promise<Record<string, unknown>> },
): Promise<T | Record<string, unknown>> {
	try {
		return await run();
	} catch (error) {
		const message = (error instanceof Error ? error.message : String(error)).replace("`alpha login`", "`feynman alpha login`");
		if (fallback) {
			try {
				return { fallbackNote: `alphaXiv did not answer (${message}); these results are from ${fallback.source}.`, ...(await fallback.run()) };
			} catch {}
		}
		throw new Error(
			`${message}\nalphaXiv did not answer this call. Use feynman_science_database_search (source "arxiv" or "semanticscholar") or fetch_content on https://arxiv.org/abs/<id> instead.`,
		);
	}
}

// Pi converts Type.Array inputs before validating them, which would turn null into ["null"].
// Preserve the JSON Schema array contract without the Type.Array conversion marker.
const paperSectionsSchema = Type.Unsafe<string[]>({
	type: "array",
	items: Type.String({
		description:
			"Multiple sections to extract from content. Supported values: abstract, introduction, methodology, experiments, results, discussion, limitations, conclusion.",
	}),
});

export function registerAlphaTools(pi: ExtensionAPI, signedIn = isLoggedIn()): void {
	// The alphaXiv MCP client keeps a connection open; close it so print and
	// JSON runs can exit once the session ends.
	pi.on("session_shutdown", async () => {
		await disconnect();
	});
	// Search, paper, Q&A, and code tools need an alphaXiv account. Without one,
	// every call failed, so leave them out and let the model use the other
	// paper sources. Annotations are local and stay available.
	const registerAccountTool: ExtensionAPI["registerTool"] = signedIn ? (tool) => pi.registerTool(tool) : () => {};

	registerAccountTool({
		name: "alpha_search",
		label: "Alpha Search",
		description:
			"Search research papers through alphaXiv. Modes: semantic (default, use 2-3 sentence queries), keyword (exact terms), agentic (broad multi-turn retrieval), both, or all.",
		parameters: Type.Object({
			query: Type.String({ description: "Search query." }),
			mode: Type.Optional(
				Type.String({ description: "Search mode: semantic, keyword, both, agentic, or all." }),
			),
		}),
		async execute(_toolCallId, params) {
			const result = await withPaperFallback(() => searchPapers(params.query, params.mode?.trim() || "semantic"), {
				source: "OpenAlex semantic search",
				run: () => searchOpenAlex({ source: "openalex", query: `semantic: ${params.query}`, limit: 10 }),
			});
			return { content: [{ type: "text", text: formatText(result) }], details: result };
		},
	});

	registerAccountTool({
		name: "alpha_get_paper",
		label: "Alpha Get Paper",
		description:
			"Fetch a paper's AI-generated report (or raw full text) plus any local annotation. Optional section filters return only requested sections when detectable.",
		parameters: Type.Object({
			paper: Type.String({ description: "arXiv ID, arXiv URL, or alphaXiv URL." }),
			fullText: Type.Optional(Type.Boolean({ description: "Return raw full text instead of AI report." })),
			section: Type.Optional(
				Type.String({
					description:
						"Single section to extract from content: abstract, introduction, methodology, experiments, results, discussion, limitations, or conclusion.",
				}),
			),
			sections: Type.Optional(paperSectionsSchema),
		}),
		async execute(_toolCallId, params) {
			const arxivId = ARXIV_ID.exec(params.paper.trim())?.[1];
			const result = await withPaperFallback(() => getPaper(params.paper, { fullText: params.fullText }), arxivId ? {
				source: "arXiv metadata and abstract (no full text or sections)",
				run: () => searchArxiv({ query: arxivId }),
			} : undefined);
			if ("fallbackNote" in result) {
				return { content: [{ type: "text", text: formatText(result) }], details: result };
			}
			const extracted = extractPaperSections(result.content, params.section, params.sections);
			const filteredResult = extracted.requested.length
				? {
						...result,
						content: Object.keys(extracted.selected).length > 0 ? extracted.selected : result.content,
						requestedSections: extracted.requested,
						missingSections: extracted.missing,
					}
				: result;
			return { content: [{ type: "text", text: formatText(filteredResult) }], details: filteredResult };
		},
	});

	registerAccountTool({
		name: "alpha_ask_paper",
		label: "Alpha Ask Paper",
		description: "Ask a targeted question about an arXiv or alphaXiv paper. Uses AI to analyze the PDF and answer. DOI-only papers are not supported; read those with fetch_content on the open-access PDF or Europe PMC full text.",
		parameters: Type.Object({
			paper: Type.String({ description: "arXiv ID, arXiv URL, or alphaXiv URL." }),
			question: Type.String({ description: "Question about the paper." }),
		}),
		async execute(_toolCallId, params) {
			const result = await withPaperFallback(() => askPaper(params.paper, params.question));
			return { content: [{ type: "text", text: formatText(result) }], details: result };
		},
	});

	pi.registerTool({
		name: "alpha_annotate_paper",
		label: "Alpha Annotate Paper",
		description: "Write or clear a persistent local annotation for a paper.",
		parameters: Type.Object({
			paper: Type.String({ description: "Paper ID (arXiv ID or URL)." }),
			note: Type.Optional(Type.String({ description: "Annotation text. Omit when clear=true." })),
			clear: Type.Optional(Type.Boolean({ description: "Clear the existing annotation." })),
		}),
		async execute(_toolCallId, params) {
			const result = params.clear
				? await clearPaperAnnotation(params.paper)
				: params.note
					? await annotatePaper(params.paper, params.note)
					: (() => { throw new Error("Provide either note or clear=true."); })();
			return { content: [{ type: "text", text: formatText(result) }], details: result };
		},
	});

	pi.registerTool({
		name: "alpha_list_annotations",
		label: "Alpha List Annotations",
		description: "List all persistent local paper annotations.",
		parameters: Type.Object({}),
		async execute() {
			const result = await listPaperAnnotations();
			return { content: [{ type: "text", text: formatText(result) }], details: result };
		},
	});

	registerAccountTool({
		name: "alpha_read_code",
		label: "Alpha Read Code",
		description: "Read files from a paper's GitHub repository. Use '/' for repo overview.",
		parameters: Type.Object({
			githubUrl: Type.String({ description: "GitHub repository URL." }),
			path: Type.Optional(Type.String({ description: "File or directory path. Default: '/'" })),
		}),
		async execute(_toolCallId, params) {
			const result = await readPaperCode(params.githubUrl, params.path?.trim() || "/");
			return { content: [{ type: "text", text: formatText(result) }], details: result };
		},
	});
}
