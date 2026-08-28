import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "./config.js";
import { registerAllTools } from "./tools/index.js";
import { ConnectionManager } from "./transports/connection-manager.js";
import type { UnrealMcpConfig } from "./types.js";

export async function createServer(
	argv?: string[],
): Promise<{ server: McpServer; config: UnrealMcpConfig }> {
	const config = loadConfig(argv);

	const server = new McpServer({
		name: "unreal-mcp",
		version: "0.1.0",
	});

	const manager = new ConnectionManager();
	await manager.initialize(config);

	// Register all enabled tool modules
	registerAllTools(server, manager, config);

	// Register resources for project info and connection status
	server.resource("project-info", "unreal://project", async () => ({
		contents: [
			{
				uri: "unreal://project",
				mimeType: "application/json",
				text: JSON.stringify(
					{
						projectPath: config.projectPath,
						enginePath: config.enginePath,
						platform: config.platform,
						configuration: config.configuration,
						enabledModules: config.enabledModules,
					},
					null,
					2,
				),
			},
		],
	}));

	server.resource("connection-status", "unreal://status", async () => {
		const status = await manager.refreshStatus();
		return {
			contents: [
				{
					uri: "unreal://status",
					mimeType: "application/json",
					text: JSON.stringify(
						{
							...status,
							pluginCapabilities: manager.pluginCapabilities,
						},
						null,
						2,
					),
				},
			],
		};
	});

	// Editor-context resources: cheap to pull without a full tool round trip.
	// Each is self-contained (no requireEditor() throw) — if the editor isn't
	// connected, the resource still resolves with an {"error": ...} payload
	// rather than failing the resource read itself.
	const editorContextResource = (name: string, uri: string, script: string): void => {
		server.resource(name, uri, async () => {
			let text: string;
			try {
				text = await manager.runPython(script);
			} catch (error) {
				text = JSON.stringify({ error: String(error) });
			}
			return {
				contents: [{ uri, mimeType: "application/json", text }],
			};
		});
	};

	editorContextResource(
		"current-level",
		"unreal://level/current",
		`import unreal
import json
world = unreal.EditorLevelLibrary.get_editor_world() if hasattr(unreal, 'EditorLevelLibrary') else unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
actors = unreal.EditorLevelLibrary.get_all_level_actors() if hasattr(unreal, 'EditorLevelLibrary') else unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
result = {
    "level_name": world.get_name() if world else None,
    "level_path": world.get_path_name() if world else None,
    "actor_count": len(actors) if actors else 0,
}
print(json.dumps(result, indent=2))`,
	);

	editorContextResource(
		"editor-selection",
		"unreal://editor/selection",
		`import unreal
import json
subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
selected = subsys.get_selected_level_actors()
result = [
    {"name": a.get_name(), "label": a.get_actor_label(), "class": a.get_class().get_name()}
    for a in selected
]
print(json.dumps({"selected_actors": result, "count": len(result)}, indent=2))`,
	);

	editorContextResource(
		"editor-performance",
		"unreal://editor/performance",
		`import unreal
import json
# No Python-readable FPS/frame-time API exists (GAverageFPS is a C++-only
# global). 'stat unit' toggles a visual overlay, not a queryable value —
# use take_screenshot to see it, or read_log to catch perf warnings that
# get logged (e.g. hitches).
result = {
    "game_time_seconds": unreal.SystemLibrary.get_game_time_in_seconds(
        unreal.EditorLevelLibrary.get_editor_world()
        if hasattr(unreal, 'EditorLevelLibrary')
        else unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    ),
    "note": "No direct Python FPS/frame-time API. Use take_screenshot with the 'stat unit' overlay enabled, or read_log for logged perf warnings.",
}
print(json.dumps(result, indent=2))`,
	);

	return { server, config };
}
