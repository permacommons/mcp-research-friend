import { PDFParse } from "pdf-parse";

const truncate = (value, maxChars) => {
	if (value.length <= maxChars) {
		return { value, truncated: false };
	}
	return { value: value.slice(0, maxChars), truncated: true };
};

function searchText(text, query, contextChars = 200) {
	const matches = [];
	const lowerText = text.toLowerCase();
	const lowerQuery = query.toLowerCase();
	let pos = 0;

	while ((pos = lowerText.indexOf(lowerQuery, pos)) !== -1) {
		const start = Math.max(0, pos - contextChars);
		const end = Math.min(text.length, pos + query.length + contextChars);
		matches.push({
			position: pos,
			context: text.slice(start, end),
			prefix: start > 0 ? "..." : "",
			suffix: end < text.length ? "..." : "",
		});
		pos += query.length;
	}

	return matches;
}

export async function fetchPdf({
	url,
	maxChars = 40000,
	offset = 0,
	search = null,
	contextChars = 200,
}) {
	const parser = new PDFParse({ url });

	try {
		const [textResult, infoResult] = await Promise.all([
			parser.getText(),
			parser.getInfo(),
		]);

		const fullText = textResult.text;

		// If search is provided, return matches instead of full content
		if (search) {
			const matches = searchText(fullText, search, contextChars);
			return {
				url,
				title: infoResult.info?.Title || null,
				author: infoResult.info?.Author || null,
				pageCount: textResult.total,
				totalChars: fullText.length,
				search,
				matchCount: matches.length,
				matches,
				fetchedAt: new Date().toISOString(),
			};
		}

		// Otherwise return paginated content
		const sliced = fullText.slice(offset);
		const { value: content, truncated } = truncate(sliced, maxChars);

		return {
			url,
			title: infoResult.info?.Title || null,
			author: infoResult.info?.Author || null,
			creationDate: infoResult.info?.CreationDate || null,
			pageCount: textResult.total,
			totalChars: fullText.length,
			offset,
			content,
			fetchedAt: new Date().toISOString(),
			truncated,
		};
	} finally {
		await parser.destroy();
	}
}
