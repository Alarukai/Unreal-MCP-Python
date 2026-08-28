export interface UnrealMcpConfig {
	projectPath: string;
	enginePath?: string;
	engineVersion?: string;
	remoteControlPort: number;
	remoteControlWsPort: number;
	pythonExecPort: number;
	pluginBridgePort: number;
	/** Bind address for the Python Remote Execution UDP multicast discovery socket. Defaults to 127.0.0.1 (loopback-only). Only widen this if the editor and this server run on different network namespaces on the same host (e.g. WSL) and discovery fails. */
	multicastBindAddress: string;
	platform: string;
	configuration: string;
	enabledModules: string[];
	timeouts: {
		build: number;
		cook: number;
		remoteControl: number;
		pythonExec: number;
	};
}

export interface ConnectionStatus {
	remoteControl: boolean;
	pythonExec: boolean;
	pluginBridge: boolean;
	editorRunning: boolean;
}

export interface SubprocessResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	duration: number;
	parsed?: ParsedBuildOutput;
}

export interface ParsedBuildOutput {
	errors: BuildDiagnostic[];
	warnings: BuildDiagnostic[];
	progress: number;
	succeeded: boolean;
	summary: string;
}

export interface BuildDiagnostic {
	file: string;
	line: number;
	column: number;
	severity: "error" | "warning";
	code: string;
	message: string;
}

export interface PluginBridgeCommand {
	id?: string;
	command: string;
	params: Record<string, unknown>;
}

export interface PluginBridgeResponse {
	id?: string;
	success: boolean;
	data?: unknown;
	error?: string;
}

export interface PluginCapabilities {
	version: string;
	commands: string[];
	features: string[];
}

export const ALL_MODULES = [
	"console",
	"actor",
	"asset",
	"build",
	"blueprint",
	"material",
	"sequencer",
	"animation",
	"niagara",
	"testing",
	"source-control",
	"profiling",
	"world-partition",
	"editor-utils",
	"remote-control-presets",
	"plugin",
] as const;

export type ModuleName = (typeof ALL_MODULES)[number];
