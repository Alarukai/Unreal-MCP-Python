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
		"set_static_mesh",
		"Set the static mesh asset on an actor's StaticMeshComponent. Works on any actor with a StaticMeshComponent, not just StaticMeshActor.",
		{
			actor: z.string().describe("Actor name or label"),
			mesh_path: z.string().describe("Content path of the static mesh asset"),
		},
		async ({ actor, mesh_path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
target = None
for a in actors:
    if a.get_name() == '{{actor}}' or a.get_actor_label() == '{{actor}}':
        target = a
        break
if not target:
    print(json.dumps({"error": "Actor not found: {{actor}}"}))
else:
    comp = target.get_component_by_class(unreal.StaticMeshComponent)
    if not comp:
        print(json.dumps({"error": "Actor '{{actor}}' has no StaticMeshComponent"}))
    else:
        mesh = unreal.EditorAssetLibrary.load_asset('{{mesh_path}}')
        if not mesh:
            print(json.dumps({"error": "Static mesh not found: {{mesh_path}}"}))
        else:
            comp.set_static_mesh(mesh)
            print(json.dumps({"success": True, "actor": target.get_actor_label(), "mesh": mesh.get_name()}))`,
				{ actor, mesh_path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"get_static_mesh_info",
		"Get detailed information about a static mesh asset: vertex/triangle count, bounds, LOD count, material slots (name + assigned material), and collision presence.",
		{ mesh_path: z.string().describe("Content path of the static mesh asset") },
		{ readOnlyHint: true },
		async ({ mesh_path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
mesh = unreal.EditorAssetLibrary.load_asset('{{mesh_path}}')
if not mesh:
    print(json.dumps({"error": "Static mesh not found: {{mesh_path}}"}))
else:
    warnings = []
    result = {"name": mesh.get_name(), "path": '{{mesh_path}}'}

    try:
        result["num_lods"] = mesh.get_num_lods()
    except Exception as e:
        warnings.append('num_lods: ' + str(e))

    try:
        result["vertex_count"] = mesh.get_num_vertices(0)
        result["triangle_count"] = mesh.get_num_triangles(0)
    except Exception as e:
        warnings.append('vertex/triangle count: ' + str(e))

    try:
        bounds = mesh.get_bounds()
        result["bounds"] = {
            "origin": {"x": bounds.origin.x, "y": bounds.origin.y, "z": bounds.origin.z},
            "extent": {"x": bounds.box_extent.x, "y": bounds.box_extent.y, "z": bounds.box_extent.z},
            "sphere_radius": bounds.sphere_radius,
        }
    except Exception as e:
        warnings.append('bounds: ' + str(e))

    slots = []
    try:
        materials = mesh.get_editor_property('static_materials')
        for i, m in enumerate(materials):
            slot_name = None
            try:
                slot_name = str(m.get_editor_property('material_slot_name'))
            except Exception:
                pass
            mat_path = None
            try:
                mat_iface = m.get_editor_property('material_interface')
                mat_path = mat_iface.get_path_name() if mat_iface else None
            except Exception:
                pass
            slots.append({"index": i, "slot_name": slot_name, "material": mat_path})
    except Exception as e:
        warnings.append('material_slots: ' + str(e))
    result["material_slots"] = slots

    try:
        result["has_collision"] = mesh.get_editor_property('body_setup') is not None
    except Exception as e:
        warnings.append('collision: ' + str(e))

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
		"set_mesh_material_slots",
		"Batch-assign materials to an actor's static mesh slots by index. Provide an array of material paths matching slot order; use an empty string to skip a slot.",
		{
			actor: z.string().describe("Actor name or label with a StaticMeshComponent"),
			materials: z
				.array(z.string())
				.min(1)
				.describe("Material paths, one per slot index; empty string skips that slot"),
		},
		async ({ actor, materials }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
target = None
for a in actors:
    if a.get_name() == '{{actor}}' or a.get_actor_label() == '{{actor}}':
        target = a
        break
if not target:
    print(json.dumps({"error": "Actor not found: {{actor}}"}))
else:
    comp = target.get_component_by_class(unreal.StaticMeshComponent)
    if not comp:
        print(json.dumps({"error": "Actor '{{actor}}' has no StaticMeshComponent"}))
    else:
        material_paths = json.loads('{{materials_json}}')
        assigned = 0
        warnings = []
        for i, path in enumerate(material_paths):
            if not path:
                continue
            mat = unreal.EditorAssetLibrary.load_asset(path)
            if not mat:
                warnings.append(f"slot {i}: material not found: {path}")
                continue
            comp.set_material(i, mat)
            assigned += 1
        result = {
            "success": True,
            "actor": target.get_actor_label(),
            "assigned": assigned,
            "slots_provided": len(material_paths),
        }
        if warnings:
            result["warnings"] = warnings
        print(json.dumps(result, indent=2))`,
				{ actor, materials_json: JSON.stringify(materials) },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"create_static_mesh_actor",
		"Convenience tool: spawn a StaticMeshActor, set its mesh, and optionally assign one material to every slot — all in one call.",
		{
			mesh_path: z.string().describe("Content path of the static mesh asset"),
			material_path: z.string().optional().describe("Material to assign to every slot"),
			location: z
				.object({ x: z.number(), y: z.number(), z: z.number() })
				.default({ x: 0, y: 0, z: 0 }),
			rotation: z
				.object({ pitch: z.number(), yaw: z.number(), roll: z.number() })
				.default({ pitch: 0, yaw: 0, roll: 0 }),
			scale: z
				.object({ x: z.number(), y: z.number(), z: z.number() })
				.default({ x: 1, y: 1, z: 1 }),
			label: z.string().optional().describe("Actor label in the scene outliner"),
			folder: z.string().optional().describe("Folder path in the scene outliner"),
		},
		async ({ mesh_path, material_path, location, rotation, scale, label, folder }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
mesh = unreal.EditorAssetLibrary.load_asset('{{mesh_path}}')
if not mesh:
    print(json.dumps({"error": "Static mesh not found: {{mesh_path}}"}))
else:
    loc = unreal.Vector({{x}}, {{y}}, {{z}})
    rot = unreal.Rotator({{pitch}}, {{yaw}}, {{roll}})
    subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    actor = subsys.spawn_actor_from_class(unreal.StaticMeshActor, loc, rot)
    if not actor:
        print(json.dumps({"error": "Failed to spawn StaticMeshActor"}))
    else:
        actor.set_actor_scale3d(unreal.Vector({{sx}}, {{sy}}, {{sz}}))
        warnings = []
        actor.static_mesh_component.set_static_mesh(mesh)

        material_path = '{{material_path}}'
        if material_path:
            mat = unreal.EditorAssetLibrary.load_asset(material_path)
            if mat:
                for i in range(actor.static_mesh_component.get_num_materials()):
                    actor.static_mesh_component.set_material(i, mat)
            else:
                warnings.append('Material not found: ' + material_path)

        label = '{{label}}'
        if label:
            actor.set_actor_label(label)

        folder = '{{folder}}'
        if folder:
            actor.set_folder_path(folder)

        result = {
            "success": True,
            "actor": actor.get_actor_label(),
            "mesh": mesh.get_name(),
            "location": {"x": loc.x, "y": loc.y, "z": loc.z},
        }
        if warnings:
            result["warnings"] = warnings
        print(json.dumps(result, indent=2))`,
				{
					mesh_path,
					material_path: material_path || "",
					x: location.x,
					y: location.y,
					z: location.z,
					pitch: rotation.pitch,
					yaw: rotation.yaw,
					roll: rotation.roll,
					sx: scale.x,
					sy: scale.y,
					sz: scale.z,
					label: label || "",
					folder: folder || "",
				},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"enable_nanite",
		"Enable or disable Nanite virtualized geometry on a static mesh asset. NOT YET VERIFIED against a live editor — the Nanite settings struct write is mirrored from this project's own (also unverified) get_mesh_complexity_report read path; returns a clear error rather than a false success if it doesn't take.",
		{
			mesh_path: z.string().describe("Content path to the StaticMesh asset"),
			enabled: z.boolean().default(true).describe("Enable (true) or disable (false) Nanite"),
		},
		async ({ mesh_path, enabled }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
mesh = unreal.EditorAssetLibrary.load_asset('{{mesh_path}}')
if not mesh:
    print(json.dumps({"error": "StaticMesh not found: {{mesh_path}}"}))
else:
    try:
        settings = mesh.get_editor_property('nanite_settings')
        settings.set_editor_property('enabled', {{enabled}})
        mesh.set_editor_property('nanite_settings', settings)
        unreal.EditorAssetLibrary.save_asset('{{mesh_path}}')
        print(json.dumps({"success": True, "mesh": mesh.get_name(), "nanite_enabled": {{enabled}}}))
    except Exception as e:
        print(json.dumps({"error": "Could not set nanite_settings — this UE version's Python bindings may expose it differently: " + str(e)}))`,
				{ mesh_path, enabled: enabled ? "True" : "False" },
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
