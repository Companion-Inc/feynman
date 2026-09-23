import { isLoggedIn as isAlphaLoggedIn, login as loginAlpha } from "@companion-ai/alpha-hub/lib";
import { dirname } from "node:path";

import { getPiWebAccessStatus } from "../pi/web-access.js";
import { ensureFeynmanSettings } from "../pi/settings.js";
import type { ThinkingLevel } from "../pi/settings.js";
import { installPiPackage, listOptionalPackagePresets } from "../pi/packages.js";
import { getCurrentModelSpec, runModelSetup } from "../model/commands.js";
import { buildModelStatusSnapshotFromRecords, getAvailableModelRecords, getSupportedModelRecords } from "../model/catalog.js";
import { PANDOC_FALLBACK_PATHS, resolveExecutable } from "../system/executables.js";
import { setupPreviewDependencies } from "./preview.js";
import { printInfo, printSection, printSuccess } from "../ui/terminal.js";
import {
	isInteractiveTerminal,
	promptConfirm,
	promptIntro,
	promptMultiSelect,
	promptOutro,
	SetupCancelledError,
} from "./prompts.js";

type SetupOptions = {
	settingsPath: string;
	bundledSettingsPath: string;
	authPath: string;
	workingDir: string;
	sessionDir: string;
	appRoot: string;
	defaultThinkingLevel?: ThinkingLevel;
};

function printNonInteractiveSetupGuidance(): void {
	printInfo("Non-interactive terminal. Use explicit commands:");
	printInfo("  feynman model login <provider>");
	printInfo("  feynman model set <provider/model>");
	printInfo("  # or configure API keys via env vars/auth.json and rerun `feynman model list`");
	printInfo("  feynman alpha login");
	printInfo("  feynman doctor");
}

async function maybeInstallOptionalPackages(options: SetupOptions): Promise<void> {
	const presets = listOptionalPackagePresets();
	if (presets.length === 0) {
		return;
	}

	const selectedPresets = await promptMultiSelect(
		"Optional packages",
		presets.map((preset) => ({
			value: preset.name,
			label: preset.name,
			hint: preset.description,
		})),
		[],
	);

	if (selectedPresets.length === 0) {
		printInfo("No optional packages selected.");
		return;
	}

	for (const presetName of selectedPresets) {
		const preset = presets.find((entry) => entry.name === presetName);
		if (!preset) continue;
		const exitCode = await installPiPackage({ ...options, feynmanAgentDir: dirname(options.authPath) }, preset.source);
		if (exitCode === 0) {
			printSuccess(`Installed optional preset: ${preset.name}`);
		} else {
			printInfo(`Skipped optional preset ${preset.name}: install exited with ${exitCode}.`);
		}
	}
}

async function maybeLoginAlpha(): Promise<void> {
	if (isAlphaLoggedIn()) {
		printInfo("alphaXiv already configured.");
		return;
	}

	const shouldLogin = await promptConfirm("Connect alphaXiv now?", true);
	if (!shouldLogin) {
		printInfo("Skipping alphaXiv login for now.");
		return;
	}

	try {
		await loginAlpha();
		printSuccess("alphaXiv login complete");
	} catch (error) {
		printInfo(`alphaXiv login skipped: ${error instanceof Error ? error.message : String(error)}`);
	}
}

async function maybeInstallPreviewDependencies(): Promise<void> {
	if (resolveExecutable("pandoc", PANDOC_FALLBACK_PATHS)) {
		printInfo("Preview support already configured.");
		return;
	}

	const shouldInstall = await promptConfirm("Install pandoc for preview/export support?", false);
	if (!shouldInstall) {
		printInfo("Skipping preview dependency install.");
		return;
	}

	try {
		const result = setupPreviewDependencies();
		printSuccess(result.message);
	} catch (error) {
		printInfo(`Preview setup skipped: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export async function runSetup(options: SetupOptions): Promise<void> {
	if (!isInteractiveTerminal()) {
		printNonInteractiveSetupGuidance();
		return;
	}

	try {
		await promptIntro("Feynman setup");
		await runModelSetup(options.settingsPath, options.authPath);
		await maybeInstallOptionalPackages(options);
		await maybeLoginAlpha();
		await maybeInstallPreviewDependencies();

		await ensureFeynmanSettings(
			options.settingsPath,
			options.bundledSettingsPath,
			options.appRoot,
			options.defaultThinkingLevel ?? "medium",
			options.authPath,
		);

		const modelStatus = buildModelStatusSnapshotFromRecords(
			await getSupportedModelRecords(options.authPath),
			await getAvailableModelRecords(options.authPath),
			getCurrentModelSpec(options.settingsPath),
		);
		printSection("Ready");
		printInfo(`Model: ${getCurrentModelSpec(options.settingsPath) ?? "not set"}`);
		printInfo(`alphaXiv: ${isAlphaLoggedIn() ? "configured" : "not configured"}`);
		printInfo(`Preview: ${resolveExecutable("pandoc", PANDOC_FALLBACK_PATHS) ? "configured" : "not configured"}`);
		printInfo(`Web: ${getPiWebAccessStatus().routeLabel}`);
		if (modelStatus.recommended && !modelStatus.currentValid) {
			printInfo(`Recommended model: ${modelStatus.recommended}`);
		}

		await promptOutro("Feynman is ready");
	} catch (error) {
		if (error instanceof SetupCancelledError) {
			printInfo("Setup cancelled.");
			return;
		}

		throw error;
	}
}
