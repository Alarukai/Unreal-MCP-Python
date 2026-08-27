import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "./connection-manager.js";
import type { PluginBridgeClient } from "./plugin-bridge.js";
import type { PythonExecClient } from "./python-exec.js";
import type { RemoteControlClient } from "./remote-control.js";

/**
 * These tests exercise ConnectionManager's status caching/invalidation logic
 * directly against fake transport clients, bypassing initialize() (which would
 * construct real PythonExecClient/RemoteControlClient instances that touch
 * actual sockets — python-exec's discovery alone waits up to 5s for a reply
 * that will never come in a test environment with no UE editor present).
 */
function makeManager(overrides: {
	pythonAvailable?: () => Promise<boolean>;
	pythonExecute?: () => Promise<string>;
	rcAvailable?: () => Promise<boolean>;
	rcExecutePython?: () => Promise<string>;
}): ConnectionManager {
	const manager = new ConnectionManager();
	manager.python = {
		isAvailable: overrides.pythonAvailable ?? (async () => false),
		execute: overrides.pythonExecute ?? (async () => "ok"),
	} as unknown as PythonExecClient;
	manager.rc = {
		isAvailable: overrides.rcAvailable ?? (async () => false),
		executePython: overrides.rcExecutePython ?? (async () => "ok"),
	} as unknown as RemoteControlClient;
	manager.plugin = {
		isAvailable: async () => false,
	} as unknown as PluginBridgeClient;
	return manager;
}

describe("ConnectionManager.requireEditor self-heal", () => {
	it("throws when no transport is available", async () => {
		const manager = makeManager({});
		await manager.refreshStatus();
		await expect(manager.requireEditor()).rejects.toThrow(/not connected/i);
	});

	it("returns immediately (fast path) when status is already cached as connected", async () => {
		const isAvailable = vi.fn(async () => true);
		const manager = makeManager({ pythonAvailable: isAvailable });
		await manager.refreshStatus();
		expect(isAvailable).toHaveBeenCalledTimes(1);

		await manager.requireEditor();
		// requireEditor's fast path must not re-probe when already known good.
		expect(isAvailable).toHaveBeenCalledTimes(1);
	});

	it("re-probes and self-heals when the editor starts after a cached-down status", async () => {
		vi.useFakeTimers();
		try {
			let editorStarted = false;
			const manager = makeManager({ pythonAvailable: async () => editorStarted });

			await manager.refreshStatus();
			await expect(manager.requireEditor()).rejects.toThrow(/not connected/i);

			editorStarted = true; // Editor launches mid-session.
			vi.advanceTimersByTime(2001); // past requireEditor's re-probe cooldown
			await manager.requireEditor(); // Should re-probe and succeed, not throw.
			expect(manager.status.editorRunning).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not re-probe again within the cooldown window", async () => {
		const isAvailable = vi.fn(async () => false);
		const manager = makeManager({ pythonAvailable: isAvailable });

		await manager.refreshStatus();
		expect(isAvailable).toHaveBeenCalledTimes(1);

		await expect(manager.requireEditor()).rejects.toThrow(); // triggers a re-probe
		expect(isAvailable).toHaveBeenCalledTimes(2);

		await expect(manager.requireEditor()).rejects.toThrow(); // within cooldown
		expect(isAvailable).toHaveBeenCalledTimes(2); // unchanged
	});
});

describe("ConnectionManager.runPython status invalidation", () => {
	it("invalidates pythonExec and editorRunning when the connection fails with no RC fallback", async () => {
		const manager = makeManager({
			pythonAvailable: async () => true,
			pythonExecute: async () => {
				throw new Error("connection dropped");
			},
			rcAvailable: async () => false,
		});
		await manager.refreshStatus();
		expect(manager.status.pythonExec).toBe(true);
		expect(manager.status.editorRunning).toBe(true);

		await expect(manager.runPython("print(1)")).rejects.toThrow("connection dropped");

		expect(manager.status.pythonExec).toBe(false);
		expect(manager.status.editorRunning).toBe(false);
	});

	it("falls back to Remote Control on Python failure and keeps editorRunning true if RC succeeds", async () => {
		const manager = makeManager({
			pythonAvailable: async () => true,
			pythonExecute: async () => {
				throw new Error("connection dropped");
			},
			rcAvailable: async () => true,
			rcExecutePython: async () => "rc result",
		});
		await manager.refreshStatus();

		const result = await manager.runPython("print(1)");

		expect(result).toBe("rc result");
		expect(manager.status.pythonExec).toBe(false); // invalidated
		expect(manager.status.remoteControl).toBe(true); // RC still good
		expect(manager.status.editorRunning).toBe(true); // still true via RC
	});

	it("invalidates remoteControl when the RC fallback itself fails", async () => {
		const manager = makeManager({
			pythonAvailable: async () => true,
			pythonExecute: async () => {
				throw new Error("python down");
			},
			rcAvailable: async () => true,
			rcExecutePython: async () => {
				throw new Error("rc down too");
			},
		});
		await manager.refreshStatus();

		await expect(manager.runPython("print(1)")).rejects.toThrow("rc down too");

		expect(manager.status.pythonExec).toBe(false);
		expect(manager.status.remoteControl).toBe(false);
		expect(manager.status.editorRunning).toBe(false);
	});

	it("a subsequent requireEditor() call re-probes after runPython invalidates the status", async () => {
		let editorAlive = true;
		const manager = makeManager({
			pythonAvailable: async () => editorAlive,
			pythonExecute: async () => {
				if (!editorAlive) throw new Error("editor closed");
				return "ok";
			},
		});
		await manager.refreshStatus();
		expect(manager.status.editorRunning).toBe(true);

		// Editor closes mid-session; the next runPython call is what discovers it.
		editorAlive = false;
		await expect(manager.runPython("print(1)")).rejects.toThrow("editor closed");
		expect(manager.status.editorRunning).toBe(false);

		// A later requireEditor() call must re-probe and get the real (down) state
		// rather than trusting a status that predates the invalidation.
		await expect(manager.requireEditor()).rejects.toThrow(/not connected/i);
	});
});
