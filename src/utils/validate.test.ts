import { describe, expect, it } from "vitest";
import { assertSafeFilename } from "./validate.js";

describe("assertSafeFilename", () => {
	it("allows undefined (optional filename)", () => {
		expect(() => assertSafeFilename(undefined)).not.toThrow();
	});

	it("allows an empty string (falsy, treated as 'not provided')", () => {
		expect(() => assertSafeFilename("")).not.toThrow();
	});

	it("allows letters, digits, dots, underscores, and hyphens", () => {
		expect(() => assertSafeFilename("Trace_2024-01-01.v2.utrace")).not.toThrow();
	});

	it("rejects a Unix absolute path — the os.path.join() escape this guards against", () => {
		// os.path.join(base, filename) discards `base` entirely when filename is
		// absolute, so an unvalidated filename redirects the write anywhere.
		expect(() => assertSafeFilename("/etc/passwd")).toThrow(/only letters, digits/);
	});

	it("rejects a Windows absolute path", () => {
		expect(() => assertSafeFilename("C:\\Windows\\System32\\evil.dll")).toThrow();
	});

	it("rejects path traversal sequences", () => {
		expect(() => assertSafeFilename("../../etc/passwd")).toThrow();
	});

	it("rejects embedded path separators even without traversal", () => {
		expect(() => assertSafeFilename("subdir/file.png")).toThrow();
	});

	it("rejects spaces and other non-allowlisted characters", () => {
		expect(() => assertSafeFilename("my file.png")).toThrow();
		expect(() => assertSafeFilename("file;rm -rf.png")).toThrow();
	});

	it("includes the custom field name in the error message when provided", () => {
		expect(() => assertSafeFilename("bad path", "csv_filename")).toThrow(/csv_filename/);
	});
});
