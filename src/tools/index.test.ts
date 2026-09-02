import { describe, expect, it } from "vitest";
import { buildToolHarness, extractRegisteredTools } from "./tool-verification-harness.js";

/**
 * Verifies the tool surface itself, not UE-side behavior: registering all
 * modules must not throw (McpServer.tool() throws synchronously on a
 * duplicate name — this is exactly what caught a real "Tool undo is already
 * registered" collision in an earlier wave), and the server's own
 * tools/list response must be internally consistent. This is the fast,
 * always-on half of tool verification; `npm run verify-tools` is the
 * separate, slower half that generates and ast.parse-checks every tool's
 * Python (see tool-verification.verify.ts).
 */
describe("tool registration", () => {
	it("registers every module without a duplicate tool name", async () => {
		const harness = await buildToolHarness();
		try {
			const registered = Object.keys(extractRegisteredTools(harness.server));
			expect(registered.length).toBeGreaterThan(0);
			expect(new Set(registered).size).toBe(registered.length);
		} finally {
			await harness.close();
		}
	});

	it("returns a tools/list response with no duplicates, matching the registry", async () => {
		const harness = await buildToolHarness();
		try {
			const registered = Object.keys(extractRegisteredTools(harness.server));
			const { tools } = await harness.client.listTools();
			const names = tools.map((t) => t.name);

			expect(names.length).toBe(registered.length);
			expect(new Set(names).size).toBe(names.length);
			expect(new Set(names)).toEqual(new Set(registered));

			for (const tool of tools) {
				expect(tool.inputSchema).toBeTruthy();
				expect(tool.inputSchema.type).toBe("object");
			}
		} finally {
			await harness.close();
		}
	});
});
