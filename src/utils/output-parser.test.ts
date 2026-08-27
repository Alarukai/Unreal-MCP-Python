import { describe, expect, it } from "vitest";
import { parseBuildOutput } from "./output-parser.js";

describe("parseBuildOutput", () => {
	it("parses an MSVC error with line and column", () => {
		const result = parseBuildOutput(
			"C:\\Project\\Source\\Foo.cpp(42,7): error C2065: 'bar': undeclared identifier",
		);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toMatchObject({
			file: "C:\\Project\\Source\\Foo.cpp",
			line: 42,
			column: 7,
			severity: "error",
			code: "C2065",
			message: "'bar': undeclared identifier",
		});
	});

	it("parses an MSVC error without a column", () => {
		const result = parseBuildOutput("Foo.cpp(10): error C1234: something broke");
		expect(result.errors[0]).toMatchObject({ file: "Foo.cpp", line: 10, column: 0 });
	});

	it("parses an MSVC warning separately from errors", () => {
		const result = parseBuildOutput("Foo.cpp(5,1): warning C4996: deprecated");
		expect(result.errors).toHaveLength(0);
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toMatchObject({ severity: "warning", code: "C4996" });
	});

	it("parses a Clang error with file:line:col format", () => {
		const result = parseBuildOutput("/src/Foo.cpp:12:3: error: use of undeclared identifier 'x'");
		expect(result.errors[0]).toMatchObject({
			file: "/src/Foo.cpp",
			line: 12,
			column: 3,
			code: "",
			message: "use of undeclared identifier 'x'",
		});
	});

	it("parses a Clang warning", () => {
		const result = parseBuildOutput("/src/Foo.cpp:1:1: warning: unused variable 'y'");
		expect(result.warnings).toHaveLength(1);
		expect(result.errors).toHaveLength(0);
	});

	it("tracks the maximum progress seen, not the last line", () => {
		const output = [
			"[5/100] Compile A.cpp",
			"[3/100] Compile B.cpp",
			"[10/100] Compile C.cpp",
		].join("\n");
		const result = parseBuildOutput(output);
		expect(result.progress).toBe(10);
	});

	it("reports 100% progress on an explicit success line even without progress markers", () => {
		const result = parseBuildOutput("Build succeeded.");
		expect(result.succeeded).toBe(true);
		expect(result.progress).toBe(100);
	});

	it("reports 0% progress on failure without progress markers", () => {
		const result = parseBuildOutput("Build failed.");
		expect(result.succeeded).toBe(false);
		expect(result.progress).toBe(0);
	});

	it("infers success from zero errors when no explicit success/failure line is present", () => {
		const result = parseBuildOutput("[1/1] Compile A.cpp\nsome other log line");
		expect(result.succeeded).toBe(true);
	});

	it("infers failure from a nonzero error count when no explicit line is present", () => {
		const result = parseBuildOutput("Foo.cpp(1,1): error C0001: bad\nsome other log line");
		expect(result.succeeded).toBe(false);
	});

	it("lets a later explicit failure line override an earlier explicit success line", () => {
		const result = parseBuildOutput("Build succeeded.\nBUILD FAILED");
		expect(result.succeeded).toBe(false);
	});

	it("counts multiple diagnostics across mixed formats", () => {
		const output = [
			"A.cpp(1,1): error C0001: first",
			"B.cpp:2:2: error: second",
			"C.cpp(3,3): warning C0002: third",
		].join("\n");
		const result = parseBuildOutput(output);
		expect(result.errors).toHaveLength(2);
		expect(result.warnings).toHaveLength(1);
		expect(result.summary).toContain("2 error(s)");
		expect(result.summary).toContain("1 warning(s)");
	});

	it("returns an empty, succeeded result for empty output", () => {
		const result = parseBuildOutput("");
		expect(result.errors).toEqual([]);
		expect(result.warnings).toEqual([]);
		expect(result.succeeded).toBe(true);
	});
});
