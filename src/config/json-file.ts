import { readFileSync } from "node:fs";

// Windows Notepad and PowerShell 5.1 save UTF-8 with a byte-order mark, which
// JSON.parse rejects. Pi strips it when it reads the same files.
export function parseJsonText(source: string): unknown {
	return JSON.parse(source.replace(/^﻿/, ""));
}

export function readJsonFile(path: string): unknown {
	return parseJsonText(readFileSync(path, "utf8"));
}
