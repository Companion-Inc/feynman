import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateRawSync } from "node:zlib";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Reads one stored or deflated entry through the zip central directory.
function readZipEntry(zip: Buffer, name: string): Buffer | undefined {
	const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
	if (end < 0) return undefined;
	let offset = zip.readUInt32LE(end + 16);
	for (let index = zip.readUInt16LE(end + 10); index > 0; index -= 1) {
		if (zip.readUInt32LE(offset) !== 0x02014b50) return undefined;
		const method = zip.readUInt16LE(offset + 10);
		const size = zip.readUInt32LE(offset + 20);
		const nameLength = zip.readUInt16LE(offset + 28);
		const local = zip.readUInt32LE(offset + 42);
		if (zip.toString("utf8", offset + 46, offset + 46 + nameLength) === name) {
			const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
			const data = zip.subarray(start, start + size);
			return method === 0 ? data : method === 8 ? inflateRawSync(data) : undefined;
		}
		offset += 46 + nameLength + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32);
	}
	return undefined;
}

function decodeXml(text: string): string {
	return text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (_match, hex: string, dec: string, named: string) => {
		if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
		if (dec) return String.fromCodePoint(Number(dec));
		return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[named.toLowerCase()] ?? "";
	});
}

// Paragraph text of a .docx body: runs, tabs, and line breaks; no tables'
// layout, headers, footnotes, or images.
export function docxText(file: Buffer): string | undefined {
	const xml = readZipEntry(file, "word/document.xml")?.toString("utf8");
	if (!xml) return undefined;
	return xml
		.split("</w:p>")
		.map((paragraph) =>
			[...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)]
				.map((match) => (match[0] === "<w:tab/>" ? "\t" : match[0] === "<w:br/>" ? "\n" : decodeXml(match[1] ?? "")))
				.join(""),
		)
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

// document_parse needs LibreOffice for Word files, which most machines lack.
// Answer a .docx from its own XML instead of failing the read.
export function registerDocxFallback(pi: ExtensionAPI): void {
	pi.on("tool_result", (event, ctx) => {
		if (event.toolName !== "document_parse" || !event.isError) return undefined;
		const errorText = event.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
		const path = typeof event.input.path === "string" ? event.input.path.replace(/^@/, "") : "";
		if (!errorText.includes("LibreOffice is not installed") || !/\.doc[xm]$/i.test(path)) return undefined;
		let text: string | undefined;
		try {
			text = docxText(readFileSync(resolve(ctx.cwd, path)));
		} catch {
			return undefined;
		}
		if (!text) return undefined;
		return {
			isError: false,
			content: [{
				type: "text",
				text: `LibreOffice is not installed, so this is the document's paragraph text read directly from the .docx (no page layout, table structure, headers, footnotes, or images). Install LibreOffice for a full parse.\n\n${text}`,
			}],
		};
	});
}
