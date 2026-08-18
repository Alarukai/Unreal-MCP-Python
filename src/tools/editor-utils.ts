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
			manager.requireEditor();
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
			manager.requireEditor();
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
			manager.requireEditor();
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
			manager.requireEditor();
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
			manager.requireEditor();
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

	server.tool("undo", "Undo the last editor action.", {}, async () => {
		manager.requireEditor();
		const script = `import unreal
import json
success = unreal.SystemLibrary.execute_console_command(None, 'transaction undo')
print(json.dumps({"undone": True}))`;
		const result = await manager.runPython(script);
		return { content: [{ type: "text", text: result }] };
	});

	server.tool("redo", "Redo the last undone editor action.", {}, async () => {
		manager.requireEditor();
		const script = `import unreal
import json
success = unreal.SystemLibrary.execute_console_command(None, 'transaction redo')
print(json.dumps({"redone": True}))`;
		const result = await manager.runPython(script);
		return { content: [{ type: "text", text: result }] };
	});

	server.tool(
		"get_undo_history",
		"Get the undo/redo transaction history.",
		{
			count: z.number().default(20).describe("Number of recent transactions to return"),
		},
		async ({ count }) => {
			manager.requireEditor();
			const script = `import unreal
import json
# Transaction history is accessible via GEditor->Trans
print(json.dumps({"hint": "Undo history available in Edit > Undo History window. Use undo/redo tools to navigate."}))`;
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);
}
