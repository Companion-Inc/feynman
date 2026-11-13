import { XMLParser } from "fast-xml-parser";

// Keep mixed content in document order; object-mode XML groups repeated tags
// and moves their surrounding text into a separate #text property.
const parser = new XMLParser({
	preserveOrder: true,
	ignoreAttributes: false,
	removeNSPrefix: true,
	trimValues: false,
	parseTagValue: false,
});

const blockTags = new Set([
	"abstract", "sec", "title", "p", "caption", "label", "list", "list-item",
	"def-list", "def-item", "term", "def", "disp-quote", "verse-line", "break",
	"tr", "td", "th",
]);

function entries(value: unknown): Array<[string, unknown]> {
	return value && typeof value === "object" && !Array.isArray(value)
		? Object.entries(value).filter(([key]) => key !== ":@" && !key.startsWith("?"))
		: [];
}

export function parseOrderedJats(xml: string): unknown {
	return parser.parse(xml);
}

export function jatsChildren(value: unknown, tag: string): unknown[] {
	return (Array.isArray(value) ? value : [value]).flatMap((node) =>
		entries(node).filter(([key]) => key === tag).map(([, children]) => children));
}

export function jatsNodes(value: unknown, tag: string): unknown[] {
	if (Array.isArray(value)) return value.flatMap((node) => jatsNodes(node, tag));
	return entries(value).flatMap(([key, children]) => [
		...(key === tag ? [value] : []),
		...jatsNodes(children, tag),
	]);
}

export function jatsDescendants(value: unknown, tag: string): unknown[] {
	return jatsNodes(value, tag).flatMap((node) => jatsChildren(node, tag));
}

export function jatsAttribute(node: unknown, name: string): string | undefined {
	if (!node || typeof node !== "object") return undefined;
	const attributes = (node as Record<string, unknown>)[":@"];
	if (!attributes || typeof attributes !== "object") return undefined;
	const value = (attributes as Record<string, unknown>)[`@_${name}`];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function jatsText(value: unknown, excludedTags = new Set<string>()): string {
	function text(node: unknown): string {
		if (typeof node === "string" || typeof node === "number") return String(node);
		if (Array.isArray(node)) return node.map(text).join("");
		return entries(node).map(([tag, children]) => {
			if (excludedTags.has(tag)) return " ";
			const content = text(children);
			return blockTags.has(tag) ? ` ${content} ` : content;
		}).join("");
	}
	return text(value).replace(/\s+/g, " ").trim();
}
