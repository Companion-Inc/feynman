// Boots `feynman --mode rpc` in an isolated home and checks that stock Pi
// loaded Feynman's prompts, skills, and extension plus the bundled Pi packages.
// Usage: node scripts/check-pi-rpc.mjs [path/to/bin/feynman.js]
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const feynmanBin = resolve(process.argv[2] ?? join(import.meta.dirname, "..", "bin", "feynman.js"));
const appRoot = realpathSync(resolve(feynmanBin, "..", ".."));
const home = mkdtempSync(join(tmpdir(), "feynman-rpc-"));
const env = { ...process.env, FEYNMAN_HOME: home, HOME: home, USERPROFILE: home, FEYNMAN_TELEMETRY: "0", PI_OFFLINE: "1" };

const child = spawn(process.execPath, [feynmanBin, "--mode", "rpc", "--no-session"], { cwd: home, env });
let stdout = "";
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += chunk; });
const response = await new Promise((resolvePromise, reject) => {
	const timer = setTimeout(() => reject(new Error(`no get_commands response in 120s\nstderr:\n${stderr}`)), 120_000);
	child.on("exit", (code) => reject(new Error(`feynman exited with ${code} before responding\nstderr:\n${stderr}`)));
	child.stdout.on("data", (chunk) => {
		stdout += chunk;
		for (const line of stdout.split("\n").slice(0, -1)) {
			const message = JSON.parse(line);
			if (message.type === "response" && message.command === "get_commands") {
				clearTimeout(timer);
				resolvePromise(message);
			}
		}
		stdout = stdout.slice(stdout.lastIndexOf("\n") + 1);
	});
	child.stdin.write(`${JSON.stringify({ id: "commands", type: "get_commands" })}\n`);
});
child.removeAllListeners("exit");
child.kill();
rmSync(home, { recursive: true, force: true, maxRetries: 5 });

assert.equal(response.success, true, JSON.stringify(response));
const commands = response.data.commands;
const names = new Set(commands.map((command) => command.name));
const realPath = (path) => {
	try {
		return realpathSync(path);
	} catch {
		return path; // Pi's built-in commands report synthetic paths.
	}
};
const fromPath = (root) => commands.filter((command) => realPath(command.sourceInfo?.path ?? "").startsWith(root + sep));

for (const file of readdirSync(join(appRoot, "prompts")).filter((name) => name.endsWith(".md"))) {
	assert.ok(names.has(file.slice(0, -".md".length)), `missing Feynman prompt /${file.slice(0, -".md".length)}`);
}
for (const skill of readdirSync(join(appRoot, "skills"), { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
	assert.ok(names.has(`skill:${skill.name}`), `missing Feynman skill ${skill.name}`);
}
assert.ok(fromPath(join(appRoot, "extensions")).some((command) => command.source === "extension"), "Feynman extension commands missing");
for (const packageName of ["pi-subagents", "pi-web-access", "pi-btw", "pi-docparser"]) {
	assert.ok(commands.some((command) => command.sourceInfo?.path?.includes(`${sep}${packageName}${sep}`)), `${packageName} registered nothing`);
}
assert.equal(stderr.trim(), "", `stderr was not empty:\n${stderr}`);
console.log(`pi rpc ok: ${commands.length} commands, empty stderr`);
