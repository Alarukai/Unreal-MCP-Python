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
			await manager.requireEditor();
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
			await manager.requireEditor();
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
			await manager.requireEditor();
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
			await manager.requireEditor();
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
			await manager.requireEditor();
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
			await manager.requireEditor();
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

	server.tool(
		"read_montage",
		"Read an animation montage's sections, slot tracks, and notifies (best-effort — AnimMontage's Python-exposed reflection surface is version-sensitive; fields that fail to read come back null rather than failing the whole call).",
		{ montage_path: z.string().describe("AnimMontage asset path") },
		{ readOnlyHint: true },
		async ({ montage_path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
montage = unreal.EditorAssetLibrary.load_asset('{{montage_path}}')
if not montage or not isinstance(montage, unreal.AnimMontage):
    print(json.dumps({"error": "AnimMontage not found: {{montage_path}}"}))
else:
    sections = []
    try:
        for s in montage.get_editor_property('CompositeSections'):
            entry = {}
            try:
                entry["name"] = str(s.get_editor_property('SectionName'))
            except Exception:
                entry["name"] = None
            try:
                entry["next_section"] = str(s.get_editor_property('NextSectionName'))
            except Exception:
                entry["next_section"] = None
            sections.append(entry)
    except Exception as e:
        sections = None
    slots = []
    try:
        for track in montage.get_editor_property('SlotAnimTracks'):
            slot_entry = {"slot_name": None, "segments": []}
            try:
                slot_entry["slot_name"] = str(track.get_editor_property('SlotName'))
            except Exception:
                pass
            try:
                anim_track = track.get_editor_property('AnimTrack')
                for seg in anim_track.get_editor_property('AnimSegments'):
                    seg_entry = {}
                    try:
                        seg_entry["start_pos"] = seg.get_editor_property('StartPos')
                        seg_entry["end_pos"] = seg.get_editor_property('EndPos')
                    except Exception:
                        pass
                    slot_entry["segments"].append(seg_entry)
            except Exception:
                pass
            slots.append(slot_entry)
    except Exception:
        slots = None
    notifies = []
    try:
        for n in montage.get_editor_property('Notifies'):
            n_entry = {}
            try:
                n_entry["name"] = str(n.get_editor_property('NotifyName'))
            except Exception:
                n_entry["name"] = None
            try:
                n_entry["trigger_time_offset"] = n.get_editor_property('TriggerTimeOffset')
            except Exception:
                n_entry["trigger_time_offset"] = None
            notifies.append(n_entry)
    except Exception:
        notifies = None
    print(json.dumps({
        "success": True,
        "name": montage.get_name(),
        "sections": sections,
        "slots": slots,
        "notifies": notifies,
    }, indent=2))`,
				{ montage_path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"add_montage_section",
		"Add a named composite section to an animation montage. Best-effort against a version-sensitive struct API — verify the result in the Montage editor.",
		{
			montage_path: z.string().describe("AnimMontage asset path"),
			section_name: z.string().describe("New section name"),
		},
		async ({ montage_path, section_name }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
montage = unreal.EditorAssetLibrary.load_asset('{{montage_path}}')
if not montage or not isinstance(montage, unreal.AnimMontage):
    print(json.dumps({"error": "AnimMontage not found: {{montage_path}}"}))
else:
    try:
        sections = list(montage.get_editor_property('CompositeSections'))
        new_section = unreal.CompositeSection()
        new_section.set_editor_property('SectionName', '{{section_name}}')
        sections.append(new_section)
        montage.set_editor_property('CompositeSections', sections)
        unreal.EditorAssetLibrary.save_asset('{{montage_path}}')
        print(json.dumps({"success": True, "section": "{{section_name}}", "total_sections": len(sections)}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))`,
				{ montage_path, section_name },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"link_montage_sections",
		"Set which section plays next after a given montage section (controls playback order / looping). Sets CompositeSections[section_name].NextSectionName.",
		{
			montage_path: z.string().describe("AnimMontage asset path"),
			section_name: z.string().describe("Section to modify"),
			next_section_name: z.string().describe("Section that should play after section_name"),
		},
		async ({ montage_path, section_name, next_section_name }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
montage = unreal.EditorAssetLibrary.load_asset('{{montage_path}}')
if not montage or not isinstance(montage, unreal.AnimMontage):
    print(json.dumps({"error": "AnimMontage not found: {{montage_path}}"}))
else:
    try:
        sections = list(montage.get_editor_property('CompositeSections'))
        found = False
        for s in sections:
            if str(s.get_editor_property('SectionName')) == '{{section_name}}':
                s.set_editor_property('NextSectionName', '{{next_section_name}}')
                found = True
                break
        if not found:
            print(json.dumps({"error": "Section not found: {{section_name}}", "available": [str(s.get_editor_property('SectionName')) for s in sections]}))
        else:
            montage.set_editor_property('CompositeSections', sections)
            unreal.EditorAssetLibrary.save_asset('{{montage_path}}')
            print(json.dumps({"success": True, "section": "{{section_name}}", "next_section": "{{next_section_name}}"}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))`,
				{ montage_path, section_name, next_section_name },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"add_montage_notify",
		"Add a simple named notify marker to an animation montage. Best-effort against a version-sensitive struct API (FAnimNotifyEvent) — verify placement in the Montage editor afterward.",
		{
			montage_path: z.string().describe("AnimMontage asset path"),
			notify_name: z.string().describe("Notify name/label"),
		},
		async ({ montage_path, notify_name }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
montage = unreal.EditorAssetLibrary.load_asset('{{montage_path}}')
if not montage or not isinstance(montage, unreal.AnimMontage):
    print(json.dumps({"error": "AnimMontage not found: {{montage_path}}"}))
else:
    try:
        notifies = list(montage.get_editor_property('Notifies'))
        new_notify = unreal.AnimNotifyEvent()
        warnings = []
        try:
            new_notify.set_editor_property('NotifyName', '{{notify_name}}')
        except Exception as e:
            warnings.append('NotifyName: ' + str(e))
        notifies.append(new_notify)
        montage.set_editor_property('Notifies', notifies)
        unreal.EditorAssetLibrary.save_asset('{{montage_path}}')
        print(json.dumps({"success": True, "notify": "{{notify_name}}", "total_notifies": len(notifies), "warnings": warnings}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))`,
				{ montage_path, notify_name },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"read_anim_blueprint",
		"Read an Animation Blueprint's target skeleton, parent class, and graph list.",
		{ blueprint_path: z.string().describe("AnimBlueprint asset path") },
		{ readOnlyHint: true },
		async ({ blueprint_path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
bp = unreal.EditorAssetLibrary.load_asset('{{blueprint_path}}')
if not bp or not isinstance(bp, unreal.AnimBlueprint):
    print(json.dumps({"error": "AnimBlueprint not found: {{blueprint_path}}"}))
else:
    result = {"name": bp.get_name(), "path": bp.get_path_name()}
    try:
        skeleton = bp.get_editor_property('TargetSkeleton')
        result["target_skeleton"] = skeleton.get_name() if skeleton else None
    except Exception:
        result["target_skeleton"] = None
    try:
        parent = bp.get_editor_property('ParentClass')
        result["parent_class"] = parent.get_name() if parent else None
    except Exception:
        result["parent_class"] = None
    graphs = []
    for prop_name in ('UbergraphPages', 'FunctionGraphs', 'MacroGraphs'):
        try:
            for g in bp.get_editor_property(prop_name):
                graphs.append({"name": g.get_name(), "kind": prop_name})
        except Exception:
            pass
    result["graphs"] = graphs
    print(json.dumps(result, indent=2))`,
				{ blueprint_path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);
}
