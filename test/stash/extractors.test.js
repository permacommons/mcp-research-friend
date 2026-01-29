import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { detectFileType, extractText } from "../../src/stash/extractors.js";

describe("extractors", () => {
	describe("detectFileType", () => {
		it("should detect PDF files", () => {
			assert.strictEqual(detectFileType("document.pdf"), "pdf");
			assert.strictEqual(detectFileType("DOCUMENT.PDF"), "pdf");
		});

		it("should detect HTML files", () => {
			assert.strictEqual(detectFileType("page.html"), "html");
			assert.strictEqual(detectFileType("page.htm"), "html");
		});

		it("should detect Markdown files", () => {
			assert.strictEqual(detectFileType("README.md"), "md");
			assert.strictEqual(detectFileType("notes.markdown"), "md");
		});

		it("should detect plain text files", () => {
			assert.strictEqual(detectFileType("notes.txt"), "txt");
			assert.strictEqual(detectFileType("README.TXT"), "txt");
		});

		it("should return null for unsupported types", () => {
			assert.strictEqual(detectFileType("image.png"), null);
			assert.strictEqual(detectFileType("data.json"), null);
		});
	});

	describe("extractText", () => {
		let tempDir;

		beforeEach(async () => {
			tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "extract-test-"));
		});

		afterEach(async () => {
			await fs.rm(tempDir, { recursive: true });
		});

		it("should extract text from markdown files", async () => {
			const mdPath = path.join(tempDir, "test.md");
			await fs.writeFile(mdPath, "# Hello World\n\nThis is a test document.");

			const text = await extractText(mdPath, "md");
			assert.ok(text.includes("# Hello World"));
			assert.ok(text.includes("This is a test document."));
		});

		it("should extract text from plain text files", async () => {
			const txtPath = path.join(tempDir, "test.txt");
			await fs.writeFile(txtPath, "Plain text content here.");

			const text = await extractText(txtPath, "txt");
			assert.strictEqual(text, "Plain text content here.");
		});

		it("should extract text from HTML files", async () => {
			const htmlPath = path.join(tempDir, "test.html");
			await fs.writeFile(
				htmlPath,
				`<!DOCTYPE html>
<html>
<head><title>Test Page</title></head>
<body>
<article>
<h1>Test Article</h1>
<p>This is the main content of the article.</p>
</article>
</body>
</html>`,
			);

			const text = await extractText(htmlPath, "html");
			assert.ok(text.includes("Test Article"));
			assert.ok(text.includes("main content"));
		});

		it("should extract text from PDF files using mock", async () => {
			const pdfPath = path.join(tempDir, "test.pdf");
			await fs.writeFile(pdfPath, "fake pdf content");

			function MockPDFParse() {}
			MockPDFParse.prototype.getText = async () => ({
				text: "Extracted PDF text content",
				total: 1,
			});
			MockPDFParse.prototype.destroy = async () => {};

			const text = await extractText(pdfPath, "pdf", {
				_PDFParse: MockPDFParse,
			});
			assert.strictEqual(text, "Extracted PDF text content");
		});

		it("should throw for unsupported file types", async () => {
			await assert.rejects(async () => extractText("/fake/path.xyz", "xyz"), {
				message: "Unsupported file type: xyz",
			});
		});
	});
});
