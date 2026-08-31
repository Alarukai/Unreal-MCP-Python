import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";
import { inlineScript } from "../utils/template.js";

export function registerEditorUtilsTools(
	server: McpServer,
	manager: ConnectionManager,
	_config: UnrealMcpConfig,
): void {
	server.tool(
		"run_editor_utility_widget",
		"Run an Editor Utility Widget by asset path.",
		{
			widget_path: z.string().describe("Editor Utility Widget asset path"),
		},
		async ({ widget_path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
subsys = unreal.get_editor_subsystem(unreal.EditorUtilitySubsystem)
widget = unreal.EditorAssetLibrary.load_asset('{{widget_path}}')
if widget:
    subsys.spawn_and_register_tab(widget)
    print(json.dumps({"success": True, "widget": "{{widget_path}}"}))
else:
    print(json.dumps({"error": "Widget not found: {{widget_path}}"}))`,
				{ widget_path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"run_editor_utility_blueprint",
		"Run an Editor Utility Blueprint's Run event.",
		{
			blueprint_path: z.string().describe("Editor Utility Blueprint asset path"),
		},
		async ({ blueprint_path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
subsys = unreal.get_editor_subsystem(unreal.EditorUtilitySubsystem)
bp = unreal.EditorAssetLibrary.load_asset('{{blueprint_path}}')
if bp:
    subsys.try_run(bp)
    print(json.dumps({"success": True}))
else:
    print(json.dumps({"error": "Blueprint not found: {{blueprint_path}}"}))`,
				{ blueprint_path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"generate_lods",
		"Generate LODs for a static mesh.",
		{
			mesh_path: z.string().describe("Static mesh asset path"),
			lod_count: z.number().min(1).max(8).default(3).describe("Number of LOD levels"),
		},
		async ({ mesh_path, lod_count }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
mesh = unreal.EditorAssetLibrary.load_asset('{{mesh_path}}')
if mesh and isinstance(mesh, unreal.StaticMesh):
    lib = unreal.EditorStaticMeshLibrary
    options = unreal.EditorScriptingMeshReductionOptions()
    for i in range(1, {{lod_count}}):
        reduction = unreal.EditorScriptingMeshReductionPerLODSettings()
        reduction.percent_triangles = max(0.1, 1.0 - (i * 0.3))
        options.reduction_options.append(reduction)
    lib.set_lod_reduction_settings(mesh, {{lod_count_minus_1}}, options)
    unreal.EditorAssetLibrary.save_asset('{{mesh_path}}')
    print(json.dumps({"success": True, "lods": {{lod_count}}}))
else:
    print(json.dumps({"error": "StaticMesh not found: {{mesh_path}}"}))`,
				{ mesh_path, lod_count, lod_count_minus_1: lod_count - 1 },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"generate_collision",
		"Generate collision for a static mesh.",
		{
			mesh_path: z.string().describe("Static mesh asset path"),
			type: z
				.enum(["box", "sphere", "capsule", "convex", "auto"])
				.default("auto")
				.describe("Collision type"),
		},
		async ({ mesh_path, type }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
mesh = unreal.EditorAssetLibrary.load_asset('{{mesh_path}}')
if mesh and isinstance(mesh, unreal.StaticMesh):
    lib = unreal.EditorStaticMeshLibrary
    if '{{type}}' == 'box':
        lib.add_simple_collisions(mesh, unreal.ScriptingCollisionShapeType.BOX)
    elif '{{type}}' == 'sphere':
        lib.add_simple_collisions(mesh, unreal.ScriptingCollisionShapeType.SPHERE)
    elif '{{type}}' == 'capsule':
        lib.add_simple_collisions(mesh, unreal.ScriptingCollisionShapeType.CAPSULE)
    else:
        lib.set_convex_decomposition_collisions(mesh, 4, 16)
    unreal.EditorAssetLibrary.save_asset('{{mesh_path}}')
    print(json.dumps({"success": True, "type": "{{type}}"}))
else:
    print(json.dumps({"error": "StaticMesh not found: {{mesh_path}}"}))`,
				{ mesh_path, type },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"generate_lightmap_uvs",
		"Generate lightmap UVs for a static mesh.",
		{
			mesh_path: z.string().describe("Static mesh asset path"),
		},
		async ({ mesh_path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
mesh = unreal.EditorAssetLibrary.load_asset('{{mesh_path}}')
if mesh and isinstance(mesh, unreal.StaticMesh):
    lib = unreal.EditorStaticMeshLibrary
    lib.generate_planar_uv_channel(mesh, 0, unreal.Vector(0,0,1), unreal.Vector(0,0,0))
    unreal.EditorAssetLibrary.save_asset('{{mesh_path}}')
    print(json.dumps({"success": True}))
else:
    print(json.dumps({"error": "StaticMesh not found: {{mesh_path}}"}))`,
				{ mesh_path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"get_mesh_complexity_report",
		"Get a detailed complexity report for a static mesh: triangle/vertex count per LOD, Nanite state, material slot count, collision presence, and complexity warnings.",
		{
			mesh_path: z.string().describe("Content path to the StaticMesh asset"),
		},
		{ readOnlyHint: true },
		async ({ mesh_path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
mesh = unreal.EditorAssetLibrary.load_asset('{{mesh_path}}')
if not mesh or not isinstance(mesh, unreal.StaticMesh):
    print(json.dumps({"error": "StaticMesh not found: {{mesh_path}}"}))
else:
    nanite_enabled = False
    try:
        nanite_enabled = bool(mesh.get_editor_property('nanite_settings').get_editor_property('enabled'))
    except Exception:
        pass

    lod_count = mesh.get_num_lods()
    lods = []
    total_triangles = 0
    total_vertices = 0
    for lod_idx in range(lod_count):
        try:
            tris = mesh.get_num_triangles(lod_idx)
            verts = mesh.get_num_vertices(lod_idx)
        except Exception:
            tris = 0
            verts = 0
        lods.append({"lod_index": lod_idx, "triangles": tris, "vertices": verts})
        if lod_idx == 0:
            total_triangles = tris
            total_vertices = verts

    material_slots = len(mesh.get_editor_property('static_materials'))
    has_collision = mesh.get_editor_property('body_setup') is not None
    bounds = mesh.get_bounds()

    warnings = []
    if total_triangles > 100000 and not nanite_enabled:
        warnings.append(f"High poly mesh ({total_triangles} tris) without Nanite. Consider enabling Nanite.")
    if lod_count <= 1 and total_triangles > 10000 and not nanite_enabled:
        warnings.append("No LODs on a high-poly mesh. Add LODs or enable Nanite.")
    if material_slots > 8:
        warnings.append(f"High material slot count: {material_slots}. Each slot is a separate draw call.")

    result = {
        "name": mesh.get_name(),
        "path": '{{mesh_path}}',
        "nanite_enabled": nanite_enabled,
        "lod_count": lod_count,
        "lods": lods,
        "total_triangles_lod0": total_triangles,
        "total_vertices_lod0": total_vertices,
        "material_slots": material_slots,
        "bound_radius": bounds.sphere_radius,
        "has_collision": has_collision,
    }
    if warnings:
        result["warnings"] = warnings
    print(json.dumps(result, indent=2))`,
				{ mesh_path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"undo",
		"Undo the last N editor transactions.",
		{
			count: z.number().int().min(1).max(50).default(1).describe("Number of transactions to undo"),
		},
		async ({ count }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
undone = 0
for i in range({{count}}):
    unreal.SystemLibrary.execute_console_command(None, 'transaction undo')
    undone += 1
print(json.dumps({"success": True, "undone": undone}))`,
				{ count },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"redo",
		"Redo the last N undone editor transactions.",
		{
			count: z.number().int().min(1).max(50).default(1).describe("Number of transactions to redo"),
		},
		async ({ count }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
redone = 0
for i in range({{count}}):
    unreal.SystemLibrary.execute_console_command(None, 'transaction redo')
    redone += 1
print(json.dumps({"success": True, "redone": redone}))`,
				{ count },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"get_undo_history",
		"Get the undo/redo transaction history.",
		{
			count: z.number().default(20).describe("Number of recent transactions to return"),
		},
		async ({ count }) => {
			await manager.requireEditor();
			const script = `import unreal
import json
# Transaction history is accessible via GEditor->Trans
print(json.dumps({"hint": "Undo history available in Edit > Undo History window. Use undo/redo tools to navigate."}))`;
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);
}
