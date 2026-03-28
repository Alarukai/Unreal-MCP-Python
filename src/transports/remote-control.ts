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
