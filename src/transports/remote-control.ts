import { readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TimeoutError, UnrealMcpError } from "../utils/errors.js";

export interface RemoteControlConfig {
	host: string;
	port: number;
	timeout: number;
}

export interface BatchRequest {
	requestId: number;
	url: string;
	verb: "GET" | "PUT";
	body: Record<string, unknown>;
}

export interface SearchQuery {
	query: string;
	filter?: {
		classNames?: string[];
		packageNames?: string[];
		recursiveClassSearch?: boolean;
	};
}

/**
 * HTTP client for Unreal Engine's built-in Remote Control API.
 * Default port 30010. No custom plugin required — just enable the
 * "Remote Control API" plugin in UE.
 */
export class RemoteControlClient {
	private baseUrl: string;
	private timeout: number;

	constructor(config: RemoteControlConfig) {
		this.baseUrl = `http://${config.host}:${config.port}`;
		this.timeout = config.timeout;
	}

	async isAvailable(): Promise<boolean> {
		try {
			const response = await fetch(`${this.baseUrl}/remote/info`, {
				method: "GET",
				signal: AbortSignal.timeout(3000),
			});
			return response.ok;
		} catch {
			return false;
		}
	}

	async getProperty(objectPath: string, propertyName: string): Promise<unknown> {
		return this.request("/remote/object/property", {
			objectPath,
			access: "READ_ACCESS",
			propertyName,
		});
	}

	async setProperty(
		objectPath: string,
		propertyName: string,
		propertyValue: unknown,
	): Promise<void> {
		await this.request("/remote/object/property", {
			objectPath,
			access: "WRITE_ACCESS",
			propertyName,
			propertyValue,
		});
	}

	async callFunction(
		objectPath: string,
		functionName: string,
		params?: Record<string, unknown>,
	): Promise<unknown> {
		const body: Record<string, unknown> = { objectPath, functionName };
		if (params) {
			body.parameters = params;
		}
		return this.request("/remote/object/call", body);
	}

	async batch(requests: BatchRequest[]): Promise<unknown[]> {
		const result = await this.request("/remote/batch", {
			requests: requests.map((r) => ({
				RequestId: r.requestId,
				URL: r.url,
				Verb: r.verb,
				Body: r.body,
			})),
		});
		return result as unknown[];
	}

	async search(query: SearchQuery): Promise<unknown[]> {
		const body: Record<string, unknown> = { Query: query.query };
		if (query.filter) {
			if (query.filter.classNames) {
				body.Filter = { ClassNames: query.filter.classNames };
			}
			if (query.filter.packageNames) {
				body.Filter = {
					...((body.Filter as object) || {}),
					PackageNames: query.filter.packageNames,
				};
			}
		}
		const result = await this.request("/remote/search", body);
		return (result as { Objects?: unknown[] })?.Objects || [];
	}

	async listPresets(): Promise<unknown[]> {
		const result = await this.rawRequest("/remote/presets", "GET");
		return (result as { Presets?: unknown[] })?.Presets || [];
	}

	async getPresetProperty(presetName: string, propertyName: string): Promise<unknown> {
		return this.rawRequest(
			`/remote/preset/${encodeURIComponent(presetName)}/property/${encodeURIComponent(propertyName)}`,
			"GET",
		);
	}

	async setPresetProperty(presetName: string, propertyName: string, value: unknown): Promise<void> {
		await this.rawRequest(
			`/remote/preset/${encodeURIComponent(presetName)}/property/${encodeURIComponent(propertyName)}`,
			"PUT",
			{ PropertyValue: value },
		);
	}

	async callPresetFunction(
		presetName: string,
		functionName: string,
		params?: Record<string, unknown>,
	): Promise<unknown> {
		return this.rawRequest(
			`/remote/preset/${encodeURIComponent(presetName)}/function/${encodeURIComponent(functionName)}`,
			"PUT",
			params ? { Parameters: params } : undefined,
		);
	}

	/**
	 * Execute Python code via the Remote Control HTTP endpoint.
	 * This provides a fallback when Python Remote Execution (UDP/TCP) is unavailable.
	 *
	 * Since RC only returns the function's C++ return value (not Python stdout),
	 * we wrap the user's code to capture stdout and write it to a temp file,
	 * then read it back from Node.js (same machine).
	 */
	async executePython(code: string): Promise<string> {
		const outputFile = join(
			tmpdir(),
			`unreal_mcp_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`,
		);
		const outputFilePy = outputFile.replace(/\\/g, "\\\\");

		// Wrap user code to capture stdout and write to temp file
		const wrappedCode = `
import sys, io
_mcp_buf = io.StringIO()
_mcp_old_stdout = sys.stdout
sys.stdout = _mcp_buf
try:
    exec(${JSON.stringify(code)})
except Exception as _mcp_err:
    print(f"Error: {_mcp_err}")
finally:
    sys.stdout = _mcp_old_stdout
with open("${outputFilePy}", "w", encoding="utf-8") as _mcp_f:
    _mcp_f.write(_mcp_buf.getvalue())
`;

		// Try execution approaches in order
		let executed = false;

		// Approach 1: Dedicated RC Python endpoint
		if (!executed) {
			try {
				await this.rawRequest("/remote/script/execute", "PUT", { Script: wrappedCode });
				executed = true;
			} catch {
				// Fall through
			}
		}

		// Approach 2: PythonScriptLibrary with various function names
		if (!executed) {
			for (const functionName of ["ExecutePythonCommand", "ExecutePythonScript"]) {
				try {
					await this.rawRequest("/remote/object/call", "PUT", {
						objectPath: "/Script/PythonScriptPlugin.Default__PythonScriptLibrary",
						functionName,
						parameters: { PythonCommand: wrappedCode },
					});
					executed = true;
					break;
				} catch {
					// Try next
				}
			}
		}

		// Approach 3: Console command with py prefix
		if (!executed) {
			try {
				const singleLine = wrappedCode.replace(/\n/g, "\\n").replace(/"/g, '\\"');
				await this.rawRequest("/remote/object/call", "PUT", {
					objectPath: "/Script/Engine.Default__KismetSystemLibrary",
					functionName: "ExecuteConsoleCommand",
					parameters: {
						WorldContextObject: "/Engine/Transient.World",
						Command: `py exec("${singleLine}")`,
					},
				});
				executed = true;
			} catch (error) {
				throw new UnrealMcpError(
					`Failed to execute Python via Remote Control. Enable Python Remote Execution (Project Settings > Plugins > Python > Enable Remote Execution). Error: ${error}`,
					"PYTHON_EXEC_FAILED",
				);
			}
		}

		// Read captured output from temp file
		try {
			// Small delay to let UE finish writing
			await new Promise((resolve) => setTimeout(resolve, 200));
			const output = readFileSync(outputFile, "utf-8");
			try {
				unlinkSync(outputFile);
			} catch {
				// Cleanup failure is fine
			}
			return output || "";
		} catch {
			// File wasn't created — execution likely failed silently
			return JSON.stringify({
				executed,
				note: "Python executed but produced no output. Check UE Output Log for errors.",
			});
		}
	}

	private async request(endpoint: string, body: Record<string, unknown>): Promise<unknown> {
		return this.rawRequest(endpoint, "PUT", body);
	}

	private async rawRequest(
		endpoint: string,
		method: string,
		body?: Record<string, unknown>,
	): Promise<unknown> {
		try {
			const options: RequestInit = {
				method,
				headers: { "Content-Type": "application/json" },
				signal: AbortSignal.timeout(this.timeout),
			};

			if (body) {
				options.body = JSON.stringify(body);
			}

			const response = await fetch(`${this.baseUrl}${endpoint}`, options);

			if (!response.ok) {
				const text = await response.text().catch(() => "");
				throw new UnrealMcpError(
					`Remote Control API error: ${response.status} ${response.statusText} — ${text}`,
					"RC_API_ERROR",
					{ status: response.status, endpoint },
				);
			}

			const text = await response.text();
			if (!text) return {};
			return JSON.parse(text);
		} catch (error) {
			if (error instanceof UnrealMcpError) throw error;
			if (error instanceof DOMException && error.name === "TimeoutError") {
				throw new TimeoutError(`Remote Control ${endpoint}`, this.timeout);
			}
			throw new UnrealMcpError(
				`Failed to connect to Remote Control API at ${this.baseUrl}: ${error}`,
				"RC_CONNECTION_FAILED",
			);
		}
	}
}
