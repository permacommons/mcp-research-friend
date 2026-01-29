import path from "node:path";
import Database from "better-sqlite3";

const SCHEMA_VERSION = 1;

const MIGRATIONS = {
	1: `
		CREATE TABLE topics (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT UNIQUE NOT NULL,
			description TEXT,
			created_at TEXT DEFAULT (datetime('now'))
		);

		CREATE TABLE documents (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			filename TEXT NOT NULL,
			file_type TEXT NOT NULL,
			summary TEXT,
			store_path TEXT NOT NULL,
			char_count INTEGER,
			created_at TEXT DEFAULT (datetime('now'))
		);

		CREATE TABLE document_topics (
			doc_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
			topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE RESTRICT,
			is_primary BOOLEAN NOT NULL DEFAULT FALSE,
			PRIMARY KEY (doc_id, topic_id)
		);

		CREATE UNIQUE INDEX idx_one_primary_per_doc
			ON document_topics(doc_id) WHERE is_primary = TRUE;
	`,
};

export class StashDatabase {
	constructor(stashRoot, { _Database = Database } = {}) {
		const dbPath = path.join(stashRoot, "stash.db");
		this.db = new _Database(dbPath);
		this.db.pragma("foreign_keys = ON");
		this._runMigrations();
	}

	_runMigrations() {
		const currentVersion = this.db.pragma("user_version", { simple: true });

		for (let v = currentVersion + 1; v <= SCHEMA_VERSION; v++) {
			if (MIGRATIONS[v]) {
				this.db.exec(MIGRATIONS[v]);
			}
		}

		if (currentVersion !== SCHEMA_VERSION) {
			this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
		}
	}

	getSchemaVersion() {
		return this.db.pragma("user_version", { simple: true });
	}

	getOrCreateTopic({ name, description = null }) {
		const existing = this.db
			.prepare("SELECT id FROM topics WHERE name = ?")
			.get(name);
		if (existing) {
			return existing.id;
		}
		const result = this.db
			.prepare("INSERT INTO topics (name, description) VALUES (?, ?)")
			.run(name, description);
		return result.lastInsertRowid;
	}

	insertDocument({
		filename,
		fileType,
		summary,
		storePath,
		charCount,
		primaryTopic,
		secondaryTopics = [],
	}) {
		const insertDoc = this.db.prepare(`
			INSERT INTO documents (filename, file_type, summary, store_path, char_count)
			VALUES (?, ?, ?, ?, ?)
		`);

		const insertDocTopic = this.db.prepare(`
			INSERT INTO document_topics (doc_id, topic_id, is_primary)
			VALUES (?, ?, ?)
		`);

		const transaction = this.db.transaction(() => {
			const docResult = insertDoc.run(
				filename,
				fileType,
				summary,
				storePath,
				charCount,
			);
			const docId = docResult.lastInsertRowid;

			// Get or create primary topic
			const primaryTopicId = this.getOrCreateTopic({ name: primaryTopic });
			insertDocTopic.run(docId, primaryTopicId, 1);

			// Get or create secondary topics
			for (const topicName of secondaryTopics) {
				const topicId = this.getOrCreateTopic({ name: topicName });
				insertDocTopic.run(docId, topicId, 0);
			}

			return docId;
		});

		return transaction();
	}

	getDocument(id) {
		const doc = this.db
			.prepare(
				`
			SELECT id, filename, file_type, summary, store_path, char_count, created_at
			FROM documents WHERE id = ?
		`,
			)
			.get(id);

		if (!doc) {
			return null;
		}

		const topics = this.db
			.prepare(
				`
			SELECT t.name, t.description, dt.is_primary
			FROM document_topics dt
			JOIN topics t ON dt.topic_id = t.id
			WHERE dt.doc_id = ?
		`,
			)
			.all(id);

		return {
			...doc,
			topics: topics.map((t) => ({
				name: t.name,
				description: t.description,
				isPrimary: Boolean(t.is_primary),
			})),
		};
	}

	getTopics() {
		return this.db
			.prepare("SELECT id, name, description FROM topics ORDER BY name")
			.all();
	}

	getTopicsWithCounts() {
		return this.db
			.prepare(
				`
			SELECT t.id, t.name, t.description, COUNT(dt.doc_id) as doc_count
			FROM topics t
			LEFT JOIN document_topics dt ON t.id = dt.topic_id
			GROUP BY t.id
			ORDER BY doc_count DESC, t.name
		`,
			)
			.all();
	}

	getDocumentsByTopic(topicName, limit = 50, offset = 0) {
		return this.db
			.prepare(
				`
			SELECT d.id, d.filename, d.file_type, d.summary, d.store_path, d.char_count, d.created_at,
			       dt.is_primary
			FROM documents d
			JOIN document_topics dt ON d.id = dt.doc_id
			JOIN topics t ON dt.topic_id = t.id
			WHERE t.name = ?
			ORDER BY d.created_at DESC
			LIMIT ? OFFSET ?
		`,
			)
			.all(topicName, limit, offset);
	}

	getDocumentByStorePath(storePath) {
		return this.db
			.prepare(
				`
			SELECT id, filename, file_type, summary, store_path, char_count, created_at
			FROM documents WHERE store_path = ?
		`,
			)
			.get(storePath);
	}

	getAllDocuments() {
		return this.db
			.prepare(
				`
			SELECT id, filename, file_type, summary, store_path, char_count, created_at
			FROM documents ORDER BY created_at DESC
		`,
			)
			.all();
	}

	searchByFilename(terms, topic = null) {
		// terms is an array of search terms (from parseSearchQuery)
		// Match if ANY term appears in filename
		if (!Array.isArray(terms) || terms.length === 0) return [];

		const patterns = terms.map((t) => `%${t}%`);
		const likeClauses = patterns
			.map(() => "LOWER(d.filename) LIKE LOWER(?)")
			.join(" OR ");

		if (topic) {
			return this.db
				.prepare(
					`
				SELECT DISTINCT d.id, d.filename, d.file_type, d.summary, d.store_path, d.char_count, d.created_at
				FROM documents d
				JOIN document_topics dt ON d.id = dt.doc_id
				JOIN topics t ON dt.topic_id = t.id
				WHERE (${likeClauses}) AND t.name = ?
				ORDER BY d.created_at DESC
			`,
				)
				.all(...patterns, topic);
		}
		return this.db
			.prepare(
				`
			SELECT d.id, d.filename, d.file_type, d.summary, d.store_path, d.char_count, d.created_at
			FROM documents d
			WHERE ${likeClauses}
			ORDER BY d.created_at DESC
		`,
			)
			.all(...patterns);
	}

	close() {
		this.db.close();
	}
}
