import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { rgPath } from "@vscode/ripgrep";
import { EXTRACTION_TYPES } from "./extractors.js";
import { getStoreRoot } from "./paths.js";

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
			"--", // end of options (prevents pattern being parsed as flag)
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

function getStorePath(filePath, stashRoot) {
	const relativePath = path.relative(stashRoot, filePath);

	// Determine store path:
	// - Extracted files (.pdf.txt, .html.txt) -> strip .txt suffix
	// - Original plaintext files (.txt, .md) -> keep as-is
	const withoutTxt = relativePath.replace(/\.txt$/, "");
	const possibleExt = withoutTxt.split(".").pop()?.toLowerCase();
	const isExtraction =
		relativePath.endsWith(".txt") && EXTRACTION_TYPES.has(possibleExt);
	return isExtraction ? withoutTxt : relativePath;
}

function parseRipgrepOutput(output, stashRoot) {
	const lines = output.trim().split("\n").filter(Boolean);
	const matchesByFile = new Map();

	// First pass: collect all lines (matches and context) grouped by file
	const linesByFile = new Map();

	for (const line of lines) {
		const msg = JSON.parse(line);
		if (msg.type !== "match" && msg.type !== "context") continue;

		const filePath = msg.data.path.text;
		const storePath = getStorePath(filePath, stashRoot);

		if (!linesByFile.has(storePath)) {
			linesByFile.set(storePath, []);
		}

		linesByFile.get(storePath).push({
			line: msg.data.line_number,
			text: msg.data.lines.text.trim(),
			isMatch: msg.type === "match",
		});
	}

	// Second pass: group consecutive lines into match regions
	for (const [storePath, fileLines] of linesByFile) {
		// Sort by line number
		fileLines.sort((a, b) => a.line - b.line);

		// Group consecutive lines (gap of more than 1 line = new group)
		const groups = [];
		let currentGroup = [];

		for (const lineInfo of fileLines) {
			if (
				currentGroup.length === 0 ||
				lineInfo.line <= currentGroup[currentGroup.length - 1].line + 1
			) {
				currentGroup.push(lineInfo);
			} else {
				if (currentGroup.length > 0) groups.push(currentGroup);
				currentGroup = [lineInfo];
			}
		}
		if (currentGroup.length > 0) groups.push(currentGroup);

		// Convert groups to matches (use first match line as the anchor)
		const matches = groups.map((group) => {
			const matchLine = group.find((l) => l.isMatch) || group[0];
			const combinedText = group.map((l) => l.text).join(" ");
			return {
				line: matchLine.line,
				text: combinedText,
			};
		});

		matchesByFile.set(storePath, { storePath, matches });
	}

	return Array.from(matchesByFile.values());
}

export async function searchStash({
	query,
	topic = null,
	ids = null,
	limit = 20,
	offset = 0,
	maxMatchesPerDoc = 50,
	context = 1,
	_db,
	_stashRoot,
	_runRipgrep = runRipgrep,
}) {
	const emptyResult = () => ({
		query,
		topic,
		ids: ids || undefined,
		totalMatches: 0,
		count: 0,
		offset,
		limit,
		results: [],
	});

	// Validate topic to prevent path traversal
	if (topic && (topic.includes("..") || topic.includes("/"))) {
		return emptyResult();
	}

	// Parse query into terms (handles quoted phrases)
	const terms = parseSearchQuery(query);
	if (terms.length === 0) {
		return emptyResult();
	}

	// Convert ids to a Set for fast lookup (if provided and non-empty)
	const idsFilter = ids && ids.length > 0 ? new Set(ids) : null;

	// Search content via ripgrep (OR pattern to find candidates)
	const searchPath = topic
		? path.join(getStoreRoot(_stashRoot), topic)
		: getStoreRoot(_stashRoot);

	// If search path doesn't exist, return empty results
	if (!fs.existsSync(searchPath)) {
		return emptyResult();
	}

	const rgPattern = buildRipgrepPattern(terms);
	const output = await _runRipgrep(rgPattern, searchPath, context);
	const fileMatches = parseRipgrepOutput(output, _stashRoot);

	// Filter matches: each match line must contain ALL terms (AND logic)
	const lowerTerms = terms.map((t) => t.toLowerCase());
	const filteredFileMatches = [];

	for (const fm of fileMatches) {
		// Filter to only matches where the line contains ALL terms
		const matchesWithAllTerms = fm.matches.filter((m) => {
			const lowerText = m.text.toLowerCase();
			return lowerTerms.every((term) => lowerText.includes(term));
		});

		if (matchesWithAllTerms.length > 0) {
			filteredFileMatches.push({
				...fm,
				matches: matchesWithAllTerms,
			});
		}
	}

	// Build results map by doc ID
	const resultsMap = new Map();

	// Add content matches
	for (const fm of filteredFileMatches) {
		const doc = _db.getDocumentByStorePath(fm.storePath);
		if (!doc) continue;
		if (idsFilter && !idsFilter.has(doc.id)) continue;

		// Limit matches per document
		const limitedMatches = fm.matches.slice(0, maxMatchesPerDoc);

		resultsMap.set(doc.id, {
			id: doc.id,
			filename: doc.filename,
			fileType: doc.file_type,
			summary: doc.summary,
			charCount: doc.char_count,
			createdAt: doc.created_at,
			matchType: "content",
			matches: limitedMatches.map((m) => ({ line: m.line, context: m.text })),
		});
	}

	// Check filename matches (must contain ALL terms)
	const filenameMatches = _db.searchByFilename(terms, topic);
	for (const doc of filenameMatches) {
		if (idsFilter && !idsFilter.has(doc.id)) continue;

		// Check if filename contains ALL terms (AND logic)
		const lowerFilename = doc.filename.toLowerCase();
		const allTermsInFilename = lowerTerms.every((term) =>
			lowerFilename.includes(term),
		);
		if (!allTermsInFilename) continue;

		if (resultsMap.has(doc.id)) {
			// Already has content matches - upgrade matchType to include filename
			resultsMap.get(doc.id).matchType = "filename+content";
		} else {
			// Filename-only match
			resultsMap.set(doc.id, {
				id: doc.id,
				filename: doc.filename,
				fileType: doc.file_type,
				summary: doc.summary,
				charCount: doc.char_count,
				createdAt: doc.created_at,
				matchType: "filename",
				matches: [],
			});
		}
	}

	// Convert to array, prioritize filename matches
	const results = Array.from(resultsMap.values()).sort((a, b) => {
		// filename or filename+content first
		const aHasFilename = a.matchType.includes("filename");
		const bHasFilename = b.matchType.includes("filename");
		if (aHasFilename && !bHasFilename) return -1;
		if (!aHasFilename && bHasFilename) return 1;
		return 0;
	});

	// Apply pagination
	const paginated = results.slice(offset, offset + limit);

	return {
		query,
		topic,
		ids: ids || undefined,
		totalMatches: results.length,
		count: paginated.length,
		offset,
		limit,
		results: paginated,
	};
}
