import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StashDatabase } from "./db.js";

let stashRoot = null;
let database = null;

export function getStashRoot() {
	if (!stashRoot) {
		stashRoot = path.join(os.homedir(), ".research-friend");
	}
	return stashRoot;
}

export function getDatabase() {
	if (!database) {
		database = new StashDatabase(getStashRoot());
	}
	return database;
}

export async function initializeStash() {
	const root = getStashRoot();
	await fs.mkdir(path.join(root, "inbox"), { recursive: true });
	await fs.mkdir(path.join(root, "store"), { recursive: true });
	// Initialize DB (runs migrations)
	getDatabase();
}

export { StashDatabase } from "./db.js";
export { askStashDocument, extractFromStash } from "./extract.js";
export { detectFileType, extractText } from "./extractors.js";
export { listStash } from "./list.js";
export { processInbox } from "./process-inbox.js";
export { reindexStash } from "./reindex.js";
export { searchStash } from "./search.js";
