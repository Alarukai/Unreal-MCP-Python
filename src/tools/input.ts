import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";
import { inlineScript } from "../utils/template.js";

export function registerInputTools(
	server: McpServer,
	manager: ConnectionManager,
	_config: UnrealMcpConfig,
): void {
	server.tool(
		"create_input_action",
		"Create an Enhanced Input InputAction asset.",
		{
			name: z.string().describe("InputAction asset name (e.g. IA_Jump)"),
			path: z.string().default("/Game/Input").describe("Content directory to create in"),
			value_type: z
				.enum(["Digital", "Axis1D", "Axis2D", "Axis3D"])
				.default("Digital")
				.describe("Digital=bool, Axis1D=float, Axis2D=Vector2D, Axis3D=Vector"),
		},
		async ({ name, path, value_type }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
ia = asset_tools.create_asset('{{name}}', '{{path}}', unreal.InputAction, None)
if not ia:
    print(json.dumps({"error": "Failed to create InputAction"}))
else:
    value_type = getattr(unreal.InputActionValueType, '{{value_type}}', None)
    warnings = []
    if value_type is not None:
        try:
            ia.set_editor_property('ValueType', value_type)
        except Exception as e:
            warnings.append('ValueType: ' + str(e))
    else:
        warnings.append('Unknown value_type: {{value_type}}')
    unreal.EditorAssetLibrary.save_asset(ia.get_path_name())
    print(json.dumps({"success": True, "name": ia.get_name(), "path": ia.get_path_name(), "warnings": warnings}))`,
				{ name, path, value_type },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"create_input_mapping_context",
		"Create an Enhanced Input InputMappingContext asset, optionally with initial key mappings.",
		{
			name: z.string().describe("InputMappingContext asset name (e.g. IMC_Default)"),
			path: z.string().default("/Game/Input").describe("Content directory to create in"),
			mappings: z
				.array(
					z.object({
						action_path: z.string().describe("InputAction asset path to bind"),
						key: z.string().describe("Key name, e.g. W, SpaceBar, Gamepad_FaceButton_Bottom"),
					}),
				)
				.default([])
				.describe("Initial key mappings"),
		},
		async ({ name, path, mappings }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
imc = asset_tools.create_asset('{{name}}', '{{path}}', unreal.InputMappingContext, None)
if not imc:
    print(json.dumps({"error": "Failed to create InputMappingContext"}))
else:
    mappings = json.loads('{{mappings_json}}')
    added = []
    warnings = []
    for m in mappings:
        action = unreal.EditorAssetLibrary.load_asset(m['action_path'])
        if not action:
            warnings.append('Action not found: ' + m['action_path'])
            continue
        try:
            imc.map_key(action, unreal.Key(m['key']))
            added.append({"action": m['action_path'], "key": m['key']})
        except Exception as e:
            warnings.append(m['action_path'] + ' -> ' + m['key'] + ': ' + str(e))
    unreal.EditorAssetLibrary.save_asset(imc.get_path_name())
    print(json.dumps({"success": True, "name": imc.get_name(), "path": imc.get_path_name(), "mapped": added, "warnings": warnings}))`,
				{ name, path, mappings_json: JSON.stringify(mappings) },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"find_input_actions",
		"Search a content directory for InputAction and InputMappingContext assets.",
		{
			directory: z.string().default("/Game").describe("Content directory path"),
			recursive: z.boolean().default(true).describe("Include subdirectories"),
		},
		{ readOnlyHint: true },
		async ({ directory, recursive }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
registry = unreal.AssetRegistryHelpers.get_asset_registry()
assets = registry.get_assets_by_path('{{directory}}', {{recursive}}) or []
results = []
for a in assets:
    cls = str(a.asset_class_path.asset_name) if hasattr(a, 'asset_class_path') else str(a.asset_class)
    if cls not in ('InputAction', 'InputMappingContext'):
        continue
    results.append({
        "name": str(a.asset_name),
        "class": cls,
        "path": str(a.package_name) + '.' + str(a.asset_name),
    })
print(json.dumps(results, indent=2))`,
				{ directory, recursive: recursive ? "True" : "False" },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"delete_input_action",
		"Delete an InputAction or InputMappingContext asset.",
		{ path: z.string().describe("Asset path") },
		{ destructiveHint: true },
		async ({ path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
if not unreal.EditorAssetLibrary.does_asset_exist('{{path}}'):
    print(json.dumps({"error": "Asset not found: {{path}}"}))
else:
    success = unreal.EditorAssetLibrary.delete_asset('{{path}}')
    print(json.dumps({"success": success}))`,
				{ path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"edit_mapping_context",
		"Add or remove key mappings on an existing InputMappingContext.",
		{
			path: z.string().describe("InputMappingContext asset path"),
			add: z
				.array(
					z.object({
						action_path: z.string().describe("InputAction asset path to bind"),
						key: z.string().describe("Key name, e.g. W, SpaceBar, Gamepad_FaceButton_Bottom"),
					}),
				)
				.default([])
				.describe("Mappings to add"),
			remove_action_paths: z
				.array(z.string())
				.default([])
				.describe("Remove all mappings for these InputAction asset paths"),
		},
		async ({ path, add, remove_action_paths }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
imc = unreal.EditorAssetLibrary.load_asset('{{path}}')
if not imc or not isinstance(imc, unreal.InputMappingContext):
    print(json.dumps({"error": "InputMappingContext not found: {{path}}"}))
else:
    added = []
    removed = []
    warnings = []
    for action_path in json.loads('{{remove_paths_json}}'):
        action = unreal.EditorAssetLibrary.load_asset(action_path)
        if action:
            try:
                imc.unmap_all_keys_from_action(action)
                removed.append(action_path)
            except Exception as e:
                warnings.append('unmap ' + action_path + ': ' + str(e))
        else:
            warnings.append('Action not found: ' + action_path)
    for m in json.loads('{{add_json}}'):
        action = unreal.EditorAssetLibrary.load_asset(m['action_path'])
        if not action:
            warnings.append('Action not found: ' + m['action_path'])
            continue
        try:
            imc.map_key(action, unreal.Key(m['key']))
            added.append({"action": m['action_path'], "key": m['key']})
        except Exception as e:
            warnings.append(m['action_path'] + ' -> ' + m['key'] + ': ' + str(e))
    unreal.EditorAssetLibrary.save_asset('{{path}}')
    print(json.dumps({"success": True, "added": added, "removed": removed, "warnings": warnings}))`,
				{
					path,
					add_json: JSON.stringify(add),
					remove_paths_json: JSON.stringify(remove_action_paths),
				},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);
}
