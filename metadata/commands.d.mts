export type PromptSpec = {
	name: string;
	description: string;
	args: string;
	section: string;
	topLevelCli: boolean;
};

export type ExtensionCommandSpec = {
	name: string;
	args: string;
	section: string;
	description: string;
	publicDocs: boolean;
};

export type LivePackageCommandSpec = {
	name: string;
	usage: string;
};

export type LivePackageCommandGroup = {
	title: string;
	commands: LivePackageCommandSpec[];
};

export type LivePackageToolSpec = {
	name: string;
};

export type LivePackageToolGroup = {
	title: string;
	tools: LivePackageToolSpec[];
};

export type CliCommand = {
	usage: string;
	description: string;
};

export type CliCommandSection = {
	title: string;
	commands: CliCommand[];
};

export declare function readPromptSpecs(appRoot: string): PromptSpec[];
export declare const extensionCommandSpecs: ExtensionCommandSpec[];
export declare const livePackageCommandGroups: LivePackageCommandGroup[];
export declare const livePackageToolGroups: LivePackageToolGroup[];
export declare const cliCommandSections: CliCommandSection[];
export declare const legacyFlags: CliCommand[];
export declare const topLevelCommandNames: string[];

export declare function isPublicLivePackageToolName(name: string): boolean;
export declare function formatSlashUsage(command: { name: string; args?: string }): string;
export declare function formatCliWorkflowUsage(command: { name: string; args?: string }): string;
export declare function getExtensionCommandSpec(name: string): ExtensionCommandSpec | undefined;
