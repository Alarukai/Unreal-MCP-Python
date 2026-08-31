import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";
import { inlineScript } from "../utils/template.js";

export function registerPerformanceTools(
	server: McpServer,
	manager: ConnectionManager,
	_config: UnrealMcpConfig,
): void {
	server.tool(
		"get_render_stats",
		"Get rendering performance statistics for the current level: estimated draw calls, triangle count from static meshes, light count by type, shadow caster count, and actor distribution by class.",
		{},
		{ readOnlyHint: true },
		async () => {
			await manager.requireEditor();
			const script = `import unreal
import json

actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()

total_actors = 0
total_triangles = 0
total_draw_calls = 0
static_mesh_components = 0
point_lights = 0
spot_lights = 0
dir_lights = 0
shadow_casters = 0
class_distribution = {}

for a in actors:
    total_actors += 1
    class_name = a.get_class().get_name()
    class_distribution[class_name] = class_distribution.get(class_name, 0) + 1

    for smc in a.get_components_by_class(unreal.StaticMeshComponent):
        mesh = smc.get_editor_property('static_mesh')
        if not mesh:
            continue
        static_mesh_components += 1
        try:
            total_triangles += mesh.get_num_triangles(0)
        except Exception:
            pass
        try:
            total_draw_calls += len(mesh.get_editor_property('static_materials'))
        except Exception:
            pass
        if smc.get_editor_property('cast_shadow'):
            shadow_casters += 1

    for lc in a.get_components_by_class(unreal.LightComponent):
        light_class = lc.get_class().get_name()
        if 'Point' in light_class:
            point_lights += 1
        elif 'Spot' in light_class:
            spot_lights += 1
        elif 'Directional' in light_class:
            dir_lights += 1
        if lc.get_editor_property('cast_shadows'):
            shadow_casters += 1

top_classes = sorted(class_distribution.items(), key=lambda kv: kv[1], reverse=True)[:10]

warnings = []
if total_draw_calls > 5000:
    warnings.append(f"Very high draw call estimate: {total_draw_calls}. Use instancing, merge meshes, or reduce material count.")
if total_triangles > 10000000:
    warnings.append(f"Very high triangle count: {total_triangles}. Consider enabling Nanite or adding LODs.")
if shadow_casters > 100:
    warnings.append(f"High shadow caster count: {shadow_casters}.")

result = {
    "total_actors": total_actors,
    "static_mesh_components": static_mesh_components,
    "estimated_triangles": total_triangles,
    "estimated_draw_calls": total_draw_calls,
    "shadow_casters": shadow_casters,
    "lights": {
        "point": point_lights,
        "spot": spot_lights,
        "directional": dir_lights,
        "total": point_lights + spot_lights + dir_lights,
    },
    "top_classes": [{"class": c, "count": n} for c, n in top_classes],
    "warnings": warnings,
}
print(json.dumps(result, indent=2))`;
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"get_memory_report",
		"Get a disk-size memory report for project assets, grouped by category (Textures, StaticMeshes, Blueprints, Materials, Animation, Audio, Other), with the largest assets per category. Note: process/system memory stats are not exposed to Python and are not included.",
		{
			path: z.string().default("/Game/").describe("Content path to analyze"),
			limit: z.number().min(1).max(50).default(10).describe("Top N largest assets per category"),
		},
		{ readOnlyHint: true },
		async ({ path, limit }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
import os

registry = unreal.AssetRegistryHelpers.get_asset_registry()
assets = registry.get_assets_by_path('{{path}}', True) or []
content_dir = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_content_dir())

def category_for(class_name):
    if 'Texture' in class_name:
        return 'Textures'
    if 'StaticMesh' in class_name:
        return 'StaticMeshes'
    if 'Blueprint' in class_name:
        return 'Blueprints'
    if 'Material' in class_name:
        return 'Materials'
    if 'Anim' in class_name or 'Skeleton' in class_name:
        return 'Animation'
    if 'Sound' in class_name or 'MetaSound' in class_name:
        return 'Audio'
    return 'Other'

def asset_file_size(package_name):
    rel = str(package_name)
    if rel.startswith('/Game/'):
        rel = rel[len('/Game/'):]
    for ext in ('.uasset', '.umap'):
        p = os.path.join(content_dir, rel + ext)
        if os.path.exists(p):
            return os.path.getsize(p)
    return 0

categories = {}
for a in assets:
    cls = str(a.asset_class_path.asset_name) if hasattr(a, 'asset_class_path') else str(a.asset_class)
    cat = category_for(cls)
    size = asset_file_size(a.package_name)
    if size <= 0:
        continue
    categories.setdefault(cat, []).append((size, str(a.asset_name)))

limit = {{limit}}
categories_out = []
grand_total = 0
for cat, entries in categories.items():
    entries.sort(key=lambda e: e[0], reverse=True)
    cat_total = sum(e[0] for e in entries)
    grand_total += cat_total
    largest = []
    for size, name in entries[:limit]:
        size_str = f"{size / 1048576.0:.1f} MB" if size > 1048576 else f"{size / 1024.0:.1f} KB"
        largest.append({"name": name, "size": size_str})
    categories_out.append({
        "category": cat,
        "asset_count": len(entries),
        "total_size_mb": cat_total / (1024.0 * 1024.0),
        "largest": largest,
    })

categories_out.sort(key=lambda c: c["total_size_mb"], reverse=True)

print(json.dumps({
    "note": "System/process memory stats are not exposed to Python; this report covers on-disk asset size only.",
    "total_project_size_mb": grand_total / (1024.0 * 1024.0),
    "categories": categories_out,
}, indent=2))`,
				{ path, limit },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"profile_actors_in_view",
		"Estimate per-actor rendering cost for actors near the editor viewport camera: triangle count, material count, shadow casting, and component count, sorted by estimated cost. Useful for finding performance bottlenecks.",
		{
			limit: z.number().min(1).max(100).default(20).describe("Maximum actors to return"),
			include_lights: z.boolean().default(true).describe("Include light actors"),
		},
		{ readOnlyHint: true },
		async ({ limit, include_lights }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json

subsys = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
try:
    cam_loc, cam_rot = subsys.get_level_viewport_camera_info()
except Exception:
    cam_loc = unreal.Vector(0, 0, 0)

actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
max_distance = 50000.0
include_lights = {{include_lights}}

def dist(loc):
    return ((loc.x - cam_loc.x) ** 2 + (loc.y - cam_loc.y) ** 2 + (loc.z - cam_loc.z) ** 2) ** 0.5

costs = []
for a in actors:
    if a.is_hidden_ed():
        continue
    d = dist(a.get_actor_location())
    if d > max_distance:
        continue

    light_comps = a.get_components_by_class(unreal.LightComponent)
    if not include_lights and light_comps:
        continue

    triangles = 0
    material_slots = 0
    components = 0
    casts_shadow = False
    nanite = False

    for smc in a.get_components_by_class(unreal.StaticMeshComponent):
        mesh = smc.get_editor_property('static_mesh')
        if not mesh:
            continue
        components += 1
        try:
            triangles += mesh.get_num_triangles(0)
        except Exception:
            pass
        try:
            material_slots += len(mesh.get_editor_property('static_materials'))
        except Exception:
            pass
        if smc.get_editor_property('cast_shadow'):
            casts_shadow = True
        try:
            nanite = nanite or bool(mesh.get_editor_property('nanite_settings').get_editor_property('enabled'))
        except Exception:
            pass

    if light_comps:
        components += 1
        if light_comps[0].get_editor_property('cast_shadows'):
            casts_shadow = True

    if components == 0:
        continue

    cost = triangles * 0.001 + material_slots * 10.0 + (50.0 if casts_shadow else 0.0) + (-20.0 if nanite else 0.0)
    costs.append({
        "name": a.get_actor_label(),
        "class": a.get_class().get_name(),
        "triangles": triangles,
        "material_slots": material_slots,
        "mesh_components": components,
        "casts_shadow": casts_shadow,
        "nanite": nanite,
        "distance": round(d),
        "estimated_cost": round(cost, 2),
    })

costs.sort(key=lambda c: c["estimated_cost"], reverse=True)
limit = {{limit}}
shown = costs[:limit]

print(json.dumps({
    "visible_actors": len(costs),
    "showing": len(shown),
    "total_triangles_in_view": sum(c["triangles"] for c in shown),
    "actors": shown,
}, indent=2))`,
				{ limit, include_lights: include_lights ? "True" : "False" },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);
}
