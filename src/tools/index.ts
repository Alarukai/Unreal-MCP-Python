import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";
import { registerActorTools } from "./actor.js";
import { registerAssetTools } from "./asset.js";
import { registerBlueprintTools } from "./blueprint.js";
import { registerBuildTools } from "./build.js";
import { registerConsoleTools } from "./console.js";
import { registerMaterialTools } from "./material.js";
import { registerNiagaraTools } from "./niagara.js";
import { registerSequencerTools } from "./sequencer.js";
import { registerSourceControlTools } from "./source-control.js";
import { registerTestingTools } from "./testing.js";
import { registerAnimationTools } from "./animation.js";

// Tool registration functions keyed by module name
const MODULE_REGISTRARS: Record<
	string,
	(server: McpServer, manager: ConnectionManager, config: UnrealMcpConfig) => void
> = {
	console: registerConsoleTools,
	actor: registerActorTools,
	asset: registerAssetTools,
	build: registerBuildTools,
	blueprint: registerBlueprintTools,
	material: registerMaterialTools,
	sequencer: registerSequencerTools,
	animation: registerAnimationTools,
	niagara: registerNiagaraTools,
	testing: registerTestingTools,
	"source-control": registerSourceControlTools,
	// Phase 5 modules:
	// profiling: registerProfilingTools,
	// "world-partition": registerWorldPartitionTools,
	// "editor-utils": registerEditorUtilsTools,
	// "remote-control-presets": registerRemoteControlPresetsTools,
	// plugin: registerPluginTools,
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
