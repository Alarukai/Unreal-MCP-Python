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
	 * Tries multiple approaches in order:
	 * 1. PUT /remote/script/execute — dedicated RC Python endpoint (requires "Enable Remote Python Execution" in RC settings)
	 * 2. PUT /remote/object/call with PythonScriptLibrary.ExecutePythonCommand
	 * 3. Console command with `py` prefix (works but no stdout capture)
	 */
	async executePython(code: string): Promise<string> {
		// Approach 1: Dedicated RC Python endpoint (UE 5.x with Remote Python Execution enabled)
		try {
			const result = await this.rawRequest("/remote/script/execute", "PUT", {
				Script: code,
			});
			return typeof result === "string" ? result : JSON.stringify(result);
		} catch {
			// Fall through
		}

		// Approach 2: Call PythonScriptLibrary with various function names
		for (const functionName of ["ExecutePythonCommand", "ExecutePythonScript", "ExecuteScript"]) {
			try {
				const result = await this.rawRequest("/remote/object/call", "PUT", {
					objectPath: "/Script/PythonScriptPlugin.Default__PythonScriptLibrary",
					functionName,
					parameters: { PythonCommand: code },
				});
				return typeof result === "string" ? result : JSON.stringify(result);
			} catch {
				// Try next function name
			}
		}

		// Approach 3: Use `py` console command prefix — works without special config
		// but stdout goes to UE Output Log only, not returned to caller
		try {
			const escapedCode = code.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
			await this.rawRequest("/remote/object/call", "PUT", {
				objectPath: "/Script/Engine.Default__KismetSystemLibrary",
				functionName: "ExecuteConsoleCommand",
				parameters: {
					WorldContextObject: "/Engine/Transient.World",
					Command: `py ${escapedCode}`,
				},
			});
			return JSON.stringify({
				executed: true,
				note: "Python executed via console command. Output is in the UE Output Log. For full stdout capture, enable Python Remote Execution in Project Settings > Plugins > Python.",
			});
		} catch (error) {
			throw new UnrealMcpError(
				`Failed to execute Python via Remote Control. Enable Python Remote Execution (Project Settings > Plugins > Python > Enable Remote Execution). Error: ${error}`,
				"PYTHON_EXEC_FAILED",
			);
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
