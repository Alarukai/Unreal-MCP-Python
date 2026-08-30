import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";
import { inlineScript } from "../utils/template.js";

function createTypedBlueprintScript(): string {
	return `import unreal
import json
name = '{{name}}'
if not name.startswith('{{prefix}}'):
    name = '{{prefix}}' + name
parent = getattr(unreal, '{{native_class}}', None)
if parent is None:
    parent = unreal.EditorAssetLibrary.load_asset('/Script/{{plugin_module}}.{{native_class}}')
if not parent:
    print(json.dumps({"error": "Class not found: {{native_class}} (is the {{plugin_module}} plugin enabled?)"}))
else:
    full_path = '{{path}}' + '/' + name
    existing = unreal.EditorAssetLibrary.load_asset(full_path)
    if existing:
        print(json.dumps({"success": True, "name": name, "path": existing.get_path_name(), "existed": True}))
    else:
        factory = unreal.BlueprintFactory()
        factory.set_editor_property('ParentClass', parent)
        asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
        bp = asset_tools.create_asset(name, '{{path}}', unreal.Blueprint, factory)
        if bp:
            print(json.dumps({"success": True, "name": bp.get_name(), "path": bp.get_path_name(), "parent_class": "{{native_class}}"}))
        else:
            print(json.dumps({"error": "Failed to create Blueprint"}))`;
}

function listByNativeParentScript(): string {
	return `import unreal
import json
registry = unreal.AssetRegistryHelpers.get_asset_registry()
assets = registry.get_assets_by_path('/Game', True) or []
results = []
for a in assets:
    cls = str(a.asset_class_path.asset_name) if hasattr(a, 'asset_class_path') else str(a.asset_class)
    if cls != 'Blueprint':
        continue
    native_parent = ''
    try:
        native_parent = str(a.get_tag_value('NativeParentClass') or '')
    except Exception:
        pass
    if '{{native_class}}' not in native_parent:
        continue
    results.append({
        "name": str(a.asset_name),
        "path": str(a.package_name) + '.' + str(a.asset_name),
        "native_parent": native_parent,
    })
print(json.dumps({"success": True, "assets": results, "count": len(results)}, indent=2))`;
}

export function registerGameplayTools(
	server: McpServer,
	manager: ConnectionManager,
	_config: UnrealMcpConfig,
): void {
	server.tool(
		"create_gameplay_ability",
		"Create a GameplayAbility Blueprint (Gameplay Ability System). Requires the GameplayAbilities plugin enabled.",
		{
			name: z.string().describe("Ability name (GA_ prefix added if missing)"),
			path: z.string().default("/Game/GAS").describe("Content directory to create in"),
		},
		async ({ name, path }) => {
			await manager.requireEditor();
			const script = inlineScript(createTypedBlueprintScript(), {
				name,
				path,
				prefix: "GA_",
				native_class: "GameplayAbility",
				plugin_module: "GameplayAbilities",
			});
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"create_gameplay_effect",
		"Create a GameplayEffect Blueprint (Gameplay Ability System). Requires the GameplayAbilities plugin enabled.",
		{
			name: z.string().describe("Effect name (GE_ prefix added if missing)"),
			path: z.string().default("/Game/GAS").describe("Content directory to create in"),
		},
		async ({ name, path }) => {
			await manager.requireEditor();
			const script = inlineScript(createTypedBlueprintScript(), {
				name,
				path,
				prefix: "GE_",
				native_class: "GameplayEffect",
				plugin_module: "GameplayAbilities",
			});
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"create_attribute_set",
		"Create an AttributeSet Blueprint (Gameplay Ability System). Requires the GameplayAbilities plugin enabled.",
		{
			name: z.string().describe("AttributeSet name (AS_ prefix added if missing)"),
			path: z.string().default("/Game/GAS").describe("Content directory to create in"),
		},
		async ({ name, path }) => {
			await manager.requireEditor();
			const script = inlineScript(createTypedBlueprintScript(), {
				name,
				path,
				prefix: "AS_",
				native_class: "AttributeSet",
				plugin_module: "GameplayAbilities",
			});
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"list_gameplay_abilities",
		"List GameplayAbility Blueprints in the project (by NativeParentClass asset-registry tag, without force-loading assets).",
		{},
		{ readOnlyHint: true },
		async () => {
			await manager.requireEditor();
			const script = inlineScript(listByNativeParentScript(), { native_class: "GameplayAbility" });
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"list_gameplay_effects",
		"List GameplayEffect Blueprints in the project (by NativeParentClass asset-registry tag, without force-loading assets).",
		{},
		{ readOnlyHint: true },
		async () => {
			await manager.requireEditor();
			const script = inlineScript(listByNativeParentScript(), { native_class: "GameplayEffect" });
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"list_attribute_sets",
		"List AttributeSet Blueprints in the project (by NativeParentClass asset-registry tag, without force-loading assets).",
		{},
		{ readOnlyHint: true },
		async () => {
			await manager.requireEditor();
			const script = inlineScript(listByNativeParentScript(), { native_class: "AttributeSet" });
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"get_gas_info",
		"Check whether the Gameplay Ability System (GameplayAbilities plugin) is available in this project.",
		{},
		{ readOnlyHint: true },
		async () => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
ability_class = getattr(unreal, 'GameplayAbility', None)
effect_class = getattr(unreal, 'GameplayEffect', None)
attribute_class = getattr(unreal, 'AttributeSet', None)
print(json.dumps({
    "success": True,
    "gameplay_abilities_plugin_available": ability_class is not None and effect_class is not None,
    "gameplay_ability_class_found": ability_class is not None,
    "gameplay_effect_class_found": effect_class is not None,
    "attribute_set_class_found": attribute_class is not None,
}))`,
				{},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"create_game_mode",
		"Create a GameModeBase Blueprint.",
		{
			name: z.string().describe("GameMode name (GM_ prefix added if missing)"),
			path: z.string().default("/Game/GameFramework").describe("Content directory to create in"),
		},
		async ({ name, path }) => {
			await manager.requireEditor();
			const script = inlineScript(createTypedBlueprintScript(), {
				name,
				path,
				prefix: "GM_",
				native_class: "GameModeBase",
				plugin_module: "Engine",
			});
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"create_player_controller",
		"Create a PlayerController Blueprint.",
		{
			name: z.string().describe("PlayerController name (PC_ prefix added if missing)"),
			path: z.string().default("/Game/GameFramework").describe("Content directory to create in"),
		},
		async ({ name, path }) => {
			await manager.requireEditor();
			const script = inlineScript(createTypedBlueprintScript(), {
				name,
				path,
				prefix: "PC_",
				native_class: "PlayerController",
				plugin_module: "Engine",
			});
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"create_game_state",
		"Create a GameStateBase Blueprint.",
		{
			name: z.string().describe("GameState name (GS_ prefix added if missing)"),
			path: z.string().default("/Game/GameFramework").describe("Content directory to create in"),
		},
		async ({ name, path }) => {
			await manager.requireEditor();
			const script = inlineScript(createTypedBlueprintScript(), {
				name,
				path,
				prefix: "GS_",
				native_class: "GameStateBase",
				plugin_module: "Engine",
			});
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"create_player_state",
		"Create a PlayerState Blueprint.",
		{
			name: z.string().describe("PlayerState name (PS_ prefix added if missing)"),
			path: z.string().default("/Game/GameFramework").describe("Content directory to create in"),
		},
		async ({ name, path }) => {
			await manager.requireEditor();
			const script = inlineScript(createTypedBlueprintScript(), {
				name,
				path,
				prefix: "PS_",
				native_class: "PlayerState",
				plugin_module: "Engine",
			});
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"create_hud",
		"Create a HUD Blueprint.",
		{
			name: z.string().describe("HUD name (HUD_ prefix added if missing)"),
			path: z.string().default("/Game/GameFramework").describe("Content directory to create in"),
		},
		async ({ name, path }) => {
			await manager.requireEditor();
			const script = inlineScript(createTypedBlueprintScript(), {
				name,
				path,
				prefix: "HUD_",
				native_class: "HUD",
				plugin_module: "Engine",
			});
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"get_game_framework_info",
		"Read the current level's game-framework class assignments (GameMode, PlayerController, GameState, PlayerState, HUD) from World Settings.",
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
    world_settings = world.get_world_settings()
    result = {"success": True}

    game_mode_class = None
    try:
        game_mode_class = world_settings.get_editor_property('DefaultGameMode')
    except Exception:
        pass
    result["default_game_mode"] = game_mode_class.get_name() if game_mode_class else None

    if game_mode_class:
        cdo = unreal.get_default_object(game_mode_class)
        for field, prop in (
            ("default_pawn_class", "DefaultPawnClass"),
            ("player_controller_class", "PlayerControllerClass"),
            ("game_state_class", "GameStateClass"),
            ("player_state_class", "PlayerStateClass"),
            ("hud_class", "HUDClass"),
        ):
            try:
                cls = cdo.get_editor_property(prop)
                result[field] = cls.get_name() if cls else None
            except Exception:
                result[field] = None

    print(json.dumps(result, indent=2))`,
				{},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"get_project_settings",
		"Get the project-wide default GameMode (Project Settings > Maps & Modes > Default GameMode) — the fallback used by any level that doesn't set its own World Settings GameMode.",
		{},
		{ readOnlyHint: true },
		async () => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
print(json.dumps({"success": True, "global_default_game_mode": unreal.GameMapsSettings.get_global_default_game_mode()}))`,
				{},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"set_project_settings",
		"Set the project-wide default GameMode (Project Settings > Maps & Modes > Default GameMode).",
		{ global_default_game_mode: z.string().describe("GameMode class or Blueprint path") },
		async ({ global_default_game_mode }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
unreal.GameMapsSettings.set_global_default_game_mode('{{global_default_game_mode}}')
print(json.dumps({"success": True, "global_default_game_mode": unreal.GameMapsSettings.get_global_default_game_mode()}))`,
				{ global_default_game_mode },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);
}
