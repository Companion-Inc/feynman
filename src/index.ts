import { ensureSupportedNodeVersion } from "./system/node-version.js";

async function run(): Promise<void> {
	ensureSupportedNodeVersion();
	const { main } = await import("./cli.js");
	await main();
}

run().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
