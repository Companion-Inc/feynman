#!/usr/bin/env node
// Research-quality eval: run a Feynman workflow per question in an isolated
// home + workspace, then score the artifacts deterministically.
// Usage: node evals/run.mjs --model <provider/model> --models-json <path> [--ids q01,q04] [--workflow lit]
import { spawn, execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const evalsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(evalsDir, "..");
const { values: opt } = parseArgs({
	options: {
		model: { type: "string" },
		"models-json": { type: "string" },
		ids: { type: "string" },
		workflow: { type: "string", default: "lit" },
		concurrency: { type: "string", default: "2" },
		"timeout-min": { type: "string", default: "45" },
		feynman: { type: "string", default: join(repoRoot, "bin", "feynman.js") },
		rescore: { type: "string" },
	},
});

const UA = { "User-Agent": "feynman-evals/0.1 (research-eval citation checker)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STOP = new Set("a an and are as at be by can for from in into is of on or the to via with without".split(" "));
const tokens = (s) => (s ?? "").toLowerCase().replace(/<[^>]+>/g, " ").replace(/[^a-z0-9]+/g, " ").split(" ").filter((t) => t.length > 1 && !STOP.has(t));
const norm = (s) => tokens(s).join(" ");

// ---------- run ----------

function runFeynman(q, work, args) {
	const timeoutMs = Number(opt["timeout-min"]) * 60_000;
	return new Promise((done) => {
		const log = join(work.root, "feynman.log");
		const child = spawn(process.execPath, [opt.feynman, "--model", opt.model, ...args], {
			cwd: work.ws,
			env: { ...process.env, FEYNMAN_HOME: work.home, TMPDIR: work.tmp, FEYNMAN_TELEMETRY: "0" },
			stdio: ["ignore", "pipe", "pipe"],
			detached: true,
		});
		let out = "";
		child.stdout.on("data", (d) => (out += d));
		child.stderr.on("data", (d) => (out += d));
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			try { process.kill(-child.pid, "SIGTERM"); } catch {}
			setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 10_000);
		}, timeoutMs);
		child.on("exit", (code) => {
			clearTimeout(timer);
			writeFileSync(log, out, { flag: "a" });
			done({ exit_code: code, timed_out: timedOut });
		});
	});
}

async function runQuestion(q) {
	const root = mkdtempSync(join(tmpdir(), `feynman-eval-${q.id}-`));
	const work = { root, home: join(root, "home"), ws: join(root, "ws"), tmp: join(root, "tmp") };
	for (const d of [join(work.home, ".feynman", "agent"), work.ws, work.tmp]) mkdirSync(d, { recursive: true });
	if (opt["models-json"]) cpSync(resolve(opt["models-json"]), join(work.home, ".feynman", "agent", "models.json"));
	const t0 = Date.now();
	console.error(`[${q.id}] start ${root}`);
	let run = await runFeynman(q, work, ["--prompt", `/${opt.workflow} ${q.question}`]);
	// /deepresearch stops after the plan and asks for approval; approve once.
	if (opt.workflow === "deepresearch" && !run.timed_out && !findFinal(work.ws)) {
		run = await runFeynman(q, work, ["--continue", "--prompt", "Approved. Proceed with the plan and deliver the final output and provenance."]);
	}
	const wall_s = Math.round((Date.now() - t0) / 1000);
	console.error(`[${q.id}] finished in ${wall_s}s (exit ${run.exit_code}${run.timed_out ? ", timed out" : ""})`);
	return { id: q.id, workflow: opt.workflow, model: opt.model, ...run, wall_s, workdir: root, ...(await score(q, work)) };
}

// ---------- scoring ----------

function findFinal(ws) {
	const dir = join(ws, "outputs");
	if (!existsSync(dir)) return null;
	const finals = readdirSync(dir)
		.filter((f) => f.endsWith(".md") && !f.endsWith(".provenance.md") && existsSync(join(dir, f.replace(/\.md$/, ".provenance.md"))))
		.sort((a, b) => statSync(join(dir, b)).size - statSync(join(dir, a)).size);
	return finals[0] ? join(dir, finals[0]) : null;
}

function extractIds(text) {
	const ids = new Map(); // key -> {kind, id}
	for (const m of text.matchAll(/(?:arxiv\.org\/(?:abs|pdf|html)\/|alphaxiv\.org\/(?:abs|overview)\/|arxiv:\s*|10\.48550\/arxiv\.)(\d{4}\.\d{4,5})/gi)) {
		ids.set(`arxiv:${m[1]}`, { kind: "arxiv", id: m[1] });
	}
	for (const m of text.matchAll(/\b10\.\d{4,9}\/[^\s"'<>()[\]{}|,;`]+/g)) {
		const doi = m[0].replace(/[.*_:]+$/, "");
		if (/^10\.48550\//i.test(doi)) continue;
		ids.set(`doi:${doi.toLowerCase()}`, { kind: "doi", id: doi });
	}
	return [...ids.values()];
}

// Serialize arXiv calls: the API asks for one request per ~3 seconds.
let arxivGate = Promise.resolve();
async function resolveArxiv(idList) {
	const titles = new Map();
	for (let i = 0; i < idList.length; i += 50) {
		const batch = idList.slice(i, i + 50);
		const turn = arxivGate.then(async () => {
			const url = `https://export.arxiv.org/api/query?id_list=${batch.join(",")}&max_results=${batch.length}`;
			for (let attempt = 0; attempt < 3; attempt++) {
				const res = await fetch(url, { headers: UA }).catch(() => null);
				if (res?.ok) return res.text();
				await sleep(5000);
			}
			return null;
		});
		arxivGate = turn.then(() => sleep(3100));
		const xml = await turn;
		if (xml === null) { for (const id of batch) titles.set(id, undefined); continue; }
		for (const entry of xml.split("<entry>").slice(1)) {
			const id = entry.match(/<id>https?:\/\/arxiv\.org\/abs\/([^<]+?)(v\d+)?<\/id>/)?.[1];
			const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1].replace(/\s+/g, " ").trim();
			if (id && title && title !== "Error") titles.set(id, title);
		}
	}
	return titles; // missing key = does not resolve; undefined value = lookup failed
}

async function resolveDoi(doi) {
	const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { headers: UA }).catch(() => null);
	if (res?.ok) {
		const title = (await res.json()).message?.title?.[0];
		return { resolves: true, title: title?.replace(/\s+/g, " ").trim() };
	}
	// Not in Crossref (DataCite, mEDRA, ...): ask the DOI handle system directly.
	const handle = await fetch(`https://doi.org/api/handles/${encodeURIComponent(doi)}`, { headers: UA }).catch(() => null);
	if (!handle) return { resolves: undefined };
	const body = await handle.json().catch(() => ({}));
	return { resolves: body.responseCode === 1, title: undefined };
}

// The cited title is whatever text surrounds the identifier: each markdown
// line that mentions it, plus the previous line when it sits on a short line.
function citedContexts(text, id) {
	const lines = text.split("\n");
	const needle = id.toLowerCase();
	return lines.flatMap((l, i) => (l.toLowerCase().includes(needle) ? [l.length < 80 && i > 0 ? `${lines[i - 1]} ${l}` : l] : []));
}

function titleOverlap(title, context) {
	const want = new Set(tokens(title));
	if (want.size === 0) return null;
	const have = new Set(tokens(context));
	return [...want].filter((t) => have.has(t)).length / want.size;
}

async function scoreCitations(text) {
	const ids = extractIds(text);
	const arxiv = await resolveArxiv(ids.filter((c) => c.kind === "arxiv").map((c) => c.id));
	const rows = [];
	for (const c of ids) {
		let resolves, title;
		if (c.kind === "arxiv") {
			resolves = arxiv.has(c.id) ? (arxiv.get(c.id) === undefined ? undefined : true) : false;
			title = arxiv.get(c.id);
		} else {
			({ resolves, title } = await resolveDoi(c.id));
		}
		const overlap = title ? Math.max(0, ...citedContexts(text, c.id).map((ctx) => titleOverlap(title, ctx))) : null;
		rows.push({ ...c, resolves, title, overlap });
	}
	const checked = rows.filter((r) => r.resolves !== undefined);
	const titled = rows.filter((r) => r.resolves && r.overlap !== null);
	return {
		citations: rows.length,
		citations_checked: checked.length,
		citation_validity: checked.length ? checked.filter((r) => r.resolves).length / checked.length : null,
		title_match: titled.length ? titled.filter((r) => r.overlap >= 0.6).length / titled.length : null,
		unresolved: rows.filter((r) => r.resolves === false).map((r) => `${r.kind}:${r.id}`),
		title_mismatch: titled.filter((r) => r.overlap < 0.6).map((r) => ({ id: `${r.kind}:${r.id}`, resolved_title: r.title, overlap: Number(r.overlap.toFixed(2)) })),
	};
}

function keyRecall(q, text) {
	const lower = text.toLowerCase();
	const normed = norm(text);
	const hits = q.key_papers.filter((p) => p.ids.some((id) => lower.includes(id.toLowerCase())) || normed.includes(norm(p.title)));
	return { key_recall: hits.length / q.key_papers.length, key_missing: q.key_papers.filter((p) => !hits.includes(p)).map((p) => p.ref) };
}

// Sum usage over every Pi session file (parent + subagent children), deduping
// entries that forked sessions copy from their parent.
function usage(dirs) {
	const seen = new Set();
	const u = { input: 0, output: 0, cache_read: 0, cache_write: 0, total_tokens: 0, cost_usd: 0, llm_calls: 0, session_files: 0 };
	const walk = (d) => {
		for (const f of existsSync(d) ? readdirSync(d, { withFileTypes: true }) : []) {
			const p = join(d, f.name);
			if (f.isDirectory()) walk(p);
			else if (f.name.endsWith(".jsonl")) readSession(p);
		}
	};
	const readSession = (p) => {
		const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
		if (!lines[0]?.includes('"type":"session"')) return;
		u.session_files++;
		for (const line of lines) {
			let e;
			try { e = JSON.parse(line); } catch { continue; }
			const x = e.type === "message" && e.message?.role === "assistant" ? e.message.usage : e.usage;
			if (!x || seen.has(`${e.id}:${e.timestamp}`)) continue;
			seen.add(`${e.id}:${e.timestamp}`);
			u.input += x.input ?? 0; u.output += x.output ?? 0;
			u.cache_read += x.cacheRead ?? 0; u.cache_write += x.cacheWrite ?? 0;
			u.total_tokens += x.totalTokens ?? 0; u.cost_usd += x.cost?.total ?? 0;
			if (e.type === "message") u.llm_calls++;
		}
	};
	dirs.forEach(walk);
	u.cost_usd = Number(u.cost_usd.toFixed(4));
	return u;
}

async function score(q, work) {
	const final = findFinal(work.ws);
	const result = { completed: Boolean(final), final_output: final ? relative(work.ws, final) : null };
	const text = final ? readFileSync(final, "utf8") : "";
	Object.assign(result, final ? await scoreCitations(text) : { citations: 0, citation_validity: null, title_match: null }, keyRecall(q, text));
	result.usage = usage([work.home, work.tmp]);
	return result;
}

// ---------- main ----------

function gitInfo() {
	const git = (...a) => { try { return execFileSync("git", a, { cwd: repoRoot, encoding: "utf8" }).trim(); } catch { return null; } };
	return { git_sha: git("rev-parse", "--short", "HEAD"), git_dirty: Boolean(git("status", "--porcelain", "--", ".", ":!evals")) };
}

function table(rows) {
	const pct = (x) => (x === null || x === undefined ? "-" : `${Math.round(x * 100)}%`);
	const mean = (xs) => { const v = xs.filter((x) => typeof x === "number"); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
	const lines = ["| id | done | cites | valid | title | recall | wall | tokens | cost |", "|---|---|---|---|---|---|---|---|---|"];
	for (const r of rows) {
		lines.push(`| ${r.id} | ${r.completed ? "yes" : "no"} | ${r.citations} | ${pct(r.citation_validity)} | ${pct(r.title_match)} | ${pct(r.key_recall)} | ${r.wall_s ?? "-"}s | ${r.usage.total_tokens} | $${r.usage.cost_usd} |`);
	}
	const sum = (k) => rows.reduce((a, r) => a + (r.usage[k] ?? 0), 0);
	lines.push(`| **all** | ${pct(mean(rows.map((r) => (r.completed ? 1 : 0))))} | ${rows.reduce((a, r) => a + r.citations, 0)} | ${pct(mean(rows.map((r) => r.citation_validity)))} | ${pct(mean(rows.map((r) => r.title_match)))} | ${pct(mean(rows.map((r) => r.key_recall)))} | ${rows.reduce((a, r) => a + (r.wall_s ?? 0), 0)}s | ${sum("total_tokens")} | $${sum("cost_usd").toFixed(2)} |`);
	return lines.join("\n");
}

async function main() {
	const questions = readFileSync(join(evalsDir, "questions.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
	const byId = new Map(questions.map((q) => [q.id, q]));
	let rows, outBase;
	if (opt.rescore) {
		// Re-score existing workdirs (after a scorer change) without rerunning Feynman.
		const old = readFileSync(opt.rescore, "utf8").trim().split("\n").map((l) => JSON.parse(l));
		rows = [];
		for (const r of old) {
			const work = { root: r.workdir, home: join(r.workdir, "home"), ws: join(r.workdir, "ws"), tmp: join(r.workdir, "tmp") };
			rows.push({ ...r, ...(await score(byId.get(r.id), work)) });
		}
		outBase = opt.rescore.replace(/\.jsonl$/, "");
	} else {
		if (!opt.model) throw new Error("--model <provider/model> is required");
		const selected = opt.ids ? opt.ids.split(",").map((id) => byId.get(id) ?? (() => { throw new Error(`unknown id ${id}`); })()) : questions;
		const meta = { date: new Date().toISOString(), ...gitInfo(), feynman_version: JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).version };
		rows = new Array(selected.length);
		let next = 0;
		const worker = async () => { while (next < selected.length) { const i = next++; rows[i] = { ...meta, ...(await runQuestion(selected[i])) }; } };
		await Promise.all(Array.from({ length: Math.max(1, Number(opt.concurrency)) }, worker));
		mkdirSync(join(evalsDir, "results"), { recursive: true });
		outBase = join(evalsDir, "results", `${meta.date.slice(0, 10)}-${opt.workflow}-${opt.model.replace(/[^a-zA-Z0-9.-]+/g, "_")}`);
	}
	writeFileSync(`${outBase}.jsonl`, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
	const summary = table(rows);
	writeFileSync(`${outBase}.md`, `# ${basename(outBase)}\n\n${summary}\n`);
	console.log(summary);
	console.log(`\nwrote ${outBase}.jsonl and .md`);
}

main().catch((e) => { console.error(e); process.exit(1); });
