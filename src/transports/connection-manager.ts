import type { ConnectionStatus, UnrealMcpConfig } from "../types.js";
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
	 */
	requireEditor(): void {
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

	async shutdown(): Promise<void> {
		await this.python.disconnect();
	}
}
