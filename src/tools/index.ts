import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";
import { registerActorTools } from "./actor.js";
import { registerAnimationTools } from "./animation.js";
import { registerAssetTools } from "./asset.js";
import { registerAudioTools } from "./audio.js";
import { registerBlueprintTools } from "./blueprint.js";
import { registerBuildTools } from "./build.js";
import { registerConsoleTools } from "./console.js";
import { registerEditorUtilsTools } from "./editor-utils.js";
import { registerEnvironmentTools } from "./environment.js";
import { registerMaterialTools } from "./material.js";
import { registerNavigationTools } from "./navigation.js";
import { registerNiagaraTools } from "./niagara.js";
import { registerPluginTools } from "./plugin.js";
import { registerProfilingTools } from "./profiling.js";
import { registerRemoteControlPresetsTools } from "./remote-control-presets.js";
import { registerSequencerTools } from "./sequencer.js";
import { registerSourceControlTools } from "./source-control.js";
import { registerTestingTools } from "./testing.js";
import { registerWorldPartitionTools } from "./world-partition.js";

// All tool modules registered
const MODULE_REGISTRARS: Record<
	string,
	(server: McpServer, manager: ConnectionManager, config: UnrealMcpConfig) => void
> = {
	console: registerConsoleTools,
	actor: registerActorTools,
	asset: registerAssetTools,
	audio: registerAudioTools,
	build: registerBuildTools,
	blueprint: registerBlueprintTools,
	material: registerMaterialTools,
	sequencer: registerSequencerTools,
	animation: registerAnimationTools,
	niagara: registerNiagaraTools,
	navigation: registerNavigationTools,
	testing: registerTestingTools,
	"source-control": registerSourceControlTools,
	profiling: registerProfilingTools,
	"world-partition": registerWorldPartitionTools,
	"editor-utils": registerEditorUtilsTools,
	environment: registerEnvironmentTools,
	"remote-control-presets": registerRemoteControlPresetsTools,
	plugin: registerPluginTools,
};

/**
 * Register all enabled tool modules with the MCP server.
 */
export function registerAllTools(
	server: McpServer,
	manager: ConnectionManager,
	config: UnrealMcpConfig,
): void {
	const enabledModules = new Set(config.enabledModules);

	for (const [moduleName, register] of Object.entries(MODULE_REGISTRARS)) {
		if (enabledModules.has(moduleName)) {
			register(server, manager, config);
		}
	}
}
