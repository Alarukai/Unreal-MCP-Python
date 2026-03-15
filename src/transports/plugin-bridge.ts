import { createConnection, type Socket } from "node:net";
import type { PluginBridgeCommand, PluginBridgeResponse } from "../types.js";
import { PluginNotAvailableError, TimeoutError, UnrealMcpError } from "../utils/errors.js";

export interface PluginBridgeConfig {
	host: string;
	port: number;
	timeout: number;
}

/**
 * TCP client for the optional UnrealMCPBridge C++ plugin.
 * Default port 55557. Provides deep K2Node/Blueprint graph manipulation
 * that isn't available through Python or Remote Control APIs.
 *
 * Protocol: JSON commands over TCP, same pattern as flopperam/chongdashu.
 * Messages are length-prefixed (4-byte LE uint32).
 */
export class PluginBridgeClient {
	private host: string;
	private port: number;
	private timeout: number;
	private _available = false;

	constructor(config: PluginBridgeConfig) {
		this.host = config.host;
		this.port = config.port;
		this.timeout = config.timeout;
	}

	get available(): boolean {
		return this._available;
	}

	async isAvailable(): Promise<boolean> {
		try {
			await new Promise<void>((resolve, reject) => {
				const socket = createConnection({ host: this.host, port: this.port }, () => {
					socket.destroy();
					resolve();
				});
				socket.setTimeout(3000);
				socket.on("timeout", () => {
					socket.destroy();
					reject(new Error("timeout"));
				});
				socket.on("error", reject);
			});
			this._available = true;
			return true;
		} catch {
			this._available = false;
			return false;
		}
	}

	/**
	 * Send a command to the C++ plugin and receive the response.
	 */
	async sendCommand(command: PluginBridgeCommand): Promise<PluginBridgeResponse> {
		if (!this._available) {
			throw new PluginNotAvailableError();
		}

		return new Promise<PluginBridgeResponse>((resolve, reject) => {
			const socket = createConnection({ host: this.host, port: this.port });
			const chunks: Buffer[] = [];
			let resolved = false;

			const timer = setTimeout(() => {
				if (!resolved) {
					resolved = true;
					socket.destroy();
					reject(new TimeoutError(`Plugin command: ${command.command}`, this.timeout));
				}
			}, this.timeout);

			socket.on("connect", () => {
				const message = JSON.stringify(command);
				const messageBuffer = Buffer.from(message, "utf-8");
				const lengthBuffer = Buffer.alloc(4);
				lengthBuffer.writeUInt32LE(messageBuffer.length, 0);
				socket.write(Buffer.concat([lengthBuffer, messageBuffer]));
			});

			socket.on("data", (data) => {
				chunks.push(data);
			});

			socket.on("end", () => {
				if (!resolved) {
					resolved = true;
					clearTimeout(timer);
					try {
						const raw = Buffer.concat(chunks);
						// Skip 4-byte length prefix if present
						const jsonStr =
							raw.length > 4
								? raw.slice(4).toString("utf-8")
								: raw.toString("utf-8");
						const response = JSON.parse(jsonStr) as PluginBridgeResponse;
						resolve(response);
					} catch (err) {
						reject(
							new UnrealMcpError(
								`Failed to parse plugin response: ${err}`,
								"PLUGIN_PARSE_ERROR",
							),
						);
					}
				}
			});

			socket.on("error", (err) => {
				if (!resolved) {
					resolved = true;
					clearTimeout(timer);
					this._available = false;
					reject(
						new UnrealMcpError(
							`Plugin bridge connection failed: ${err.message}`,
							"PLUGIN_CONNECTION_FAILED",
						),
					);
				}
			});

			socket.setTimeout(this.timeout);
		});
	}
}
