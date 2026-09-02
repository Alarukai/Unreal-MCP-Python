export class UnrealMcpError extends Error {
	constructor(
		message: string,
		public readonly code: string,
		public readonly details?: Record<string, unknown>,
	) {
		super(message);
		this.name = "UnrealMcpError";
	}

	toToolResult() {
		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify({
						error: this.code,
						message: this.message,
						...(this.details || {}),
					}),
				},
			],
			isError: true,
		};
	}
}

export class EditorNotConnectedError extends UnrealMcpError {
	constructor(transport: string) {
		super(
			`Unreal Editor is not connected via ${transport}. Make sure the editor is running with the required plugins enabled.`,
			"EDITOR_NOT_CONNECTED",
			{ transport },
		);
		this.name = "EditorNotConnectedError";
	}
}

export class PluginNotAvailableError extends UnrealMcpError {
	constructor() {
		super(
			"The UnrealMCPBridge plugin is not running. This tool requires the optional C++ plugin for full functionality. Falling back to Python-based approach may have limited capabilities.",
			"PLUGIN_NOT_AVAILABLE",
		);
		this.name = "PluginNotAvailableError";
	}
}

export class PluginAuthenticationError extends UnrealMcpError {
	constructor(reason: string) {
		super(
			`Plugin bridge authentication failed: ${reason}. Check that --plugin-secret / UNREAL_MCP_PLUGIN_SECRET matches the secret configured on the C++ plugin side.`,
			"PLUGIN_AUTH_FAILED",
			{ reason },
		);
		this.name = "PluginAuthenticationError";
	}
}

export class BuildError extends UnrealMcpError {
	constructor(
		message: string,
		public readonly exitCode: number,
		public readonly output: string,
	) {
		super(message, "BUILD_FAILED", { exitCode, output });
		this.name = "BuildError";
	}
}

export class TimeoutError extends UnrealMcpError {
	constructor(operation: string, timeoutMs: number) {
		super(`Operation "${operation}" timed out after ${timeoutMs}ms`, "TIMEOUT", {
			operation,
			timeoutMs,
		});
		this.name = "TimeoutError";
	}
}

export class PythonExecutionError extends UnrealMcpError {
	constructor(
		message: string,
		public readonly pythonOutput: string,
	) {
		super(message, "PYTHON_EXECUTION_ERROR", { pythonOutput });
		this.name = "PythonExecutionError";
	}
}
