import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { PDFParse } from "pdf-parse";

export async function extractText(
	filePath,
	fileType,
	{ _PDFParse = PDFParse, _JSDOM = JSDOM, _Readability = Readability } = {},
) {
	if (fileType === "pdf") {
		const fileUrl = pathToFileURL(filePath).href;
		const parser = new _PDFParse({ url: fileUrl });
		try {
			const result = await parser.getText();
			return result.text;
		} finally {
			await parser.destroy();
		}
	}

	if (fileType === "html") {
		const html = await fs.readFile(filePath, "utf-8");
		const dom = new _JSDOM(html);
		const reader = new _Readability(dom.window.document);
		const article = reader.parse();
		if (article?.textContent) {
			return article.textContent;
		}
		// Fallback to body text if Readability fails
		return dom.window.document.body?.textContent || "";
	}

	if (fileType === "md" || fileType === "txt") {
		return await fs.readFile(filePath, "utf-8");
	}

	throw new Error(`Unsupported file type: ${fileType}`);
}

// File type configuration - single source of truth
const FILE_TYPE_CONFIG = {
	pdf: { extensions: ["pdf"], needsExtraction: true },
	html: { extensions: ["html", "htm"], needsExtraction: true },
	md: { extensions: ["md", "markdown"], needsExtraction: false },
	txt: { extensions: ["txt"], needsExtraction: false },
};

// Derived sets for use elsewhere
export const PLAINTEXT_TYPES = new Set(
	Object.entries(FILE_TYPE_CONFIG)
		.filter(([_, config]) => !config.needsExtraction)
		.map(([type]) => type),
);

export const EXTRACTION_TYPES = new Set(
	Object.entries(FILE_TYPE_CONFIG)
		.filter(([_, config]) => config.needsExtraction)
		.map(([type]) => type),
);

// Build extension -> type lookup
const EXT_TO_TYPE = new Map();
for (const [type, config] of Object.entries(FILE_TYPE_CONFIG)) {
	for (const ext of config.extensions) {
		EXT_TO_TYPE.set(ext, type);
	}
}

export function detectFileType(filename) {
	const ext = filename.toLowerCase().split(".").pop();
	return EXT_TO_TYPE.get(ext) || null;
}
