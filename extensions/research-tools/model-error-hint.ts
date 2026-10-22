import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Most failed research runs end on a provider error (quota, a key, a model the
// plan lacks). Pi follows them with its /bug hint, which reports to Pi's
// developers; this names the cause and the fix instead.
export function modelErrorHint(provider: string, error: string): string | undefined {
	const login = `feynman model login ${provider}`;
	if (/model_not_supported|requested model is not supported|not available to new users|does not support tools/i.test(error)) {
		return `Your ${provider} account can't use this model. Pick another with /model (or \`feynman model set\`).`;
	}
	if (/\b402\b|credit|billing|balance is insufficient|payment required/i.test(error)) {
		return `Your ${provider} account is out of credits. Add credits, or switch provider with /model.`;
	}
	if (/\b429\b|quota|rate.?limit|usage limit|resource.?exhausted|capacity|too many requests/i.test(error)) {
		return `${provider} is rate-limiting this account or its quota is used up. Wait and retry, or switch model with /model.`;
	}
	if (/\b40[13]\b|invalid.{0,20}(api.?key|x-api-key|token)|authentication|unauthori[sz]ed|invalid_grant|refresh token/i.test(error)) {
		return `${provider} rejected your credentials. Run \`${login}\` again, or check the API key you set.`;
	}
	if (/\b404\b|not found/i.test(error)) {
		return `${provider} has no such model or endpoint. Check the model id with /model, and the provider's baseUrl if you set one in models.json.`;
	}
	if (/refused to complete the request|stop_reason.{0,5}refusal/i.test(error)) {
		return `The model declined this request. Rephrase it, or try another model with /model.`;
	}
	if (/\b50[0-4]\b|overloaded|high demand|unavailable|timed out|timeout|terminated|connection error|fetch failed|ECONNRESET/i.test(error)) {
		return `${provider} failed or timed out; this is usually temporary. Retry, or switch model with /model.`;
	}
	return undefined;
}

export function registerModelErrorHint(pi: ExtensionAPI): void {
	// Pi retries rate limits and outages itself; hint only about the error the
	// run actually ended on, once it has settled.
	let lastError: AssistantMessage | undefined;
	pi.on("message_end", (event) => {
		const message = event.message;
		if (message.role !== "assistant") return;
		lastError = message.stopReason === "error" ? message : undefined;
	});
	pi.on("agent_settled", (event, ctx) => {
		const message = lastError;
		lastError = undefined;
		if (!message || event.aborted || !ctx.hasUI) return;
		const hint = modelErrorHint(message.provider, message.errorMessage ?? "");
		ctx.ui.notify(
			`${hint ?? `${message.provider} returned an error.`} If this looks like a Feynman bug, report it at https://github.com/Companion-Inc/feynman/issues (Pi's /bug goes to Pi's developers).`,
			"warning",
		);
	});
}
