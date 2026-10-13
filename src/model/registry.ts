import { dirname, resolve } from "node:path";

import { ModelRuntime } from "@earendil-works/pi-coding-agent";

export function getModelsJsonPath(authPath: string): string {
	return resolve(dirname(authPath), "models.json");
}

export async function createModelRuntime(authPath: string): Promise<ModelRuntime> {
	return ModelRuntime.create({
		authPath,
		modelsPath: getModelsJsonPath(authPath),
		allowModelNetwork: false,
	});
}
