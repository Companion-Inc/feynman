import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function buildCurrentDateResearchContext(now: Date): string {
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return [
		`The current date is ${year}-${month}-${day}.`,
		"For current, latest, or recent claims, verify against current sources.",
		"Do not reject evidence only because its date is later than your training data.",
	].join("\n");
}

export function registerCurrentDateResearchContext(
	pi: ExtensionAPI,
	now: () => Date = () => new Date(),
): void {
	pi.on("before_agent_start", (event) => {
		event.systemPromptOptions.sections ??= {};
		event.systemPromptOptions.sections.current_date = buildCurrentDateResearchContext(now());
	});
}
