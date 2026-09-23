import assert from "node:assert/strict";
import test from "node:test";

import { buildResearchRunId, createResearchArtifact, validateResearchRun, type ResearchRun } from "../src/research/contracts.js";

test("ResearchRun validation requires a bounded typed artifact spine", () => {
	const run: ResearchRun = {
		schemaVersion: "feynman.researchRun.v1",
		runId: buildResearchRunId({ workflow: "paper_rank", slug: "demo", generatedAt: "2026-06-23T00:00:00.000Z" }),
		workflow: "paper_rank",
		slug: "demo",
		topic: "demo",
		generatedAt: "2026-06-23T00:00:00.000Z",
		status: "completed",
		researchJobs: ["discovering_prior_art", "ranking_evidence", "extracting_research_entities"],
		sources: [{ id: "openalex", kind: "paper_index", fields: ["works"] }],
		papers: [],
		entities: [
			{
				id: "entity:1",
				kind: "molecular_structure_diagram",
				value: "figure 2 ligand sketch",
				confidence: 0.7,
				source: { artifactPath: "/tmp/demo-paper-rank.md", field: "figure_caption" },
				status: "candidate",
			},
		],
		tools: [],
		artifacts: [
			createResearchArtifact({
				kind: "report",
				path: "/tmp/demo-paper-rank.md",
				label: "ranked brief",
				role: "primary_ranked_brief",
				primary: true,
			})!,
		],
		nextActions: [],
		verification: {
			state: "partial",
			summary: "ranked papers only",
			caveats: ["not a completed replication"],
		},
		constraints: {
			rawFullTextStored: false,
			promptsStored: false,
			modelOutputsStored: false,
		},
	};

	assert.equal(validateResearchRun(run).valid, true);

	const invalid = validateResearchRun({
		...run,
		researchJobs: [],
		artifacts: [{ ...run.artifacts[0]!, primary: false }],
		constraints: { ...run.constraints, rawFullTextStored: true },
	});
	assert.equal(invalid.valid, false);
	assert.match(invalid.errors.join("\n"), /researchJobs must be non-empty/);
	assert.match(invalid.errors.join("\n"), /at least one artifact must be primary/);
	assert.match(invalid.errors.join("\n"), /rawFullTextStored true/);
});
