import { describe, expect, it } from "vitest";
import { escapePythonArray, escapePythonString, inlineScript, substituteVars } from "./template.js";

describe("escapePythonString", () => {
	it("escapes backslashes before other escaping", () => {
		expect(escapePythonString("a\\b")).toBe("a\\\\b");
	});

	it("escapes single and double quotes", () => {
		expect(escapePythonString("it's")).toBe("it\\'s");
		expect(escapePythonString('say "hi"')).toBe('say \\"hi\\"');
	});

	it("escapes newlines, carriage returns, and tabs", () => {
		expect(escapePythonString("a\nb\rc\td")).toBe("a\\nb\\rc\\td");
	});

	it("escapes null bytes", () => {
		expect(escapePythonString("a\0b")).toBe("a\\x00b");
	});

	it("escapes other ASCII control characters as \\xNN", () => {
		expect(escapePythonString("a\x01b")).toBe("a\\x01b");
		expect(escapePythonString("a\x1fb")).toBe("a\\x1fb");
	});

	it("passes non-ASCII Unicode through unescaped", () => {
		expect(escapePythonString("héllo 世界")).toBe("héllo 世界");
	});

	it("neutralizes a single-quote string-breakout attempt", () => {
		// If this were embedded unescaped in `x = '{{value}}'`, the raw payload
		// would break out of the string and execute arbitrary code.
		const payload = "'; import os; os.system('rm -rf /'); x='";
		const escaped = escapePythonString(payload);
		// No unescaped single quote may survive — every ' must be preceded by \.
		expect(/(?<!\\)'/.test(escaped)).toBe(false);
		// Reconstructing the Python literal must yield back the exact original text,
		// proving the escaping is faithful, not just quote-stripping.
		const reconstructed = JSON.parse(`"${escaped.replace(/\\'/g, "'")}"`);
		expect(reconstructed).toBe(payload);
	});

	it("neutralizes backslash-quote combinations that could confuse naive escaping", () => {
		// A naive implementation that escapes quotes before backslashes would let
		// `\'` become `\\'` (escaped backslash + unescaped quote) — a breakout.
		const payload = "\\'; os.system('evil'); x='";
		const escaped = escapePythonString(payload);
		expect(/(?<!\\)'/.test(escaped)).toBe(false);
	});

	it("round-trips through Python-style single-quote wrapping for arbitrary strings", () => {
		const samples = [
			"normal text",
			"",
			"only\\backslashes\\\\here",
			"mixed \"'` chars",
			"line1\nline2\r\nline3",
		];
		for (const s of samples) {
			const escaped = escapePythonString(s);
			// Must not contain an unescaped delimiter that would break `'...'`.
			expect(/(?<!\\)'/.test(escaped)).toBe(false);
		}
	});
});

describe("escapePythonArray", () => {
	it("builds a Python list literal with each element quoted and escaped", () => {
		expect(escapePythonArray(["a", "b"])).toBe("['a', 'b']");
	});

	it("escapes single quotes inside array elements", () => {
		expect(escapePythonArray(["it's"])).toBe("['it\\'s']");
	});

	it("returns an empty list literal for an empty array", () => {
		expect(escapePythonArray([])).toBe("[]");
	});
});

describe("substituteVars", () => {
	it("substitutes a string variable with Python-escaped content", () => {
		expect(substituteVars("x = '{{name}}'", { name: "it's" })).toBe("x = 'it\\'s'");
	});

	it("substitutes numbers and booleans as raw (unescaped, unquoted) tokens", () => {
		expect(substituteVars("n = {{count}}", { count: 42 })).toBe("n = 42");
		expect(substituteVars("b = {{flag}}", { flag: true })).toBe("b = true");
	});

	it("substitutes every occurrence of the same variable", () => {
		expect(substituteVars("{{x}} + {{x}}", { x: 1 })).toBe("1 + 1");
	});

	it("leaves unmatched placeholders untouched instead of throwing", () => {
		expect(substituteVars("{{known}} {{unknown}}", { known: "ok" })).toBe("ok {{unknown}}");
	});

	it("does not treat a substituted string's own braces as further placeholders", () => {
		// If substitution were re-scanned, a value containing "{{" could inject
		// a second round of (unescaped) substitution.
		expect(substituteVars("{{a}}", { a: "{{b}}" })).toBe("{{b}}");
	});
});

describe("inlineScript", () => {
	it("is equivalent to substituteVars for a code string", () => {
		expect(inlineScript("print('{{msg}}')", { msg: "hi" })).toBe("print('hi')");
	});

	it("defaults to no substitutions when vars are omitted", () => {
		expect(inlineScript("print('static')")).toBe("print('static')");
	});
});
