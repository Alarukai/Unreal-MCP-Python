import { describe, expect, it } from "vitest";
import { extractNodeId, safeParsePython, splitRefPin } from "./blueprint.js";

describe("splitRefPin", () => {
	it("splits ref.PinName on the first dot", () => {
		expect(splitRefPin("myBranch.True")).toEqual({ ref: "myBranch", pin: "True" });
	});

	it("returns an empty pin when there is no dot", () => {
		expect(splitRefPin("myNode")).toEqual({ ref: "myNode", pin: "" });
	});

	it("splits only on the first dot, keeping the rest in pin", () => {
		// Documents actual behavior for a ref/id containing dots (e.g. a real UE
		// node id passed through from a previous call via list_graph_nodes).
		expect(splitRefPin("a.b.c")).toEqual({ ref: "a", pin: "b.c" });
	});

	it("treats a leading-dot spec as an empty ref", () => {
		expect(splitRefPin(".Pin")).toEqual({ ref: "", pin: "Pin" });
	});
});

describe("extractNodeId", () => {
	it("prefers node_id when present", () => {
		expect(extractNodeId({ node_id: "abc", nodeId: "xyz", id: "123" })).toBe("abc");
	});

	it("falls back to nodeId when node_id is absent", () => {
		expect(extractNodeId({ nodeId: "xyz", id: "123" })).toBe("xyz");
	});

	it("falls back to id when neither node_id nor nodeId is present", () => {
		expect(extractNodeId({ id: "123" })).toBe("123");
	});

	it("returns undefined for null, non-object, or empty input", () => {
		expect(extractNodeId(null)).toBeUndefined();
		expect(extractNodeId(undefined)).toBeUndefined();
		expect(extractNodeId("a string")).toBeUndefined();
		expect(extractNodeId(42)).toBeUndefined();
		expect(extractNodeId({})).toBeUndefined();
	});

	it("returns undefined when the id field is present but not a string", () => {
		// Documents actual behavior: a numeric node_id is not treated as a valid
		// id even though nodeId/id might have usable string values, because the
		// ?? chain already selected node_id as the candidate.
		expect(extractNodeId({ node_id: 42, nodeId: "xyz" })).toBeUndefined();
	});
});

describe("safeParsePython", () => {
	it("parses clean JSON success output", () => {
		const result = safeParsePython('{"success": true, "name": "MyNode"}');
		expect(result.success).toBe(true);
		expect(result.data).toEqual({ success: true, name: "MyNode" });
	});

	it("treats a JSON object with an 'error' key as failure", () => {
		const result = safeParsePython('{"error": "Blueprint not found"}');
		expect(result.success).toBe(false);
		expect(result.data).toEqual({ error: "Blueprint not found" });
	});

	it("recovers JSON preceded by UE log noise on the same output", () => {
		const noisy = 'LogPython: Warning: something\n{"success": true, "component": "Mesh"}';
		const result = safeParsePython(noisy);
		expect(result.success).toBe(true);
		expect(result.data).toEqual({ success: true, component: "Mesh" });
	});

	it("returns a structured failure instead of throwing on unparseable output", () => {
		const result = safeParsePython("Traceback (most recent call last):\n  totally not json");
		expect(result.success).toBe(false);
		expect(result.data).toMatchObject({ error: "Unparseable response from editor" });
		// The raw text must be preserved for debugging, not swallowed.
		expect((result.data as { raw: string }).raw).toContain("Traceback");
	});

	it("never throws regardless of input — the batch tool depends on this", () => {
		expect(() => safeParsePython("")).not.toThrow();
		expect(() => safeParsePython("{")).not.toThrow();
		expect(() => safeParsePython("not json at all")).not.toThrow();
	});
});
