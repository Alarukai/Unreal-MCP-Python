import type { ConnectionStatus, PluginCapabilities, UnrealMcpConfig } from "../types.js";
import { PluginBridgeClient } from "./plugin-bridge.js";
import { PythonExecClient } from "./python-exec.js";
import { RemoteControlClient } from "./remote-control.js";
import { SubprocessRunner } from "./subprocess.js";

/**
 * Orchestrates all transport connections to Unreal Engine.
 * Handles initialization, health checks, and graceful degradation.
 */
export class ConnectionManager {
	public rc!: RemoteControlClient;
	public python!: PythonExecClient;
	public plugin!: PluginBridgeClient;
	public subprocess!: SubprocessRunner;

	private _status: ConnectionStatus = {
		remoteControl: false,
		pythonExec: false,
		pluginBridge: false,
		editorRunning: false,
	};

	/** Timestamp of the last re-probe triggered by requireEditor(), for cooldown. */
	private _lastEditorReprobe = 0;

	async initialize(config: UnrealMcpConfig): Promise<void> {
		// Initialize all transports
		this.rc = new RemoteControlClient({
			host: "127.0.0.1",
			port: config.remoteControlPort,
			timeout: config.timeouts.remoteControl,
		});

		this.python = new PythonExecClient({
			host: "127.0.0.1",
			port: config.pythonExecPort,
			timeout: config.timeouts.pythonExec,
			multicastBindAddress: config.multicastBindAddress,
		});

		this.plugin = new PluginBridgeClient({
			host: "127.0.0.1",
			port: config.pluginBridgePort,
			timeout: config.timeouts.remoteControl,
		});

		this.subprocess = new SubprocessRunner({
			enginePath: config.enginePath,
			projectPath: config.projectPath,
			platform: config.platform,
			configuration: config.configuration,
			timeouts: {
				build: config.timeouts.build,
				cook: config.timeouts.cook,
			},
		});

		// Probe connections (non-blocking — tools handle failures gracefully)
		await this.refreshStatus();
	}

	/**
	 * Check all transport connections and update status.
	 */
	async refreshStatus(): Promise<ConnectionStatus> {
		const [rcAvailable, pythonAvailable, pluginAvailable] = await Promise.all([
			this.rc.isAvailable().catch(() => false),
			this.python.isAvailable().catch(() => false),
			this.plugin.isAvailable().catch(() => false),
		]);

		this._status = {
			remoteControl: rcAvailable,
			pythonExec: pythonAvailable,
			pluginBridge: pluginAvailable,
			editorRunning: rcAvailable || pythonAvailable,
		};

		return this._status;
	}

	get status(): ConnectionStatus {
		return { ...this._status };
	}

	/**
	 * Ensure the editor is connected via at least one transport.
	 * Throws if no editor connection is available.
	 *
	 * The connection status is otherwise only probed at server startup, but an
	 * MCP server is typically launched by its client (e.g. Claude Desktop/Code)
	 * before the UE editor is running — and the editor is often started or
	 * restarted mid-session. So when the cached status says "not connected",
	 * re-probe once (with a short cooldown) before failing: a tool call made
	 * after the editor launches then self-heals instead of failing permanently
	 * until the whole MCP server is restarted.
	 */
	async requireEditor(): Promise<void> {
		if (this._status.editorRunning) return; // Fast path: connection already known good.

		const now = Date.now();
		if (now - this._lastEditorReprobe > 2000) {
			this._lastEditorReprobe = now;
			await this.refreshStatus();
		}

		if (!this._status.editorRunning) {
			throw new Error(
				"Unreal Editor is not connected. Make sure the editor is running with " +
					"Remote Control API and/or Python Editor Script plugins enabled.",
			);
		}
	}

	/**
	 * Check if the optional C++ plugin is available.
	 */
	get hasPlugin(): boolean {
		return this._status.pluginBridge;
	}

	/**
	 * Get the plugin's negotiated capabilities, or null if plugin is not connected.
	 */
	get pluginCapabilities(): PluginCapabilities | null {
		return this.plugin?.capabilities ?? null;
	}

	/**
	 * Execute Python code using the best available transport.
	 * Tries: Python Remote Execution → Remote Control API executePython.
	 * This is the primary method tools should use instead of calling manager.python.execute() directly.
	 */
	async runPython(code: string): Promise<string> {
		// Try Python Remote Execution first (full stdout capture)
		if (this._status.pythonExec) {
			try {
				return await this.python.execute(code);
			} catch (error) {
				// A throw here can mean either "the user's Python script raised an
				// exception" (connection still fine) or "the connection actually
				// died" (editor closed/crashed, network dropped mid-call) — the
				// client doesn't cleanly distinguish the two at this layer. Rather
				// than keep trusting a possibly-stale "connected" status
				// indefinitely (requireEditor()'s cached-good fast path never
				// re-verifies it), invalidate it here: the next requireEditor()
				// re-probes instead of retrying a dead connection until someone
				// restarts the whole MCP server. Worst case for a genuine script
				// bug is one extra (cheap, cached) re-probe on the next call.
				this._status.pythonExec = false;
				this._status.editorRunning = this._status.remoteControl;
				if (!this._status.remoteControl) throw error;
				console.error(`[unreal-mcp] Python exec failed, falling back to Remote Control: ${error}`);
			}
		}

		// Fall back to Remote Control API
		if (this._status.remoteControl) {
			try {
				return await this.rc.executePython(code);
			} catch (error) {
				this._status.remoteControl = false;
				this._status.editorRunning = this._status.pythonExec;
				throw error;
			}
		}

		throw new Error(
			"No Python execution transport available. Enable Python Editor Script Plugin with Remote Execution, " +
				"or enable the Remote Control API plugin.",
		);
	}

	/**
	 * Execute an operation with plugin-first, Python-fallback strategy.
	 *
	 * If the plugin is available and supports the given command, it is used.
	 * On plugin failure or absence, the pythonFallback function is called instead.
	 * This centralizes the dual-path pattern used across tool modules.
	 */
	async executeWithPluginFallback(options: {
		pluginCommand: string;
		pluginParams: Record<string, unknown>;
		pythonFallback: () => Promise<string>;
	}): Promise<string> {
		if (this.hasPlugin && this.plugin.hasCapability(options.pluginCommand)) {
			try {
				const response = await this.plugin.sendCommand({
					command: options.pluginCommand,
					params: options.pluginParams,
				});
				if (response.success) {
					return typeof response.data === "string"
						? response.data
						: JSON.stringify(response.data, null, 2);
				}
				// Plugin returned an error — fall through to Python
				console.error(
					`[unreal-mcp] Plugin command ${options.pluginCommand} failed: ${response.error}, falling back to Python`,
				);
			} catch (error) {
				console.error(
					`[unreal-mcp] Plugin command ${options.pluginCommand} error: ${error}, falling back to Python`,
				);
			}
		}

		return options.pythonFallback();
	}

	async shutdown(): Promise<void> {
		await Promise.all([this.python.disconnect(), this.plugin.disconnect()]);
	}
}
