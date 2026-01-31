const MAX_CLASSIFICATION_CHARS = 50000;
const SAMPLE_CHUNKS = 5;

const CLASSIFICATION_PROMPT = `You are classifying a document into topics for a research stash.

## Existing Topics
{existingTopics}

## Rules
- Use existing topics when the document fits reasonably well
- Create new topics only when no existing topic is appropriate
- Topic names: lowercase-kebab-case, 1-3 words, descriptive
- Choose ONE primary topic and 0-3 secondary topics
- Primary topic = where you'd look for this document first

## Document
Filename: {filename}

Sampled content (up to ~50000 chars):
---
{text}
---

Respond with JSON only:
{
  "summary": "1-2 sentence summary",
  "primaryTopic": "existing-or-new-topic",
  "secondaryTopics": ["optional", "additional"],
  "newTopics": [{"name": "new-topic", "description": "Brief description"}]
}`;

function formatExistingTopics(topics) {
	if (topics.length === 0) {
		return "(none yet)";
	}
	return topics
		.map(
			(t) =>
				`- ${t.name} (${t.doc_count} docs): ${t.description || "No description"}`,
		)
		.join("\n");
}

export function sampleTextForClassification(
	text,
	{
		maxChars = MAX_CLASSIFICATION_CHARS,
		chunkCount = SAMPLE_CHUNKS,
		rng = Math.random,
	} = {},
) {
	if (text.length <= maxChars) {
		return text;
	}

	const clampedChunkCount = Math.max(3, Math.min(chunkCount, 8));
	const chunkSize = Math.max(200, Math.floor(maxChars / clampedChunkCount));
	const maxStart = Math.max(0, text.length - chunkSize);
	const midStart = Math.max(0, Math.floor(text.length / 2 - chunkSize / 2));
	const earlyStart = Math.min(chunkSize, maxStart);
	const startPositions = [];

	function pushUnique(position, label) {
		let pos = Math.max(0, Math.min(position, maxStart));
		let attempts = 0;
		while (
			startPositions.some(
				(entry) => Math.abs(entry.pos - pos) < chunkSize / 2,
			) &&
			attempts < 10
		) {
			pos = Math.max(0, Math.min(pos + chunkSize, maxStart));
			attempts += 1;
		}
		startPositions.push({ pos, label });
	}

	pushUnique(0, "start");
	pushUnique(earlyStart, "early");
	pushUnique(midStart, "middle");
	pushUnique(maxStart, "end");

	const remaining = clampedChunkCount - startPositions.length;
	for (let i = 0; i < remaining; i += 1) {
		const randomPos = Math.floor(rng() * (maxStart + 1));
		pushUnique(randomPos, "random");
	}

	return startPositions
		.sort((a, b) => a.pos - b.pos)
		.map(
			(segment) =>
				`\n[Sample ${segment.label} @${segment.pos}]\n` +
				text.slice(segment.pos, segment.pos + chunkSize),
		)
		.join("\n")
		.trim();
}

export async function classifyDocument(
	filename,
	text,
	existingTopics,
	_server,
) {
	const sampledText = sampleTextForClassification(text, {
		maxChars: MAX_CLASSIFICATION_CHARS,
	});
	const prompt = CLASSIFICATION_PROMPT.replace(
		"{existingTopics}",
		formatExistingTopics(existingTopics),
	)
		.replace("{filename}", filename)
		.replace("{text}", sampledText);

	const result = await _server.server.createMessage(
		{
			messages: [
				{
					role: "user",
					content: { type: "text", text: prompt },
				},
			],
			systemPrompt: "You classify documents. Respond only with valid JSON.",
			maxTokens: 512,
		},
		{ timeout: 60000 },
	);

	// Extract text from response
	const responseContent = result.content;
	const responseText =
		typeof responseContent === "string"
			? responseContent
			: Array.isArray(responseContent)
				? responseContent
						.filter((block) => block.type === "text")
						.map((block) => block.text)
						.join("\n")
				: responseContent.type === "text"
					? responseContent.text
					: JSON.stringify(responseContent);

	// Parse JSON from response
	const jsonMatch = responseText.match(/\{[\s\S]*\}/);
	if (!jsonMatch) {
		throw new Error("No JSON found in classification response");
	}
	return JSON.parse(jsonMatch[0]);
}
