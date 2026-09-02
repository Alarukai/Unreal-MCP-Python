import { spawnSync } from "node:child_process";
import {
	buildToolHarness,
	extractRegisteredTools,
	synthesizeArgs,
} from "./tool-verification-harness.js";

/**
 * `npm run verify-tools` — the slower, python3-dependent half of tool
 * verification (see index.test.ts for the fast half). Invokes every
 * registered tool with synthesized arguments, captures every Python script
 * it generates via manager.runPython(), and batch-checks them all with a
 * single `python3 -c "ast.parse(...)"` subprocess call.
 *
 * This replaces what was, across several prior work sessions, a throwaway
 * Node harness rewritten by hand each wave and never committed (see
 * docs/ROADMAP.md Parts D-G). It catches syntax errors and — since it drives
 * real tool code end to end — the class of bug where a JS value leaks into
 * generated Python as the wrong literal (e.g. a raw boolean producing the
 * bare identifiers `true`/`false`, a real bug this exact pattern caught in
 * an earlier wave).
 *
 * What this does NOT catch: whether a `unreal.*` API name, property, or
 * function signature is actually correct against a running engine. Part G
 * of docs/ROADMAP.md found five such bugs in code this kind of syntax-only
 * check had already marked green — that class of bug needs a live UE editor
 * and is not automated here.
 */

interface AstParseResult {
	index: number;
	ok: boolean;
	error?: string;
}

const PYTHON_AST_CHECK = `
import ast, json, sys
data = json.load(sys.stdin)
out = []
for entry in data:
    try:
        ast.parse(entry["script"])
        out.append({"index": entry["index"], "ok": True})
    except SyntaxError as e:
        out.append({"index": entry["index"], "ok": False, "error": str(e)})
print(json.dumps(out))
`;

function hashString(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) {
		h = (h * 31 + s.charCodeAt(i)) | 0;
	}
	return Math.abs(h);
}

async function main(): Promise<void> {
	const harness = await buildToolHarness();
	const registered = extractRegisteredTools(harness.server);
	const toolNames = Object.keys(registered);

	const unsynthesizable = new Set<string>();
	const invocationNotes: { tool: string; note: string }[] = [];

	for (const name of toolNames) {
		const { shape } = registered[name];
		harness.setCurrentTool(name);

		const fullArgs = synthesizeArgs(shape, { includeOptionals: true }, unsynthesizable, name);
		try {
			await harness.client.callTool({ name, arguments: fullArgs });
		} catch (error) {
			invocationNotes.push({ tool: name, note: `all-fields invocation: ${error}` });
		}

		// A deterministic ~20% subset also gets an optionals-omitted pass — this
		// is the shape that catches a tool which only breaks when an optional
		// field is left out (edge cases, not every combination, to keep runtime
		// bounded across ~250 tools).
		if (hashString(name) % 5 === 0) {
			const minimalArgs = synthesizeArgs(shape, { includeOptionals: false }, unsynthesizable, name);
			try {
				await harness.client.callTool({ name, arguments: minimalArgs });
			} catch (error) {
				invocationNotes.push({ tool: name, note: `optionals-omitted invocation: ${error}` });
			}
		}
	}

	await harness.close();

	const { scripts } = harness;
	console.log(
		`Invoked ${toolNames.length} tools, captured ${scripts.length} generated Python script(s).`,
	);
	if (unsynthesizable.size > 0) {
		console.log("\nFields the synthesizer fell back to a placeholder for (review if new):");
		for (const entry of unsynthesizable) console.log(`  - ${entry}`);
	}
	if (invocationNotes.length > 0) {
		console.log("\nTool invocations that threw (script, if any, was still captured first):");
		for (const { tool, note } of invocationNotes) console.log(`  - ${tool}: ${note}`);
	}

	if (scripts.length === 0) {
		console.log("\nNo Python scripts were generated — nothing to ast.parse.");
		return;
	}

	const pythonCheck = spawnSync("python3", ["--version"]);
	if (pythonCheck.error || pythonCheck.status !== 0) {
		console.warn(
			"\npython3 not found on PATH — skipping the ast.parse syntax check. " +
				"python3 is not a dependency of normal unreal-mcp use, only of `npm run verify-tools`; " +
				"install it locally (or rely on CI) to run this check.",
		);
		return;
	}

	const payload = scripts.map((s, index) => ({ index, script: s.script }));
	const result = spawnSync("python3", ["-c", PYTHON_AST_CHECK], {
		input: JSON.stringify(payload),
		encoding: "utf-8",
		maxBuffer: 64 * 1024 * 1024,
	});

	if (result.error || result.status !== 0) {
		console.error("\nast.parse batch check itself failed to run:");
		console.error(result.stderr || result.error);
		process.exitCode = 1;
		return;
	}

	const parsed: AstParseResult[] = JSON.parse(result.stdout);
	const failures = parsed.filter((r) => !r.ok);

	if (failures.length === 0) {
		console.log(`\nast.parse: all ${scripts.length} generated script(s) are syntactically valid.`);
		return;
	}

	console.error(`\nast.parse found ${failures.length} syntax error(s):\n`);
	for (const failure of failures) {
		const entry = scripts[failure.index];
		console.error("=".repeat(72));
		console.error(`Tool: ${entry.tool}`);
		console.error(`Error: ${failure.error}`);
		console.error("-".repeat(72));
		console.error(entry.script);
		console.error("");
	}
	process.exitCode = 1;
}

main().catch((error) => {
	console.error("verify-tools crashed:", error);
	process.exitCode = 1;
});
