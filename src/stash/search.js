import { spawn } from "node:child_process";
import path from "node:path";
import { rgPath } from "@vscode/ripgrep";
import { EXTRACTION_TYPES } from "./extractors.js";

/**
 * Parse a search query into terms.
 * - Quoted strings (single or double) become exact phrase terms
 * - Unquoted words become individual terms
 * Returns array of terms to OR together.
 */
export function parseSearchQuery(query) {
	const terms = [];
	// Match quoted strings (single or double) or unquoted words
	const regex = /"([^"]+)"|'([^']+)'|(\S+)/g;
	let match;
	while (true) {
		match = regex.exec(query);
		if (match === null) {
			break;
		}
		// match[1] = double-quoted, match[2] = single-quoted, match[3] = unquoted word
		const term = match[1] || match[2] || match[3];
		if (term) {
			terms.push(term);
		}
	}
	return terms;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a ripgrep-compatible regex pattern from search terms.
 * Multiple terms become alternation: (term1|term2|term3)
 */
function buildRipgrepPattern(terms) {
	if (terms.length === 0) return "";
	if (terms.length === 1) return escapeRegex(terms[0]);
	return `(${terms.map(escapeRegex).join("|")})`;
}

function runRipgrep(pattern, searchPath, contextLines = 2) {
	return new Promise((resolve, reject) => {
		const args = [
			"--json",
			"-i", // case insensitive
			"-C",
			String(contextLines), // context lines
			"--glob",
			"*.txt", // extracted text from PDF/HTML
			"--glob",
			"*.md", // markdown files (searched directly)
			pattern,
			searchPath,
		];

		const rg = spawn(rgPath, args);
		const chunks = [];
		let stderr = "";

		rg.stdout.on("data", (data) => chunks.push(data));
		rg.stderr.on("data", (data) => {
			stderr += data.toString();
		});

		rg.on("close", (code) => {
			// ripgrep returns 1 when no matches found, which is fine
			if (code !== 0 && code !== 1) {
				reject(new Error(`ripgrep failed: ${stderr}`));
				return;
			}
			const output = Buffer.concat(chunks).toString("utf-8");
			resolve(output);
		});

		rg.on("error", reject);
	});
}

function parseRipgrepOutput(output, stashRoot) {
	const lines = output.trim().split("\n").filter(Boolean);
	const matchesByFile = new Map();

	for (const line of lines) {
		const msg = JSON.parse(line);
		if (msg.type !== "match") continue;

		const filePath = msg.data.path.text;
		// Convert absolute path to relative store path
		const relativePath = path.relative(stashRoot, filePath);

		// Determine store path:
		// - Extracted files (.pdf.txt, .html.txt) -> strip .txt suffix
		// - Original plaintext files (.txt, .md) -> keep as-is
		// Check if this is an extraction by seeing if removing .txt leaves a known extraction type
		const withoutTxt = relativePath.replace(/\.txt$/, "");
		const possibleExt = withoutTxt.split(".").pop()?.toLowerCase();
		const isExtraction =
			relativePath.endsWith(".txt") && EXTRACTION_TYPES.has(possibleExt);
		const storePath = isExtraction ? withoutTxt : relativePath;

		if (!matchesByFile.has(storePath)) {
			matchesByFile.set(storePath, {
				storePath,
				matches: [],
			});
		}

		const lineText = msg.data.lines.text.trim();
		const lineNum = msg.data.line_number;

		matchesByFile.get(storePath).matches.push({
			line: lineNum,
			text: lineText,
		});
	}

	return Array.from(matchesByFile.values());
}

export async function searchStash({
	query,
	topic = null,
	limit = 20,
	offset = 0,
	contextLines = 2,
	_db,
	_stashRoot,
	_runRipgrep = runRipgrep,
}) {
	// Parse query into terms (handles quoted phrases)
	const terms = parseSearchQuery(query);
	if (terms.length === 0) {
		return {
			query,
			topic,
			totalMatches: 0,
			count: 0,
			offset,
			limit,
			results: [],
		};
	}

	// Track seen document IDs to avoid duplicates
	const seenIds = new Set();
	const results = [];

	// First, search filenames via DB (these appear first)
	const filenameMatches = _db.searchByFilename(terms, topic);
	for (const doc of filenameMatches) {
		seenIds.add(doc.id);
		results.push({
			id: doc.id,
			filename: doc.filename,
			fileType: doc.file_type,
			summary: doc.summary,
			charCount: doc.char_count,
			createdAt: doc.created_at,
			matchCount: 0,
			matchType: "filename",
			snippet: doc.summary || "",
		});
	}

	// Then search content via ripgrep
	const searchPath = topic
		? path.join(_stashRoot, "store", topic)
		: path.join(_stashRoot, "store");

	const rgPattern = buildRipgrepPattern(terms);
	const output = await _runRipgrep(rgPattern, searchPath, contextLines);
	const fileMatches = parseRipgrepOutput(output, _stashRoot);

	// Join with document metadata from DB
	for (const fm of fileMatches) {
		const doc = _db.getDocumentByStorePath(fm.storePath);
		if (doc && !seenIds.has(doc.id)) {
			seenIds.add(doc.id);
			// Build snippet from first few matches
			const snippet = fm.matches
				.slice(0, 3)
				.map((m) => m.text)
				.join(" ... ");

			results.push({
				id: doc.id,
				filename: doc.filename,
				fileType: doc.file_type,
				summary: doc.summary,
				charCount: doc.char_count,
				createdAt: doc.created_at,
				matchCount: fm.matches.length,
				matchType: "content",
				snippet,
			});
		}
	}

	// Apply pagination
	const paginated = results.slice(offset, offset + limit);

	return {
		query,
		topic,
		totalMatches: results.length,
		count: paginated.length,
		offset,
		limit,
		results: paginated,
	};
}
