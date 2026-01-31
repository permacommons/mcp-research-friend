export function extractResponseText(result) {
	const content = result.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join("\n");
	}
	if (content.type === "text") return content.text;
	return JSON.stringify(content);
}
