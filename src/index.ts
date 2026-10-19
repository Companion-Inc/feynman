import { resolve } from "node:path";
import { getFeynmanAgentDir } from "./config/paths.js";
import { ensureSupportedNodeVersion } from "./system/node-version.js";

async function run(): Promise<void> {
	ensureSupportedNodeVersion();
	// alphaXiv login hints from the bundled alpha-hub then name `feynman alpha login`.
	process.env.ALPHA_HUB_CLI ??= "feynman alpha";
	const { main } = await import("./cli.js");
	await main();
}

// Pi throws a bare JSON.parse error for a malformed auth.json, which names no file.
function describeFatalError(error: unknown): string {
	if (!(error instanceof Error)) return String(error);
	if (error instanceof SyntaxError && error.stack?.includes("auth-storage")) {
		const authPath = resolve(getFeynmanAgentDir(), "auth.json");
		return `${authPath} is not valid JSON (${error.message}).\nFix the file, or move it aside and sign in again with \`feynman setup\`.`;
	}
	return error.message;
}

run().catch((error) => {
	console.error(describeFatalError(error));
	process.exitCode = 1;
});
