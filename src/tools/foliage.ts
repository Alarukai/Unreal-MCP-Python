import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";
import { inlineScript } from "../utils/template.js";

export function registerFoliageTools(
	server: McpServer,
	manager: ConnectionManager,
	_config: UnrealMcpConfig,
): void {
	server.tool(
		"add_foliage_type",
		"Register a static mesh as a foliage type on the level's InstancedFoliageActor, creating it if needed. Does not place any instances — use paint_foliage for that.",
		{ mesh_path: z.string().describe("Static mesh asset path") },
		async ({ mesh_path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
mesh = unreal.EditorAssetLibrary.load_asset('{{mesh_path}}')
if not mesh or not isinstance(mesh, unreal.StaticMesh):
    print(json.dumps({"error": "Static mesh not found: {{mesh_path}}"}))
else:
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    ifa = unreal.InstancedFoliageActor.get_instanced_foliage_actor_for_level(world, True)
    if not ifa:
        print(json.dumps({"error": "Failed to get/create InstancedFoliageActor"}))
    else:
        foliage_type = unreal.new_object(unreal.FoliageType_InstancedStaticMesh, outer=ifa)
        foliage_type.set_editor_property('Mesh', mesh)
        added = ifa.add_foliage_type(foliage_type)
        print(json.dumps({"success": added is not None, "mesh": mesh.get_name()}))`,
				{ mesh_path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"paint_foliage",
		"Scatter random foliage instances of a static mesh within a radius of a center point. Registers the mesh as a foliage type first if needed.",
		{
			mesh_path: z.string().describe("Static mesh asset path"),
			center: z
				.object({ x: z.number(), y: z.number(), z: z.number() })
				.default({ x: 0, y: 0, z: 0 }),
			radius: z.number().default(500).describe("Scatter radius"),
			count: z.number().int().min(1).max(5000).default(10).describe("Number of instances to place"),
		},
		async ({ mesh_path, center, radius, count }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
import random
import math
mesh = unreal.EditorAssetLibrary.load_asset('{{mesh_path}}')
if not mesh or not isinstance(mesh, unreal.StaticMesh):
    print(json.dumps({"error": "Static mesh not found: {{mesh_path}}"}))
else:
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    ifa = unreal.InstancedFoliageActor.get_instanced_foliage_actor_for_level(world, True)
    if not ifa:
        print(json.dumps({"error": "Failed to get/create InstancedFoliageActor"}))
    else:
        foliage_type = unreal.new_object(unreal.FoliageType_InstancedStaticMesh, outer=ifa)
        foliage_type.set_editor_property('Mesh', mesh)
        ifa.add_foliage_type(foliage_type)
        cx, cy, cz, r = {{cx}}, {{cy}}, {{cz}}, {{radius}}
        transforms = []
        for i in range({{count}}):
            angle = random.uniform(0, 2 * math.pi)
            dist = random.uniform(0, r)
            loc = unreal.Vector(cx + math.cos(angle) * dist, cy + math.sin(angle) * dist, cz)
            rot = unreal.Rotator(0, random.uniform(0, 360), 0)
            transforms.append(unreal.Transform(location=loc, rotation=rot, scale=unreal.Vector(1, 1, 1)))
        try:
            ifa.add_instances(world, foliage_type, transforms)
            print(json.dumps({"success": True, "painted": len(transforms), "mesh": mesh.get_name()}))
        except Exception as e:
            print(json.dumps({"error": "add_instances failed: " + str(e)}))`,
				{ mesh_path, cx: center.x, cy: center.y, cz: center.z, radius, count },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"erase_foliage",
		"Remove foliage instances within a radius of a center point, optionally filtered to one static mesh type. Best-effort: per-instance foliage data (FoliageInfos/Instances) is a version-sensitive internal structure that may not be fully Python-reflected on every engine version — if removal isn't possible, this reports what it found without erasing anything, rather than silently doing nothing.",
		{
			center: z
				.object({ x: z.number(), y: z.number(), z: z.number() })
				.default({ x: 0, y: 0, z: 0 }),
			radius: z.number().default(1000),
			mesh_path: z.string().optional().describe("Only erase instances of this static mesh"),
		},
		{ destructiveHint: true },
		async ({ center, radius, mesh_path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
import math
world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
filter_mesh = unreal.EditorAssetLibrary.load_asset('{{mesh_path}}') if '{{mesh_path}}' else None
cx, cy, cz, r = {{cx}}, {{cy}}, {{cz}}, {{radius}}
removed = 0
found = 0
warnings = []
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
for a in actors:
    if not isinstance(a, unreal.InstancedFoliageActor):
        continue
    try:
        infos = a.get_editor_property('FoliageInfos')
    except Exception as e:
        warnings.append('Could not read FoliageInfos on ' + a.get_name() + ': ' + str(e))
        continue
    for foliage_type in infos:
        if filter_mesh and hasattr(foliage_type, 'get_editor_property'):
            try:
                if foliage_type.get_editor_property('Mesh') != filter_mesh:
                    continue
            except Exception:
                pass
        try:
            info = infos[foliage_type]
            instances = info.get_editor_property('Instances')
        except Exception as e:
            warnings.append('Could not read Instances: ' + str(e))
            continue
        to_remove = []
        for i, inst in enumerate(instances):
            try:
                loc = inst.get_editor_property('Location')
                dist = math.sqrt((loc.x - cx) ** 2 + (loc.y - cy) ** 2 + (loc.z - cz) ** 2)
                if dist <= r:
                    to_remove.append(i)
            except Exception:
                pass
        found += len(to_remove)
        if to_remove and hasattr(info, 'remove_instances'):
            try:
                info.remove_instances(to_remove, True)
                removed += len(to_remove)
            except Exception as e:
                warnings.append('remove_instances failed: ' + str(e))
        elif to_remove:
            warnings.append(str(len(to_remove)) + ' matching instances found but no remove_instances API on this engine version — not removed.')
print(json.dumps({"success": True, "found": found, "removed": removed, "warnings": warnings}))`,
				{ cx: center.x, cy: center.y, cz: center.z, radius, mesh_path: mesh_path || "" },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"get_foliage_stats",
		"Get instance counts per foliage type across all InstancedFoliageActors in the level.",
		{},
		{ readOnlyHint: true },
		async () => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
types = []
total = 0
for a in actors:
    if not isinstance(a, unreal.InstancedFoliageActor):
        continue
    try:
        infos = a.get_editor_property('FoliageInfos')
    except Exception:
        infos = None
    if not infos:
        continue
    for key in infos:
        try:
            info = infos[key]
            count = len(info.get_editor_property('Instances'))
            types.append({"type": key.get_name(), "instances": count})
            total += count
        except Exception:
            pass
print(json.dumps({"success": True, "foliage_types": types, "total_instances": total}, indent=2))`,
				{},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);
}
