import path from "node:path";

export const STASH_INBOX_DIR = "inbox";
export const STASH_STORE_DIR = "store";
const TOPIC_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+){0,2}$/;

export function getInboxPath(stashRoot) {
	return path.join(stashRoot, STASH_INBOX_DIR);
}

export function getStoreRoot(stashRoot) {
	return path.join(stashRoot, STASH_STORE_DIR);
}

export function buildStorePath(primaryTopic, filename) {
	if (!isValidTopicName(primaryTopic)) {
		throw new Error(`Invalid topic name: ${primaryTopic}`);
	}
	return path.join(STASH_STORE_DIR, primaryTopic, filename);
}

export function getAbsoluteStorePath(stashRoot, storePath) {
	return path.join(stashRoot, storePath);
}

export function isValidTopicName(topic) {
	if (typeof topic !== "string" || topic.length === 0) return false;
	if (topic.includes("/") || topic.includes("\\") || topic.includes("..")) {
		return false;
	}
	return TOPIC_PATTERN.test(topic);
}
