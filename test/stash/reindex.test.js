import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { StashDatabase } from "../../src/stash/db.js";
import { reindexStash } from "../../src/stash/reindex.js";

describe("reindexStash", () => {
	let tempDir;
	let db;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "reindex-test-"));
		db = new StashDatabase(tempDir);
	});

	afterEach(async () => {
		db.close();
		await fs.rm(tempDir, { recursive: true });
	});

	function createMockServer(classification) {
		return {
			server: {
				createMessage: async () => ({
					content: {
						type: "text",
						text: JSON.stringify(classification),
					},
				}),
			},
		};
	}

	it("should reindex a document and move it to the new topic", async () => {
		const storeDir = path.join(tempDir, "store", "old-topic");
		await fs.mkdir(storeDir, { recursive: true });
		const originalPath = path.join(storeDir, "doc.txt");
		await fs.writeFile(originalPath, "Document contents for reindexing.");

		const docId = db.insertDocument({
			filename: "doc.txt",
			fileType: "txt",
			summary: "Old summary",
			storePath: path.join("store", "old-topic", "doc.txt"),
			charCount: 35,
			primaryTopic: "old-topic",
			secondaryTopics: [],
		});

		const mockServer = createMockServer({
			summary: "New summary",
			primaryTopic: "new-topic",
			secondaryTopics: ["secondary-topic"],
			newTopics: [{ name: "new-topic", description: "New topic" }],
		});

		const result = await reindexStash({
			ids: [docId],
			_server: mockServer,
			_db: db,
			_fs: fs,
			_stashRoot: tempDir,
		});

		assert.strictEqual(result.reindexed.length, 1);
		assert.strictEqual(result.errors.length, 0);

		const newPath = path.join(tempDir, "store", "new-topic", "doc.txt");
		const oldExists = await fs
			.stat(originalPath)
			.then(() => true)
			.catch(() => false);
		assert.strictEqual(oldExists, false);

		const newExists = await fs
			.stat(newPath)
			.then(() => true)
			.catch(() => false);
		assert.strictEqual(newExists, true);

		const updated = db.getDocument(docId);
		assert.strictEqual(updated.summary, "New summary");
		assert.strictEqual(
			updated.store_path,
			path.join("store", "new-topic", "doc.txt"),
		);

		const primaryTopic = updated.topics.find((topic) => topic.isPrimary);
		assert.ok(primaryTopic);
		assert.strictEqual(primaryTopic.name, "new-topic");
	});
});
