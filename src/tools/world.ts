import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";
import { inlineScript } from "../utils/template.js";

const FIND_ACTOR = `actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
target = None
for a in actors:
    if a.get_name() == '{{actor}}' or a.get_actor_label() == '{{actor}}':
        target = a
        break`;

export function registerWorldTools(
	server: McpServer,
	manager: ConnectionManager,
	_config: UnrealMcpConfig,
): void {
	server.tool(
		"get_world_settings",
		"Read the current level's World Settings: gravity override, default game mode, kill-Z, world name.",
		{},
		{ readOnlyHint: true },
		async () => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
if not world:
    print(json.dumps({"error": "No editor world"}))
else:
    ws = world.get_world_settings()
    result = {"success": True, "world_name": world.get_name()}
    for field, prop in (
        ("global_gravity_set", "bGlobalGravitySet"),
        ("global_gravity_z", "GlobalGravityZ"),
        ("kill_z", "KillZ"),
    ):
        try:
            result[field] = ws.get_editor_property(prop)
        except Exception:
            result[field] = None
    try:
        game_mode = ws.get_editor_property('DefaultGameMode')
        result["default_game_mode"] = game_mode.get_path_name() if game_mode else None
    except Exception:
        result["default_game_mode"] = None
    print(json.dumps(result, indent=2))`,
				{},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"set_world_settings",
		"Set World Settings properties: gravity override, default game mode, kill-Z.",
		{
			global_gravity_z: z
				.number()
				.optional()
				.describe("Global gravity Z override (also sets bGlobalGravitySet=true)"),
			default_game_mode: z.string().optional().describe("GameMode class or Blueprint path"),
			kill_z: z.number().optional().describe("Actors falling below this Z are destroyed"),
		},
		async ({ global_gravity_z, default_game_mode, kill_z }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
if not world:
    print(json.dumps({"error": "No editor world"}))
else:
    ws = world.get_world_settings()
    applied = []
    warnings = []
    gravity_z = {{gravity_z}}
    if gravity_z is not None:
        try:
            ws.set_editor_property('bGlobalGravitySet', True)
            ws.set_editor_property('GlobalGravityZ', gravity_z)
            applied.append('global_gravity_z')
        except Exception as e:
            warnings.append('global_gravity_z: ' + str(e))
    kill_z = {{kill_z}}
    if kill_z is not None:
        try:
            ws.set_editor_property('KillZ', kill_z)
            applied.append('kill_z')
        except Exception as e:
            warnings.append('kill_z: ' + str(e))
    game_mode_path = '{{default_game_mode}}'
    if game_mode_path:
        gm_class = getattr(unreal, game_mode_path, None)
        if gm_class is None:
            gm_asset = unreal.EditorAssetLibrary.load_asset(game_mode_path)
            gm_class = gm_asset.generated_class() if gm_asset and hasattr(gm_asset, 'generated_class') else gm_asset
        if gm_class:
            try:
                ws.set_editor_property('DefaultGameMode', gm_class)
                applied.append('default_game_mode')
            except Exception as e:
                warnings.append('default_game_mode: ' + str(e))
        else:
            warnings.append('GameMode class not found: ' + game_mode_path)
    ws.mark_package_dirty()
    print(json.dumps({"success": True, "applied": applied, "warnings": warnings}))`,
				{
					gravity_z: global_gravity_z ?? "None",
					kill_z: kill_z ?? "None",
					default_game_mode: default_game_mode || "",
				},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"get_replication_info",
		"Read an actor's replication settings: replicates, replicate movement, net update frequency.",
		{ actor: z.string().describe("Actor name or label") },
		{ readOnlyHint: true },
		async ({ actor }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
${FIND_ACTOR}
if not target:
    print(json.dumps({"error": "Actor not found: {{actor}}"}))
else:
    result = {"success": True, "actor": target.get_actor_label()}
    for field, prop in (
        ("replicates", "bReplicates"),
        ("replicate_movement", "bReplicateMovement"),
        ("net_update_frequency", "NetUpdateFrequency"),
        ("min_net_update_frequency", "MinNetUpdateFrequency"),
        ("net_dormancy", "NetDormancy"),
    ):
        try:
            value = target.get_editor_property(prop)
            result[field] = str(value) if field == "net_dormancy" else value
        except Exception:
            result[field] = None
    print(json.dumps(result, indent=2))`,
				{ actor },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"set_replication_settings",
		"Set an actor's replication settings: replicates, replicate movement, net update frequency.",
		{
			actor: z.string().describe("Actor name or label"),
			replicates: z.boolean().optional(),
			replicate_movement: z.boolean().optional(),
			net_update_frequency: z.number().optional(),
		},
		async ({ actor, replicates, replicate_movement, net_update_frequency }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
${FIND_ACTOR}
if not target:
    print(json.dumps({"error": "Actor not found: {{actor}}"}))
else:
    applied = []
    warnings = []
    replicates = {{replicates}}
    if replicates is not None:
        try:
            target.set_replicates(replicates)
            applied.append('replicates')
        except Exception as e:
            warnings.append('replicates: ' + str(e))
    replicate_movement = {{replicate_movement}}
    if replicate_movement is not None:
        try:
            target.set_editor_property('bReplicateMovement', replicate_movement)
            applied.append('replicate_movement')
        except Exception as e:
            warnings.append('replicate_movement: ' + str(e))
    net_freq = {{net_update_frequency}}
    if net_freq is not None:
        try:
            target.set_editor_property('NetUpdateFrequency', net_freq)
            applied.append('net_update_frequency')
        except Exception as e:
            warnings.append('net_update_frequency: ' + str(e))
    target.mark_package_dirty()
    print(json.dumps({"success": True, "actor": target.get_actor_label(), "applied": applied, "warnings": warnings}))`,
				{
					actor,
					replicates: replicates === undefined ? "None" : replicates ? "True" : "False",
					replicate_movement:
						replicate_movement === undefined ? "None" : replicate_movement ? "True" : "False",
					net_update_frequency: net_update_frequency ?? "None",
				},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"set_net_dormancy",
		"Set an actor's network dormancy mode.",
		{
			actor: z.string().describe("Actor name or label"),
			mode: z.enum(["Never", "Awake", "DormantAll", "DormantPartial", "Initial"]),
		},
		async ({ actor, mode }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
${FIND_ACTOR}
if not target:
    print(json.dumps({"error": "Actor not found: {{actor}}"}))
else:
    dormancy = getattr(unreal.NetDormancy, 'DORM_{{mode}}', None)
    if dormancy is None:
        print(json.dumps({"error": "Unknown dormancy mode: {{mode}}"}))
    else:
        target.set_editor_property('NetDormancy', dormancy)
        target.mark_package_dirty()
        print(json.dumps({"success": True, "actor": target.get_actor_label(), "dormancy": "{{mode}}"}))`,
				{ actor, mode },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"get_landscape_info",
		"Read info about landscape actors in the level: material, component count.",
		{},
		{ readOnlyHint: true },
		async () => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
landscapes = []
for a in actors:
    if isinstance(a, unreal.LandscapeProxy):
        entry = {"name": a.get_actor_label()}
        try:
            mat = a.get_editor_property('LandscapeMaterial')
            entry["material"] = mat.get_name() if mat else None
        except Exception:
            entry["material"] = None
        try:
            components = a.get_editor_property('LandscapeComponents')
            entry["component_count"] = len(components)
        except Exception:
            entry["component_count"] = None
        landscapes.append(entry)
print(json.dumps({"success": True, "landscapes": landscapes}, indent=2))`,
				{},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"set_landscape_material",
		"Assign a material to a landscape actor.",
		{
			landscape: z.string().describe("Landscape actor name or label"),
			material_path: z.string().describe("Material asset path"),
		},
		async ({ landscape, material_path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
material = unreal.EditorAssetLibrary.load_asset('{{material_path}}')
if not material:
    print(json.dumps({"error": "Material not found: {{material_path}}"}))
else:
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
    target = None
    for a in actors:
        if isinstance(a, unreal.LandscapeProxy) and (a.get_name() == '{{landscape}}' or a.get_actor_label() == '{{landscape}}'):
            target = a
            break
    if not target:
        print(json.dumps({"error": "Landscape not found: {{landscape}}"}))
    else:
        target.set_editor_property('LandscapeMaterial', material)
        target.mark_package_dirty()
        print(json.dumps({"success": True, "landscape": target.get_actor_label(), "material": material.get_name()}))`,
				{ landscape, material_path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);
}
