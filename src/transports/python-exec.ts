import { RemoteExecution, RemoteExecutionConfig } from "unreal-remote-execution";
import { PythonExecutionError, TimeoutError, UnrealMcpError } from "../utils/errors.js";

export interface PythonExecConfig {
	host: string;
	port: number;
	timeout: number;
}

/**
 * Client for Unreal Engine's built-in Python Remote Execution protocol.
 * Uses the `unreal-remote-execution` package which implements the full protocol:
 * - UDP multicast discovery on 239.0.0.1:6766
 * - Inverted TCP model (we are the server, UE connects to us)
 * - Proper message framing with magic "ue_py" and UUIDs
 *
 * Requires "Python Editor Script Plugin" enabled in UE with
 * "Enable Remote Execution" checked in its settings.
 */
export class PythonExecClient {
	private remote: RemoteExecution;
	private timeout: number;
	private _started = false;
	private _commandReady = false;

	constructor(config: PythonExecConfig) {
		const remoteConfig = new RemoteExecutionConfig(
			0, // multicastTTL: local host only
			["239.0.0.1", 6766], // multicastGroupEndpoint (UE default)
			"0.0.0.0", // multicastBindAddress
			[config.host, config.port], // commandEndpoint
		);
		this.remote = new RemoteExecution(remoteConfig);
		this.timeout = config.timeout;
	}

	async isAvailable(): Promise<boolean> {
		try {
			if (!this._started) {
				await this.ensureStarted();
			}
			return this.remote.remoteNodes.length > 0;
		} catch {
			return false;
		}
	}

	private async ensureStarted(): Promise<void> {
		if (this._started) return;

		try {
			await this.remote.start();
			this._started = true;

			// Wait for UE node discovery via UDP multicast
			await new Promise<void>((resolve) => {
				const maxWait = 5000;
				const interval = 500;
				let elapsed = 0;

				const check = () => {
					if (this.remote.remoteNodes.length > 0 || elapsed >= maxWait) {
						resolve();
						return;
					}
					elapsed += interval;
					setTimeout(check, interval);
				};
				check();
			});
		} catch (err) {
			this._started = false;
			throw new UnrealMcpError(
				`Failed to start Python Remote Execution: ${err}`,
				"PYTHON_CONNECTION_FAILED",
			);
		}
	}

	private async ensureCommandConnection(): Promise<void> {
		if (this._commandReady && this.remote.hasCommandConnection()) return;

		await this.ensureStarted();

		const nodes = this.remote.remoteNodes;
		if (nodes.length === 0) {
			throw new UnrealMcpError(
				"No Unreal Editor nodes found. Make sure the editor is running with Python Remote Execution enabled.",
				"NO_UE_NODES",
			);
		}

		await this.remote.openCommandConnection(nodes[0]);
		this._commandReady = true;
	}

	/**
	 * Execute Python code in the Unreal Editor's Python environment.
	 * Returns the captured stdout output.
	 */
	async execute(pythonCode: string): Promise<string> {
		await this.ensureCommandConnection();

		try {
			const result = await Promise.race([
				this.remote.runCommand(pythonCode, true),
				new Promise<never>((_, reject) =>
					setTimeout(
						() => reject(new TimeoutError("Python execution", this.timeout)),
						this.timeout,
					),
				),
			]);

			if (!result.success) {
				const errorOutput = result.output
					.filter((o: { type: string }) => o.type === "Error")
					.map((o: { output: string }) => o.output)
					.join("\n");
				const errorMsg = errorOutput || result.result || "Unknown Python execution error";
				throw new PythonExecutionError(errorMsg, JSON.stringify(result));
			}

			// Collect stdout (Info-type output)
			const stdout = result.output
				.filter((o: { type: string }) => o.type === "Info")
				.map((o: { output: string }) => o.output)
				.join("")
				.trim();

			return stdout || result.result || "";
		} catch (error) {
			if (error instanceof UnrealMcpError) throw error;
			// Connection may have dropped — reset and let next call reconnect
			this._commandReady = false;
			throw new PythonExecutionError(`Python execution failed: ${error}`, String(error));
		}
	}

	/**
	 * Execute a Python script (already rendered via template engine).
	 */
	async executeScript(renderedScript: string): Promise<string> {
		return this.execute(renderedScript);
	}

	async disconnect(): Promise<void> {
		if (this._commandReady) {
			try {
				this.remote.closeCommandConnection();
			} catch {
				// Ignore
			}
			this._commandReady = false;
		}
		if (this._started) {
			try {
				await this.remote.stop();
			} catch {
				// Ignore shutdown errors
			}
			this._started = false;
		}
	}
}
