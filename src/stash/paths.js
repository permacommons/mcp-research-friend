import path from "node:path";

export const STASH_INBOX_DIR = "inbox";
export const STASH_STORE_DIR = "store";

export function getInboxPath(stashRoot) {
	return path.join(stashRoot, STASH_INBOX_DIR);
}

export function getStoreRoot(stashRoot) {
	return path.join(stashRoot, STASH_STORE_DIR);
}

export function buildStorePath(primaryTopic, filename) {
	return path.join(STASH_STORE_DIR, primaryTopic, filename);
}

export function getAbsoluteStorePath(stashRoot, storePath) {
	return path.join(stashRoot, storePath);
}
