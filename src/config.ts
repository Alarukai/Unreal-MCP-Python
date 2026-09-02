import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { UnrealMcpConfig } from "./types.js";
import { ALL_MODULES } from "./types.js";

const DEFAULTS: UnrealMcpConfig = {
	projectPath: "",
	remoteControlPort: 30010,
	remoteControlWsPort: 30020,
	pythonExecPort: 6776,
	pluginBridgePort: 55557,
	multicastBindAddress: "127.0.0.1",
	platform: "Win64",
	configuration: "Development",
	enabledModules: [...ALL_MODULES],
	timeouts: {
		build: 600_000,
		cook: 1_200_000,
		remoteControl: 10_000,
		pythonExec: 30_000,
	},
};

function loadConfigFile(): Partial<UnrealMcpConfig> {
	const candidates = [
		join(process.cwd(), ".unrealmcp.json"),
		join(process.env.HOME || process.env.USERPROFILE || "", ".unrealmcp.json"),
	];

	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			try {
				return JSON.parse(readFileSync(candidate, "utf-8"));
			} catch {
				// Ignore invalid JSON
			}
		}
	}
	return {};
}

function loadEnvVars(): Partial<UnrealMcpConfig> {
	const config: Partial<UnrealMcpConfig> = {};

	if (process.env.UNREAL_MCP_PROJECT_PATH) {
		config.projectPath = process.env.UNREAL_MCP_PROJECT_PATH;
	}
	if (process.env.UNREAL_MCP_ENGINE_PATH) {
		config.enginePath = process.env.UNREAL_MCP_ENGINE_PATH;
	}
	if (process.env.UNREAL_MCP_RC_PORT) {
		config.remoteControlPort = Number.parseInt(process.env.UNREAL_MCP_RC_PORT, 10);
	}
	if (process.env.UNREAL_MCP_PYTHON_PORT) {
		config.pythonExecPort = Number.parseInt(process.env.UNREAL_MCP_PYTHON_PORT, 10);
	}
	if (process.env.UNREAL_MCP_PLUGIN_SECRET) {
		config.pluginBridgeSecret = process.env.UNREAL_MCP_PLUGIN_SECRET;
	}
	if (process.env.UNREAL_MCP_MULTICAST_BIND) {
		config.multicastBindAddress = process.env.UNREAL_MCP_MULTICAST_BIND;
	}
	if (process.env.UNREAL_MCP_MULTICAST_IFACE) {
		config.multicastInterface = process.env.UNREAL_MCP_MULTICAST_IFACE;
	}
	if (process.env.UNREAL_MCP_PLATFORM) {
		config.platform = process.env.UNREAL_MCP_PLATFORM;
	}
	if (process.env.UNREAL_MCP_CONFIGURATION) {
		config.configuration = process.env.UNREAL_MCP_CONFIGURATION;
	}
	if (process.env.UNREAL_MCP_MODULES) {
		config.enabledModules = process.env.UNREAL_MCP_MODULES.split(",").map((m) => m.trim());
	}

	return config;
}

export function parseCliArgs(argv: string[]): Partial<UnrealMcpConfig> {
	const config: Partial<UnrealMcpConfig> = {};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const next = argv[i + 1];

		switch (arg) {
			case "--project-path":
				config.projectPath = next;
				i++;
				break;
			case "--engine-path":
				config.enginePath = next;
				i++;
				break;
			case "--rc-port":
				config.remoteControlPort = Number.parseInt(next, 10);
				i++;
				break;
			case "--python-port":
				config.pythonExecPort = Number.parseInt(next, 10);
				i++;
				break;
			case "--plugin-port":
				config.pluginBridgePort = Number.parseInt(next, 10);
				i++;
				break;
			case "--plugin-secret":
				config.pluginBridgeSecret = next;
				i++;
				break;
			case "--multicast-bind":
				config.multicastBindAddress = next;
				i++;
				break;
			case "--multicast-iface":
				config.multicastInterface = next;
				i++;
				break;
			case "--platform":
				config.platform = next;
				i++;
				break;
			case "--configuration":
				config.configuration = next;
				i++;
				break;
			case "--modules":
				config.enabledModules = next.split(",").map((m) => m.trim());
				i++;
				break;
		}
	}

	return config;
}

function autoDetectEnginePath(projectPath: string): string | undefined {
	if (!projectPath || !existsSync(projectPath)) return undefined;

	// Try to read .uproject for engine association
	const uprojectPath = projectPath.endsWith(".uproject")
		? projectPath
		: join(projectPath, findUproject(projectPath));

	if (!uprojectPath || !existsSync(uprojectPath)) return undefined;

	try {
		const uproject = JSON.parse(readFileSync(uprojectPath, "utf-8"));
		const association = uproject.EngineAssociation;
		if (!association) return undefined;

		// Common UE install locations on Windows
		const candidates = [
			`C:\\Program Files\\Epic Games\\UE_${association}`,
			`C:\\Program Files (x86)\\Epic Games\\UE_${association}`,
			`D:\\Program Files\\Epic Games\\UE_${association}`,
		];

		for (const candidate of candidates) {
			if (existsSync(candidate)) return candidate;
		}
	} catch {
		// Ignore
	}

	return undefined;
}

function findUproject(dir: string): string {
	try {
		const entries = require("node:fs").readdirSync(dir) as string[];
		const uproject = entries.find((e: string) => e.endsWith(".uproject"));
		return uproject || "";
	} catch {
		return "";
	}
}

export function loadConfig(argv: string[] = process.argv.slice(2)): UnrealMcpConfig {
	const fileConfig = loadConfigFile();
	const envConfig = loadEnvVars();
	const cliConfig = parseCliArgs(argv);

	// Priority: CLI > env > file > defaults
	const merged: UnrealMcpConfig = {
		...DEFAULTS,
		...fileConfig,
		...envConfig,
		...cliConfig,
		timeouts: {
			...DEFAULTS.timeouts,
			...(fileConfig.timeouts || {}),
			...(envConfig.timeouts || {}),
			...(cliConfig.timeouts || {}),
		},
	};

	// Resolve project path
	if (merged.projectPath) {
		merged.projectPath = resolve(merged.projectPath);
	}

	// Auto-detect engine path if not provided
	if (!merged.enginePath && merged.projectPath) {
		merged.enginePath = autoDetectEnginePath(merged.projectPath);
	}

	if (merged.enginePath) {
		merged.enginePath = resolve(merged.enginePath);
	}

	return merged;
}
