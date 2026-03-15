import { createConnection, type Socket } from "node:net";
import { PythonExecutionError, TimeoutError, UnrealMcpError } from "../utils/errors.js";

export interface PythonExecConfig {
	host: string;
	port: number;
	timeout: number;
}

/**
 * Client for Unreal Engine's built-in Python Remote Execution protocol.
 * Default port 6776. No custom plugin required — just enable the
 * "Python Editor Script Plugin" in UE.
 *
 * Protocol: Send Python code as UTF-8 over TCP, receive output back.
 * The UE Python Remote Execution protocol uses a simple framed message format.
 */
export class PythonExecClient {
	private host: string;
	private port: number;
	private timeout: number;

	constructor(config: PythonExecConfig) {
		this.host = config.host;
		this.port = config.port;
		this.timeout = config.timeout;
	}

	async isAvailable(): Promise<boolean> {
		try {
			// Try to open and immediately close a TCP connection
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
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Execute Python code in the Unreal Editor's Python environment.
	 * Returns the captured stdout output.
	 */
	async execute(pythonCode: string): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			const socket = createConnection({ host: this.host, port: this.port });
			const chunks: Buffer[] = [];
			let resolved = false;

			const timer = setTimeout(() => {
				if (!resolved) {
					resolved = true;
					socket.destroy();
					reject(new TimeoutError("Python execution", this.timeout));
				}
			}, this.timeout);

			socket.on("connect", () => {
				// Send the command using UE's remote execution protocol
				// Format: the code is wrapped in a protocol message
				const message = this.buildMessage(pythonCode);
				socket.write(message);
			});

			socket.on("data", (data) => {
				chunks.push(data);
			});

			socket.on("end", () => {
				if (!resolved) {
					resolved = true;
					clearTimeout(timer);
					const response = Buffer.concat(chunks).toString("utf-8");
					const parsed = this.parseResponse(response);
					if (parsed.error) {
						reject(new PythonExecutionError(parsed.error, response));
					} else {
						resolve(parsed.output);
					}
				}
			});

			socket.on("error", (err) => {
				if (!resolved) {
					resolved = true;
					clearTimeout(timer);
					reject(
						new UnrealMcpError(
							`Python Remote Execution connection failed: ${err.message}`,
							"PYTHON_CONNECTION_FAILED",
						),
					);
				}
			});

			socket.on("timeout", () => {
				if (!resolved) {
					resolved = true;
					clearTimeout(timer);
					socket.destroy();
					reject(new TimeoutError("Python execution", this.timeout));
				}
			});

			socket.setTimeout(this.timeout);
		});
	}

	/**
	 * Execute a Python script file (already rendered via template engine).
	 */
	async executeScript(renderedScript: string): Promise<string> {
		return this.execute(renderedScript);
	}

	/**
	 * Build the protocol message for UE Python Remote Execution.
	 *
	 * The protocol sends JSON-encoded command messages over TCP.
	 * Format based on the unreal-remote-execution protocol:
	 * - Message type: "command"
	 * - Command: the Python code to execute
	 */
	private buildMessage(code: string): Buffer {
		const message = JSON.stringify({
			type: "command",
			body: code,
		});

		// UE Python Remote Execution uses length-prefixed messages
		// 4-byte little-endian length prefix + UTF-8 message body
		const messageBuffer = Buffer.from(message, "utf-8");
		const lengthBuffer = Buffer.alloc(4);
		lengthBuffer.writeUInt32LE(messageBuffer.length, 0);

		return Buffer.concat([lengthBuffer, messageBuffer]);
	}

	/**
	 * Parse the response from UE Python Remote Execution.
	 */
	private parseResponse(raw: string): { output: string; error?: string } {
		// Try to extract the output from the raw response
		// The response may be length-prefixed JSON or raw text depending on UE version

		// Skip any length prefix bytes
		let jsonStr = raw;
		if (raw.length > 4) {
			// Try parsing from position 4 (after length prefix)
			const possibleJson = raw.slice(4);
			try {
				const parsed = JSON.parse(possibleJson);
				if (typeof parsed === "object" && parsed !== null) {
					if (parsed.success === false || parsed.error) {
						return { output: "", error: parsed.error || parsed.output || "Unknown error" };
					}
					return { output: parsed.output || parsed.result || JSON.stringify(parsed) };
				}
			} catch {
				// Not JSON from position 4, try full string
			}
		}

		// Try parsing the full string as JSON
		try {
			const parsed = JSON.parse(jsonStr);
			if (typeof parsed === "object" && parsed !== null) {
				if (parsed.success === false || parsed.error) {
					return { output: "", error: parsed.error || parsed.output || "Unknown error" };
				}
				return { output: parsed.output || parsed.result || JSON.stringify(parsed) };
			}
		} catch {
			// Not JSON — return raw text as output
		}

		return { output: raw };
	}
}
