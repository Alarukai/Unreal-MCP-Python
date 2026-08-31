import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";
import { inlineScript } from "../utils/template.js";

export function registerLevelTools(
	server: McpServer,
	manager: ConnectionManager,
	_config: UnrealMcpConfig,
): void {
	server.tool(
		"new_level",
		"Create a new, blank level and open it. The current level's unsaved changes are discarded — save first if needed.",
		{
			path: z.string().default("/Game/Maps/NewMap").describe("Package path for the new level"),
		},
		async ({ path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
success = les.new_level('{{path}}')
print(json.dumps({"success": success, "path": "{{path}}"}))`,
				{ path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"open_level",
		"Load an existing level by asset path, replacing the currently open level. Unsaved changes are discarded — save first if needed.",
		{ path: z.string().describe("Level asset path") },
		async ({ path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
if not unreal.EditorAssetLibrary.does_asset_exist('{{path}}'):
    print(json.dumps({"error": "Level not found: {{path}}"}))
else:
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    success = les.load_level('{{path}}')
    print(json.dumps({"success": success, "path": "{{path}}"}))`,
				{ path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"save_level",
		"Save the currently open level. Returns success:true with a note if the level is untitled/transient (nothing to save yet — use new_level's path or Save As in the editor first).",
		{},
		async () => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
success = les.save_current_level()
if not success:
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    map_name = world.get_map_name() if world else ""
    if not map_name or map_name.startswith("Untitled"):
        print(json.dumps({"success": True, "note": "Current level is untitled/transient — nothing to save yet."}))
    else:
        print(json.dumps({"success": False}))
else:
    print(json.dumps({"success": True}))`,
				{},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"get_level_info",
		"Get info about the currently open level: name, actor count, streaming sub-levels, and world bounds.",
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
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
    result = {"success": True, "level_name": world.get_map_name(), "actor_count": len(actors)}
    streaming = []
    try:
        for sl in world.get_streaming_levels():
            streaming.append({"name": str(sl.get_world_asset_package_name()), "loaded": sl.is_level_loaded()})
    except Exception:
        pass
    result["streaming_levels"] = streaming
    print(json.dumps(result, indent=2))`,
				{},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"create_basic_level",
		"Populate the current level with a basic starter set: a floor plane, a directional light ('Sun'), a sky light, and a player start.",
		{},
		async () => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
created = []

floor = subsys.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector(0, 0, 0))
if floor:
    plane_mesh = unreal.EditorAssetLibrary.load_asset('/Engine/BasicShapes/Plane.Plane')
    if plane_mesh:
        floor.static_mesh_component.set_static_mesh(plane_mesh)
    floor.set_actor_scale3d(unreal.Vector(50, 50, 1))
    floor.set_actor_label('Floor')
    created.append('Floor')

sun = subsys.spawn_actor_from_class(unreal.DirectionalLight, unreal.Vector(0, 0, 500), unreal.Rotator(-45, 30, 0))
if sun:
    sun.set_actor_label('Sun')
    created.append('Sun')

sky = subsys.spawn_actor_from_class(unreal.SkyLight, unreal.Vector(0, 0, 500))
if sky:
    sky.set_actor_label('SkyLight')
    created.append('SkyLight')

player_start = subsys.spawn_actor_from_class(unreal.PlayerStart, unreal.Vector(0, 0, 100))
if player_start:
    player_start.set_actor_label('PlayerStart')
    created.append('PlayerStart')

print(json.dumps({"success": True, "created": created}))`,
				{},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"create_light_rig",
		"Spawn a classic three-point lighting rig (key/fill/rim point lights + a sky light) centered on a location.",
		{
			center: z
				.object({ x: z.number(), y: z.number(), z: z.number() })
				.default({ x: 0, y: 0, z: 300 }),
			radius: z.number().default(500).describe("Distance of the key/fill lights from center"),
		},
		async ({ center, radius }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
cx, cy, cz, r = {{cx}}, {{cy}}, {{cz}}, {{radius}}
created = []

key = subsys.spawn_actor_from_class(unreal.PointLight, unreal.Vector(cx + r, cy - r, cz + 200))
if key:
    key.set_actor_label('KeyLight')
    key.point_light_component.set_intensity(5000)
    created.append('KeyLight')

fill = subsys.spawn_actor_from_class(unreal.PointLight, unreal.Vector(cx - r * 0.7, cy + r * 0.5, cz))
if fill:
    fill.set_actor_label('FillLight')
    fill.point_light_component.set_intensity(2000)
    created.append('FillLight')

rim = subsys.spawn_actor_from_class(unreal.PointLight, unreal.Vector(cx - r * 0.3, cy, cz + 400))
if rim:
    rim.set_actor_label('RimLight')
    rim.point_light_component.set_intensity(3000)
    created.append('RimLight')

sky = subsys.spawn_actor_from_class(unreal.SkyLight, unreal.Vector(cx, cy, cz + 500))
if sky:
    sky.set_actor_label('SkyLight_Rig')
    created.append('SkyLight_Rig')

print(json.dumps({"success": True, "created": created}))`,
				{ cx: center.x, cy: center.y, cz: center.z, radius },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"create_grid_layout",
		"Spawn a grid of static mesh actors (defaults to a cube if no mesh given).",
		{
			mesh_path: z.string().optional().describe("Static mesh asset path (default: engine Cube)"),
			rows: z.number().int().min(1).default(3),
			cols: z.number().int().min(1).default(3),
			spacing: z.number().default(200),
			origin: z
				.object({ x: z.number(), y: z.number(), z: z.number() })
				.default({ x: 0, y: 0, z: 0 }),
		},
		async ({ mesh_path, rows, cols, spacing, origin }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
mesh = unreal.EditorAssetLibrary.load_asset('{{mesh_path}}') if '{{mesh_path}}' else None
if not mesh:
    mesh = unreal.EditorAssetLibrary.load_asset('/Engine/BasicShapes/Cube.Cube')
subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
spawned = 0
for row in range({{rows}}):
    for col in range({{cols}}):
        loc = unreal.Vector({{ox}} + col * {{spacing}}, {{oy}} + row * {{spacing}}, {{oz}})
        actor = subsys.spawn_actor_from_class(unreal.StaticMeshActor, loc)
        if actor and mesh:
            actor.static_mesh_component.set_static_mesh(mesh)
            actor.set_actor_label('Grid_' + str(row) + '_' + str(col))
            spawned += 1
print(json.dumps({"success": True, "spawned": spawned, "rows": {{rows}}, "cols": {{cols}}}))`,
				{
					mesh_path: mesh_path || "",
					rows,
					cols,
					spacing,
					ox: origin.x,
					oy: origin.y,
					oz: origin.z,
				},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"create_ring_layout",
		"Spawn static mesh actors evenly spaced around a ring (defaults to a cube if no mesh given).",
		{
			mesh_path: z.string().optional().describe("Static mesh asset path (default: engine Cube)"),
			count: z.number().int().min(1).default(8),
			radius: z.number().default(500),
			center: z
				.object({ x: z.number(), y: z.number(), z: z.number() })
				.default({ x: 0, y: 0, z: 0 }),
			face_center: z.boolean().default(true).describe("Rotate each actor to face the ring center"),
		},
		async ({ mesh_path, count, radius, center, face_center }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
import math
mesh = unreal.EditorAssetLibrary.load_asset('{{mesh_path}}') if '{{mesh_path}}' else None
if not mesh:
    mesh = unreal.EditorAssetLibrary.load_asset('/Engine/BasicShapes/Cube.Cube')
subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
cx, cy, cz, r = {{cx}}, {{cy}}, {{cz}}, {{radius}}
face_center = {{face_center}}
spawned = 0
for i in range({{count}}):
    angle = (2.0 * math.pi * i) / {{count}}
    x = cx + r * math.cos(angle)
    y = cy + r * math.sin(angle)
    loc = unreal.Vector(x, y, cz)
    if face_center:
        direction = unreal.Vector(cx - x, cy - y, 0)
        rot = unreal.MathLibrary.make_rot_from_x(direction)
    else:
        rot = unreal.Rotator(0, 0, 0)
    actor = subsys.spawn_actor_from_class(unreal.StaticMeshActor, loc, rot)
    if actor and mesh:
        actor.static_mesh_component.set_static_mesh(mesh)
        actor.set_actor_label('Ring_' + str(i))
        spawned += 1
print(json.dumps({"success": True, "spawned": spawned, "radius": r}))`,
				{
					mesh_path: mesh_path || "",
					count,
					radius,
					cx: center.x,
					cy: center.y,
					cz: center.z,
					face_center: face_center ? "True" : "False",
				},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);
}
