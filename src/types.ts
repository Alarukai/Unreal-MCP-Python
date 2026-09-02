export interface UnrealMcpConfig {
	projectPath: string;
	enginePath?: string;
	engineVersion?: string;
	remoteControlPort: number;
	remoteControlWsPort: number;
	pythonExecPort: number;
	pluginBridgePort: number;
	/** Optional pre-shared secret for the plugin bridge's `authenticate` handshake. Unset by default — the bridge connects unauthenticated, same as before this option existed. Only meaningful once the (separately built) C++ plugin also validates it. */
	pluginBridgeSecret?: string;
	/** Bind address for the Python Remote Execution UDP multicast discovery socket. Defaults to 127.0.0.1 (loopback-only). Only widen this if the editor and this server run on different network namespaces on the same host (e.g. WSL) and discovery fails. */
	multicastBindAddress: string;
	/** Outbound interface for multicast discovery pings, as an IPv4 address. Only relevant once multicastBindAddress has been widened past loopback — on multi-adapter hosts (Bluetooth PAN, Wi-Fi Direct, VPNs) the OS can pick a link-local adapter the editor never sees. Auto-detected if unset. */
	multicastInterface?: string;
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
	"environment",
	"audio",
	"navigation",
	"widget",
	"datatable",
	"input",
	"ai",
	"level",
	"gameplay",
	"world",
	"foliage",
	"pcg",
	"control-rig",
	"spatial",
	"performance",
] as const;

export type ModuleName = (typeof ALL_MODULES)[number];
