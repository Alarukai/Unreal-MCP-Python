import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";
import { inlineScript } from "../utils/template.js";

export function registerControlRigTools(
	server: McpServer,
	manager: ConnectionManager,
	_config: UnrealMcpConfig,
): void {
	server.tool(
		"create_control_rig",
		"Create a new Control Rig Blueprint for a skeleton. Requires the Control Rig plugin enabled. Only creates the asset + sets the preview mesh — graph editing (IK chains, bone constraints, controls) is not included.",
		{
			asset_path: z
				.string()
				.describe("Content path for the new asset, e.g. /Game/Characters/CR_Hero"),
			skeleton_path: z.string().describe("USkeleton asset path"),
		},
		async ({ asset_path, skeleton_path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
skeleton = unreal.EditorAssetLibrary.load_asset('{{skeleton_path}}')
if not skeleton or not isinstance(skeleton, unreal.Skeleton):
    print(json.dumps({"error": "Skeleton not found: {{skeleton_path}}"}))
else:
    control_rig_class = getattr(unreal, 'ControlRigBlueprint', None)
    factory_class = getattr(unreal, 'ControlRigBlueprintFactory', None)
    if not control_rig_class or not factory_class:
        print(json.dumps({"error": "ControlRig classes not found — is the Control Rig plugin enabled?"}))
    else:
        package_path = '{{asset_path}}'.rsplit('/', 1)[0]
        asset_name = '{{asset_path}}'.rsplit('/', 1)[1]
        factory = unreal.new_object(factory_class)
        asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
        rig = asset_tools.create_asset(asset_name, package_path, control_rig_class, factory)
        if not rig:
            print(json.dumps({"error": "Failed to create Control Rig Blueprint"}))
        else:
            warnings = []
            try:
                # unreal.Skeleton exposes no preview-mesh accessor in UE 5.x
                # Python — resolve one by scanning for a SkeletalMesh that
                # references this skeleton.
                skel_path = skeleton.get_path_name()
                registry = unreal.AssetRegistryHelpers.get_asset_registry()
                skm_datas = registry.get_assets_by_class(
                    unreal.TopLevelAssetPath('/Script/Engine', 'SkeletalMesh'), True
                )
                preview_mesh = None
                for skm_data in skm_datas:
                    skm = unreal.EditorAssetLibrary.load_asset(str(skm_data.package_name))
                    skm_skel = skm.get_editor_property('skeleton') if skm else None
                    if skm_skel and skm_skel.get_path_name() == skel_path:
                        preview_mesh = skm
                        break
                if preview_mesh:
                    rig.set_preview_mesh(preview_mesh, True)
                else:
                    warnings.append('No SkeletalMesh references this skeleton; preview mesh not set')
            except Exception as e:
                warnings.append('set_preview_mesh: ' + str(e))
            unreal.EditorAssetLibrary.save_asset(rig.get_path_name())
            print(json.dumps({"success": True, "name": rig.get_name(), "path": rig.get_path_name(), "warnings": warnings}))`,
				{ asset_path, skeleton_path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"get_control_rig_info",
		"Get info about a Control Rig Blueprint: preview mesh, class.",
		{ asset_path: z.string().describe("Control Rig Blueprint asset path") },
		{ readOnlyHint: true },
		async ({ asset_path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
rig = unreal.EditorAssetLibrary.load_asset('{{asset_path}}')
if not rig:
    print(json.dumps({"error": "Control Rig not found: {{asset_path}}"}))
else:
    result = {"success": True, "name": rig.get_name(), "path": rig.get_path_name(), "class": rig.get_class().get_name()}
    try:
        mesh = rig.get_preview_mesh()
        if mesh:
            result["preview_mesh"] = mesh.get_name()
            result["preview_mesh_path"] = mesh.get_path_name()
        else:
            result["preview_mesh"] = None
    except Exception as e:
        result["preview_mesh_error"] = str(e)
    print(json.dumps(result, indent=2))`,
				{ asset_path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);
}
