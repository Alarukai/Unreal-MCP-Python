import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";
import { inlineScript } from "../utils/template.js";

const BLACKBOARD_KEY_TYPES = [
	"Bool",
	"Int",
	"Float",
	"String",
	"Name",
	"Vector",
	"Rotator",
	"Object",
	"Class",
	"Enum",
] as const;

export function registerAiTools(
	server: McpServer,
	manager: ConnectionManager,
	_config: UnrealMcpConfig,
): void {
	server.tool(
		"create_behavior_tree",
		"Create a new BehaviorTree asset, optionally linked to a Blackboard asset. Node-graph wiring (Composite/Task/Decorator/Service) is not included — the BehaviorTreeEditor module is internal, so full graph editing needs the editor UI or execute_python.",
		{
			name: z.string().describe("BehaviorTree asset name"),
			path: z.string().default("/Game/AI").describe("Content directory to create in"),
			blackboard_path: z.string().optional().describe("Blackboard asset path to link"),
		},
		async ({ name, path, blackboard_path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
bt = asset_tools.create_asset('{{name}}', '{{path}}', unreal.BehaviorTree, None)
if not bt:
    print(json.dumps({"error": "Failed to create BehaviorTree"}))
else:
    warnings = []
    bb_path = '{{blackboard_path}}'
    bb_name = None
    if bb_path:
        bb = unreal.EditorAssetLibrary.load_asset(bb_path)
        if bb and isinstance(bb, unreal.BlackboardData):
            try:
                bt.set_editor_property('BlackboardAsset', bb)
                bb_name = bb.get_name()
            except Exception as e:
                warnings.append('BlackboardAsset: ' + str(e))
        else:
            warnings.append('Blackboard not found: ' + bb_path)
    unreal.EditorAssetLibrary.save_asset(bt.get_path_name())
    print(json.dumps({"success": True, "name": bt.get_name(), "path": bt.get_path_name(), "blackboard": bb_name, "warnings": warnings}))`,
				{ name, path, blackboard_path: blackboard_path || "" },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"read_behavior_tree",
		"Read a BehaviorTree's metadata and, best-effort, its node tree structure. The node-graph reflection surface is version-sensitive; if the walk fails, metadata is still returned.",
		{ path: z.string().describe("BehaviorTree asset path") },
		{ readOnlyHint: true },
		async ({ path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
bt = unreal.EditorAssetLibrary.load_asset('{{path}}')
if not bt or not isinstance(bt, unreal.BehaviorTree):
    print(json.dumps({"error": "BehaviorTree not found: {{path}}"}))
else:
    bb = None
    try:
        bb_asset = bt.get_editor_property('BlackboardAsset')
        bb = bb_asset.get_path_name() if bb_asset else None
    except Exception:
        pass
    result = {"success": True, "name": bt.get_name(), "path": bt.get_path_name(), "blackboard": bb}
    try:
        def describe(node):
            if node is None:
                return None
            entry = {"name": node.get_name(), "class": node.get_class().get_name()}
            try:
                children = node.get_editor_property('Children')
                out = []
                for c in children:
                    child_task = c.get_editor_property('ChildTask')
                    child_composite = c.get_editor_property('ChildComposite')
                    if child_task:
                        out.append({"name": child_task.get_name(), "class": child_task.get_class().get_name(), "type": "Task"})
                    elif child_composite:
                        sub = describe(child_composite)
                        if sub:
                            sub["type"] = "Composite"
                            out.append(sub)
                entry["children"] = out
            except Exception as e:
                entry["children_error"] = str(e)
            return entry
        root = bt.get_editor_property('RootNode')
        result["root"] = describe(root)
    except Exception as e:
        result["tree_read_error"] = str(e)
    print(json.dumps(result, indent=2))`,
				{ path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"create_blackboard",
		"Create a new BlackboardData asset with an initial set of keys.",
		{
			name: z.string().describe("Blackboard asset name"),
			path: z.string().default("/Game/AI").describe("Content directory to create in"),
			keys: z
				.array(
					z.object({
						name: z.string().describe("Key name"),
						type: z.enum(BLACKBOARD_KEY_TYPES).describe("Blackboard key type"),
					}),
				)
				.default([])
				.describe("Initial blackboard keys"),
		},
		async ({ name, path, keys }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
bb = asset_tools.create_asset('{{name}}', '{{path}}', unreal.BlackboardData, None)
if not bb:
    print(json.dumps({"error": "Failed to create BlackboardData"}))
else:
    added = []
    warnings = []
    entries = list(bb.get_editor_property('Keys'))
    for k in json.loads('{{keys_json}}'):
        key_type_class = getattr(unreal, 'BlackboardKeyType_' + k['type'], None)
        if key_type_class is None:
            warnings.append('Unknown key type: ' + k['type'])
            continue
        try:
            entry = unreal.BlackboardEntry()
            entry.set_editor_property('EntryName', k['name'])
            entry.set_editor_property('KeyType', unreal.new_object(key_type_class, outer=bb))
            entries.append(entry)
            added.append(k['name'])
        except Exception as e:
            warnings.append(k['name'] + ': ' + str(e))
    bb.set_editor_property('Keys', entries)
    unreal.EditorAssetLibrary.save_asset(bb.get_path_name())
    print(json.dumps({"success": True, "name": bb.get_name(), "path": bb.get_path_name(), "added_keys": added, "warnings": warnings}))`,
				{ name, path, keys_json: JSON.stringify(keys) },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"edit_blackboard",
		"Add and/or remove keys on an existing BlackboardData asset.",
		{
			path: z.string().describe("Blackboard asset path"),
			add: z
				.array(
					z.object({
						name: z.string().describe("Key name"),
						type: z.enum(BLACKBOARD_KEY_TYPES).describe("Blackboard key type"),
					}),
				)
				.default([])
				.describe("Keys to add"),
			remove: z.array(z.string()).default([]).describe("Key names to remove"),
		},
		async ({ path, add, remove }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
bb = unreal.EditorAssetLibrary.load_asset('{{path}}')
if not bb or not isinstance(bb, unreal.BlackboardData):
    print(json.dumps({"error": "Blackboard not found: {{path}}"}))
else:
    entries = list(bb.get_editor_property('Keys'))
    remove_names = json.loads('{{remove_json}}')
    removed = 0
    if remove_names:
        before = len(entries)
        entries = [e for e in entries if str(e.get_editor_property('EntryName')) not in remove_names]
        removed = before - len(entries)
    added = []
    warnings = []
    for k in json.loads('{{add_json}}'):
        key_type_class = getattr(unreal, 'BlackboardKeyType_' + k['type'], None)
        if key_type_class is None:
            warnings.append('Unknown key type: ' + k['type'])
            continue
        try:
            entry = unreal.BlackboardEntry()
            entry.set_editor_property('EntryName', k['name'])
            entry.set_editor_property('KeyType', unreal.new_object(key_type_class, outer=bb))
            entries.append(entry)
            added.append(k['name'])
        except Exception as e:
            warnings.append(k['name'] + ': ' + str(e))
    bb.set_editor_property('Keys', entries)
    unreal.EditorAssetLibrary.save_asset('{{path}}')
    print(json.dumps({"success": True, "added": added, "removed": removed, "total_keys": len(entries), "warnings": warnings}))`,
				{ path, add_json: JSON.stringify(add), remove_json: JSON.stringify(remove) },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"create_state_tree",
		"Create a new StateTree asset. The schema (which context class the tree runs against) is left unset — pick one in the editor, or set it later.",
		{
			name: z.string().describe("StateTree asset name"),
			path: z.string().default("/Game/AI").describe("Content directory to create in"),
		},
		async ({ name, path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
factory = unreal.StateTreeFactory()
st = asset_tools.create_asset('{{name}}', '{{path}}', unreal.StateTree, factory)
if not st:
    print(json.dumps({"error": "Failed to create StateTree"}))
else:
    warnings = []
    try:
        editor_data = st.get_editor_property('EditorData')
        if not editor_data:
            editor_data = unreal.new_object(unreal.StateTreeEditorData, outer=st)
            st.set_editor_property('EditorData', editor_data)
    except Exception as e:
        warnings.append('EditorData: ' + str(e))
    unreal.EditorAssetLibrary.save_asset(st.get_path_name())
    print(json.dumps({"success": True, "name": st.get_name(), "path": st.get_path_name(), "warnings": warnings}))`,
				{ name, path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"read_state_tree",
		"Read a StateTree's top-level states and their child hierarchy (names, IDs, task/transition counts).",
		{ path: z.string().describe("StateTree asset path") },
		{ readOnlyHint: true },
		async ({ path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
st = unreal.EditorAssetLibrary.load_asset('{{path}}')
if not st or not isinstance(st, unreal.StateTree):
    print(json.dumps({"error": "StateTree not found: {{path}}"}))
else:
    result = {"success": True, "name": st.get_name(), "path": st.get_path_name(), "states": []}
    try:
        editor_data = st.get_editor_property('EditorData')
        def describe(state):
            entry = {"name": str(state.get_editor_property('Name'))}
            try:
                entry["task_count"] = len(state.get_editor_property('Tasks'))
            except Exception:
                pass
            try:
                entry["transition_count"] = len(state.get_editor_property('Transitions'))
            except Exception:
                pass
            try:
                entry["children"] = [describe(c) for c in state.get_editor_property('Children')]
            except Exception:
                pass
            return entry
        if editor_data:
            result["states"] = [describe(s) for s in editor_data.get_editor_property('SubTrees')]
    except Exception as e:
        result["read_error"] = str(e)
    print(json.dumps(result, indent=2))`,
				{ path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"add_state_tree_state",
		"Add a new state to a StateTree, either as a top-level subtree or nested under an existing state by name. Transition wiring is not included (FStateTreeTransition APIs are internal/version-sensitive).",
		{
			path: z.string().describe("StateTree asset path"),
			name: z.string().describe("New state name"),
			parent: z.string().optional().describe("Existing state name to nest this under"),
		},
		async ({ path, name, parent }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
st = unreal.EditorAssetLibrary.load_asset('{{path}}')
if not st or not isinstance(st, unreal.StateTree):
    print(json.dumps({"error": "StateTree not found: {{path}}"}))
else:
    editor_data = st.get_editor_property('EditorData')
    if not editor_data:
        print(json.dumps({"error": "StateTree has no EditorData"}))
    else:
        new_state = unreal.new_object(unreal.StateTreeState, outer=editor_data, name='{{name}}')
        new_state.set_editor_property('Name', '{{name}}')
        parent_name = '{{parent}}'
        if parent_name:
            def find_state(state, target):
                if str(state.get_editor_property('Name')) == target:
                    return state
                for c in state.get_editor_property('Children'):
                    found = find_state(c, target)
                    if found:
                        return found
                return None
            parent_state = None
            for top in editor_data.get_editor_property('SubTrees'):
                parent_state = find_state(top, parent_name)
                if parent_state:
                    break
            if not parent_state:
                print(json.dumps({"error": "Parent state not found: " + parent_name}))
                raise SystemExit()
            children = list(parent_state.get_editor_property('Children'))
            children.append(new_state)
            parent_state.set_editor_property('Children', children)
        else:
            subtrees = list(editor_data.get_editor_property('SubTrees'))
            subtrees.append(new_state)
            editor_data.set_editor_property('SubTrees', subtrees)
        st.mark_package_dirty()
        unreal.EditorAssetLibrary.save_asset('{{path}}')
        print(json.dumps({"success": True, "state": "{{name}}", "parent": parent_name or "root"}))`,
				{ path, name, parent: parent || "" },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);
}
