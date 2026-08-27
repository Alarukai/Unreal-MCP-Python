import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";
import { inlineScript } from "../utils/template.js";

export function registerWorldPartitionTools(
	server: McpServer,
	manager: ConnectionManager,
	_config: UnrealMcpConfig,
): void {
	server.tool(
		"list_data_layers",
		"List all data layers in the current World Partition level.",
		{},
		async () => {
			await manager.requireEditor();
			const script = `import unreal
import json
world = unreal.EditorLevelLibrary.get_editor_world()
subsys = unreal.WorldPartitionSubsystem()
layers = unreal.get_editor_subsystem(unreal.DataLayerEditorSubsystem)
if layers:
    all_layers = layers.get_all_data_layers()
    result = []
    for layer in all_layers:
        result.append({
            "name": layer.get_data_layer_short_name(),
            "label": str(layer.get_data_layer_label()),
            "is_runtime": layer.is_runtime(),
        })
    print(json.dumps(result, indent=2))
else:
    print(json.dumps({"error": "No DataLayerManager found. Is this a World Partition level?"}))`;
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"set_data_layer_state",
		"Set the state of a data layer (Loaded, Activated, Unloaded).",
		{
			layer_name: z.string().describe("Data layer name"),
			state: z.enum(["Loaded", "Activated", "Unloaded"]).describe("Target state"),
		},
		async ({ layer_name, state }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
world = unreal.EditorLevelLibrary.get_editor_world()
manager = unreal.get_editor_subsystem(unreal.DataLayerEditorSubsystem)
if manager:
    layers = manager.get_all_data_layers()
    for layer in layers:
        if layer.get_data_layer_short_name() == '{{layer_name}}':
            state_enum = getattr(unreal.DataLayerRuntimeState, '{{state}}')
            manager.set_data_layer_runtime_state(layer, state_enum)
            print(json.dumps({"success": True, "layer": "{{layer_name}}", "state": "{{state}}"}))
            break
    else:
        print(json.dumps({"error": "Data layer not found: {{layer_name}}"}))
else:
    print(json.dumps({"error": "No DataLayerManager found"}))`,
				{ layer_name, state },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool("get_loaded_cells", "Query currently loaded world partition cells.", {}, async () => {
		await manager.requireEditor();
		const script = `import unreal
import json
world = unreal.EditorLevelLibrary.get_editor_world()
wp = world.get_world_partition()
if wp:
    print(json.dumps({"success": True, "has_world_partition": True, "hint": "World Partition cell info available in editor World Partition window"}))
else:
    print(json.dumps({"has_world_partition": False}))`;
		const result = await manager.runPython(script);
		return { content: [{ type: "text", text: result }] };
	});

	server.tool(
		"set_streaming_source",
		"Configure a streaming source component on an actor for World Partition.",
		{
			actor_name: z.string().describe("Actor name or label"),
			radius: z.number().default(10000).describe("Streaming radius in units"),
		},
		async ({ actor_name, radius }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
for a in actors:
    if a.get_name() == '{{actor_name}}' or a.get_actor_label() == '{{actor_name}}':
        comp = a.add_component_by_class(unreal.WorldPartitionStreamingSourceComponent, False, unreal.Transform(), False)
        if comp:
            comp.set_editor_property('TargetGrid', unreal.Name('MainGrid'))
            print(json.dumps({"success": True, "actor": "{{actor_name}}"}))
        else:
            print(json.dumps({"error": "Failed to add streaming source component"}))
        break
else:
    print(json.dumps({"error": "Actor not found: {{actor_name}}"}))`,
				{ actor_name },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);
}
