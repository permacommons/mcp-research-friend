export function listStash({ topic = null, limit = 50, offset = 0, _db }) {
	// Get topics summary for context
	const topics = _db.getTopicsWithCounts();
	const topicsSummary = topics.map((t) => ({
		name: t.name,
		description: t.description,
		docCount: t.doc_count,
	}));

	// If no topic specified, list all documents
	if (!topic) {
		const allDocs = _db.getAllDocuments();
		const paged = allDocs.slice(offset, offset + limit);
		return {
			type: "all",
			totalDocuments: allDocs.length,
			count: paged.length,
			offset,
			limit,
			topics: topicsSummary,
			documents: paged.map((d) => ({
				id: d.id,
				filename: d.filename,
				fileType: d.file_type,
				summary: d.summary,
				charCount: d.char_count,
				createdAt: d.created_at,
			})),
		};
	}

	// List documents with the specified topic
	const documents = _db.getDocumentsByTopic(topic, limit, offset);
	return {
		type: "topic",
		topic,
		count: documents.length,
		offset,
		limit,
		topics: topicsSummary,
		documents: documents.map((d) => ({
			id: d.id,
			filename: d.filename,
			fileType: d.file_type,
			summary: d.summary,
			charCount: d.char_count,
			isPrimary: Boolean(d.is_primary),
			createdAt: d.created_at,
		})),
	};
}
