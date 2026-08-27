import { describe, expect, it } from "vitest";
import {
	BuildError,
	EditorNotConnectedError,
	PluginNotAvailableError,
	PythonExecutionError,
	TimeoutError,
	UnrealMcpError,
} from "./errors.js";

describe("UnrealMcpError.toToolResult", () => {
	it("produces an MCP-shaped isError result with code, message, and details merged in", () => {
		const err = new UnrealMcpError("something broke", "SOME_CODE", { foo: "bar" });
		const result = err.toToolResult();
		expect(result.isError).toBe(true);
		expect(result.content).toHaveLength(1);
		expect(result.content[0].type).toBe("text");
		const parsed = JSON.parse(result.content[0].text);
		expect(parsed).toEqual({ error: "SOME_CODE", message: "something broke", foo: "bar" });
	});

	it("omits details entirely when none are provided", () => {
		const err = new UnrealMcpError("plain error", "PLAIN");
		const parsed = JSON.parse(err.toToolResult().content[0].text);
		expect(parsed).toEqual({ error: "PLAIN", message: "plain error" });
	});

	it("is a real Error instance usable with instanceof and try/catch", () => {
		const err = new UnrealMcpError("x", "X");
		expect(err).toBeInstanceOf(Error);
		expect(err.name).toBe("UnrealMcpError");
	});
});

describe("EditorNotConnectedError", () => {
	it("carries the transport name in both message and details", () => {
		const err = new EditorNotConnectedError("PythonExec");
		expect(err.code).toBe("EDITOR_NOT_CONNECTED");
		expect(err.message).toContain("PythonExec");
		expect(err.details).toEqual({ transport: "PythonExec" });
	});
});

describe("PluginNotAvailableError", () => {
	it("uses a fixed PLUGIN_NOT_AVAILABLE code", () => {
		const err = new PluginNotAvailableError();
		expect(err.code).toBe("PLUGIN_NOT_AVAILABLE");
	});
});

describe("BuildError", () => {
	it("exposes exitCode and output both as properties and in details", () => {
		const err = new BuildError("build failed", 1, "compiler output here");
		expect(err.code).toBe("BUILD_FAILED");
		expect(err.exitCode).toBe(1);
		expect(err.output).toBe("compiler output here");
		expect(err.details).toEqual({ exitCode: 1, output: "compiler output here" });
	});
});

describe("TimeoutError", () => {
	it("formats the operation name and timeout into the message", () => {
		const err = new TimeoutError("Python execution", 5000);
		expect(err.code).toBe("TIMEOUT");
		expect(err.message).toBe('Operation "Python execution" timed out after 5000ms');
		expect(err.details).toEqual({ operation: "Python execution", timeoutMs: 5000 });
	});
});

describe("PythonExecutionError", () => {
	it("carries the raw Python output in details", () => {
		const err = new PythonExecutionError("script failed", "Traceback...");
		expect(err.code).toBe("PYTHON_EXECUTION_ERROR");
		expect(err.pythonOutput).toBe("Traceback...");
		expect(err.details).toEqual({ pythonOutput: "Traceback..." });
	});
});
