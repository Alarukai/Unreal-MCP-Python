import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";
import { inlineScript } from "../utils/template.js";

export function registerAnimationTools(
	server: McpServer,
	manager: ConnectionManager,
	_config: UnrealMcpConfig,
): void {
	server.tool(
		"create_anim_blueprint",
		"Create an Animation Blueprint for a target skeleton.",
		{
			name: z.string().describe("AnimBlueprint name"),
			skeleton_path: z.string().describe("Target skeleton asset path"),
			path: z.string().default("/Game/Animations").describe("Content directory"),
		},
		async ({ name, skeleton_path, path }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
skeleton = unreal.EditorAssetLibrary.load_asset('{{skeleton_path}}')
if skeleton:
    factory = unreal.AnimBlueprintFactory()
    factory.set_editor_property('TargetSkeleton', skeleton)
    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    anim_bp = asset_tools.create_asset('{{name}}', '{{path}}', unreal.AnimBlueprint, factory)
    if anim_bp:
        print(json.dumps({"success": True, "name": anim_bp.get_name(), "path": anim_bp.get_path_name()}))
    else:
        print(json.dumps({"error": "Failed to create AnimBlueprint"}))
else:
    print(json.dumps({"error": "Skeleton not found: {{skeleton_path}}"}))`,
				{ name, skeleton_path, path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"get_anim_sequence_info",
		"Get info about an animation sequence (length, frames, bone data).",
		{
			sequence_path: z.string().describe("AnimSequence asset path"),
		},
		async ({ sequence_path }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
seq = unreal.EditorAssetLibrary.load_asset('{{sequence_path}}')
if seq and isinstance(seq, unreal.AnimSequence):
    result = {
        "name": seq.get_name(),
        "length": seq.sequence_length,
        "num_frames": seq.number_of_frames,
        "rate_scale": seq.rate_scale,
        "skeleton": seq.get_skeleton().get_name() if seq.get_skeleton() else None,
    }
    print(json.dumps(result, indent=2))
else:
    print(json.dumps({"error": "AnimSequence not found: {{sequence_path}}"}))`,
				{ sequence_path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"create_anim_montage",
		"Create an animation montage from an animation sequence.",
		{
			name: z.string().describe("Montage name"),
			sequence_path: z.string().describe("Source AnimSequence asset path"),
			path: z.string().default("/Game/Animations").describe("Content directory"),
		},
		async ({ name, sequence_path, path }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
seq = unreal.EditorAssetLibrary.load_asset('{{sequence_path}}')
if seq:
    factory = unreal.AnimMontageFactory()
    factory.set_editor_property('SourceAnimation', seq)
    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    montage = asset_tools.create_asset('{{name}}', '{{path}}', unreal.AnimMontage, factory)
    if montage:
        print(json.dumps({"success": True, "name": montage.get_name(), "path": montage.get_path_name()}))
    else:
        print(json.dumps({"error": "Failed to create montage"}))
else:
    print(json.dumps({"error": "AnimSequence not found: {{sequence_path}}"}))`,
				{ name, sequence_path, path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"set_skeletal_mesh_lod",
		"Configure LOD settings on a skeletal mesh.",
		{
			mesh_path: z.string().describe("Skeletal mesh asset path"),
			lod_count: z.number().min(1).max(8).describe("Number of LODs to generate"),
		},
		async ({ mesh_path, lod_count }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
mesh = unreal.EditorAssetLibrary.load_asset('{{mesh_path}}')
if mesh and isinstance(mesh, unreal.SkeletalMesh):
    lib = unreal.EditorSkeletalMeshLibrary
    for i in range(1, {{lod_count}}):
        reduction = 0.5 ** i
        lib.regenerate_lod(mesh, i, reduction)
    unreal.EditorAssetLibrary.save_asset('{{mesh_path}}')
    print(json.dumps({"success": True, "lods": {{lod_count}}}))
else:
    print(json.dumps({"error": "SkeletalMesh not found: {{mesh_path}}"}))`,
				{ mesh_path, lod_count },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"reimport_skeletal_mesh",
		"Reimport a skeletal mesh from its source file.",
		{
			mesh_path: z.string().describe("Skeletal mesh asset path"),
		},
		async ({ mesh_path }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
mesh = unreal.EditorAssetLibrary.load_asset('{{mesh_path}}')
if mesh:
    success = unreal.EditorSkeletalMeshLibrary.reimport_all_custom_lo_ds(mesh)
    print(json.dumps({"success": True, "reimported": "{{mesh_path}}"}))
else:
    print(json.dumps({"error": "Mesh not found: {{mesh_path}}"}))`,
				{ mesh_path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"apply_anim_modifier",
		"Apply an animation modifier to an animation sequence.",
		{
			sequence_path: z.string().describe("AnimSequence asset path"),
			modifier_class: z.string().describe("Animation modifier class name"),
		},
		async ({ sequence_path, modifier_class }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
seq = unreal.EditorAssetLibrary.load_asset('{{sequence_path}}')
if seq:
    modifier = getattr(unreal, '{{modifier_class}}', None)
    if modifier:
        mod_instance = modifier()
        unreal.AnimationLibrary.add_animation_modifier(seq, mod_instance)
        unreal.AnimationLibrary.apply_all_animation_modifiers(seq)
        print(json.dumps({"success": True}))
    else:
        print(json.dumps({"error": "Modifier class not found: {{modifier_class}}"}))
else:
    print(json.dumps({"error": "AnimSequence not found"}))`,
				{ sequence_path, modifier_class },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);
}
