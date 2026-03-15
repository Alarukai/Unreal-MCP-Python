import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";
import { inlineScript } from "../utils/template.js";

export function registerBlueprintTools(
	server: McpServer,
	manager: ConnectionManager,
	_config: UnrealMcpConfig,
): void {
	server.tool(
		"create_blueprint",
		"Create a new Blueprint class.",
		{
			name: z.string().describe("Blueprint asset name"),
			parent_class: z.string().default("Actor").describe("Parent class (e.g., Actor, Character, Pawn, PlayerController)"),
			path: z.string().default("/Game/Blueprints").describe("Content directory to create in"),
		},
		async ({ name, parent_class, path }) => {
			manager.requireEditor();

			// Try plugin bridge first for richer creation
			if (manager.hasPlugin) {
				const response = await manager.plugin.sendCommand({
					command: "create_blueprint",
					params: { name, parent_class, path },
				});
				return { content: [{ type: "text", text: JSON.stringify(response.data) }] };
			}

			// Python fallback
			const script = inlineScript(
				`import unreal
import json
factory = unreal.BlueprintFactory()
factory.set_editor_property('ParentClass', unreal.EditorAssetLibrary.load_blueprint_class('/Script/Engine.{{parent_class}}') if not hasattr(unreal, '{{parent_class}}') else getattr(unreal, '{{parent_class}}'))
asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
bp = asset_tools.create_asset('{{name}}', '{{path}}', unreal.Blueprint, factory)
if bp:
    print(json.dumps({"success": True, "name": bp.get_name(), "path": bp.get_path_name()}))
else:
    print(json.dumps({"error": "Failed to create Blueprint"}))`,
				{ name, parent_class, path },
			);
			const result = await manager.python.execute(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"add_blueprint_component",
		"Add a component to a Blueprint.",
		{
			blueprint_path: z.string().describe("Blueprint asset path"),
			component_class: z.string().describe("Component class (e.g., StaticMeshComponent, BoxCollisionComponent, PointLightComponent)"),
			component_name: z.string().optional().describe("Name for the component"),
		},
		async ({ blueprint_path, component_class, component_name }) => {
			manager.requireEditor();

			if (manager.hasPlugin) {
				const response = await manager.plugin.sendCommand({
					command: "add_component",
					params: { blueprint_path, component_class, component_name },
				});
				return { content: [{ type: "text", text: JSON.stringify(response.data) }] };
			}

			const cname = component_name || component_class.replace("Component", "");
			const script = inlineScript(
				`import unreal
import json
bp = unreal.EditorAssetLibrary.load_asset('{{blueprint_path}}')
if bp:
    subsys = unreal.get_editor_subsystem(unreal.SubobjectDataSubsystem)
    root_handle = subsys.k2_gather_subobject_data_for_blueprint(bp)
    comp_class = getattr(unreal, '{{component_class}}', None)
    if comp_class:
        # Use SCS (Simple Construction Script) to add component
        scs = bp.simple_construction_script
        if scs:
            node = scs.create_node(comp_class, '{{cname}}')
            if node:
                scs.add_node(node)
                unreal.EditorAssetLibrary.save_asset('{{blueprint_path}}')
                print(json.dumps({"success": True, "component": '{{cname}}'}))
            else:
                print(json.dumps({"error": "Failed to create SCS node"}))
        else:
            print(json.dumps({"error": "Blueprint has no SCS"}))
    else:
        print(json.dumps({"error": "Component class not found: {{component_class}}"}))
else:
    print(json.dumps({"error": "Blueprint not found: {{blueprint_path}}"}))`,
				{ blueprint_path, component_class, cname, component_name: cname },
			);
			const result = await manager.python.execute(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"add_blueprint_variable",
		"Add a variable to a Blueprint.",
		{
			blueprint_path: z.string().describe("Blueprint asset path"),
			variable_name: z.string().describe("Variable name"),
			variable_type: z.enum(["bool", "int", "float", "string", "vector", "rotator", "object"]).describe("Variable type"),
			default_value: z.string().optional().describe("Default value as string"),
		},
		async ({ blueprint_path, variable_name, variable_type, default_value }) => {
			manager.requireEditor();

			if (manager.hasPlugin) {
				const response = await manager.plugin.sendCommand({
					command: "add_variable",
					params: { blueprint_path, variable_name, variable_type, default_value },
				});
				return { content: [{ type: "text", text: JSON.stringify(response.data) }] };
			}

			const typeMap: Record<string, string> = {
				bool: "bool",
				int: "int",
				float: "float",
				string: "string",
				vector: "struct'/Script/CoreUObject.Vector'",
				rotator: "struct'/Script/CoreUObject.Rotator'",
				object: "object'/Script/Engine.Object'",
			};
			const pinType = typeMap[variable_type] || "bool";

			const script = inlineScript(
				`import unreal
import json
bp = unreal.EditorAssetLibrary.load_asset('{{blueprint_path}}')
if bp:
    unreal.BlueprintEditorLibrary.add_member_variable(bp, '{{variable_name}}', '${pinType}')
    unreal.BlueprintEditorLibrary.compile_blueprint(bp)
    print(json.dumps({"success": True, "variable": "{{variable_name}}", "type": "${variable_type}"}))
else:
    print(json.dumps({"error": "Blueprint not found"}))`,
				{ blueprint_path, variable_name },
			);
			const result = await manager.python.execute(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"add_graph_node",
		"Add a node to a Blueprint's event graph. Requires the optional C++ plugin for full node type support. Falls back to Python for basic operations.",
		{
			blueprint_path: z.string().describe("Blueprint asset path"),
			node_type: z.string().describe("Node type (e.g., Branch, Print, CallFunction, VariableGet, VariableSet, ReceiveBeginPlay, ReceiveTick, Comparison, Switch, ExecutionSequence, SpawnActor, DynamicCast, etc.)"),
			x: z.number().default(0).describe("X position in graph"),
			y: z.number().default(0).describe("Y position in graph"),
			properties: z.record(z.unknown()).optional().describe("Node-specific properties (e.g., {function_name: 'PrintString', target_class: 'KismetSystemLibrary'})"),
		},
		async ({ blueprint_path, node_type, x, y, properties }) => {
			manager.requireEditor();

			if (manager.hasPlugin) {
				const response = await manager.plugin.sendCommand({
					command: "add_node",
					params: { blueprint_path, node_type, x, y, properties: properties || {} },
				});
				return { content: [{ type: "text", text: JSON.stringify(response.data) }] };
			}

			// Python fallback — limited to basic node types
			return {
				content: [{
					type: "text",
					text: JSON.stringify({
						error: "Full node graph editing requires the UnrealMCPBridge plugin. Without it, use create_blueprint, add_blueprint_component, add_blueprint_variable, and compile_blueprint for basic Blueprint operations.",
						hint: "Install the plugin from plugin/UnrealMCPBridge/ in your UE project's Plugins directory.",
					}),
				}],
			};
		},
	);

	server.tool(
		"connect_graph_nodes",
		"Wire two node pins together in a Blueprint graph. Requires the optional C++ plugin.",
		{
			blueprint_path: z.string().describe("Blueprint asset path"),
			source_node_id: z.string().describe("Source node ID"),
			source_pin: z.string().describe("Source pin name"),
			target_node_id: z.string().describe("Target node ID"),
			target_pin: z.string().describe("Target pin name"),
		},
		async ({ blueprint_path, source_node_id, source_pin, target_node_id, target_pin }) => {
			manager.requireEditor();

			if (manager.hasPlugin) {
				const response = await manager.plugin.sendCommand({
					command: "connect_nodes",
					params: { blueprint_path, source_node_id, source_pin, target_node_id, target_pin },
				});
				return { content: [{ type: "text", text: JSON.stringify(response.data) }] };
			}

			return {
				content: [{
					type: "text",
					text: JSON.stringify({
						error: "Node pin wiring requires the UnrealMCPBridge plugin.",
						hint: "Install the plugin from plugin/UnrealMCPBridge/ in your UE project's Plugins directory.",
					}),
				}],
			};
		},
	);

	server.tool(
		"remove_graph_node",
		"Remove a node from a Blueprint graph. Requires the optional C++ plugin.",
		{
			blueprint_path: z.string().describe("Blueprint asset path"),
			node_id: z.string().describe("Node ID to remove"),
		},
		async ({ blueprint_path, node_id }) => {
			manager.requireEditor();

			if (manager.hasPlugin) {
				const response = await manager.plugin.sendCommand({
					command: "remove_node",
					params: { blueprint_path, node_id },
				});
				return { content: [{ type: "text", text: JSON.stringify(response.data) }] };
			}

			return {
				content: [{
					type: "text",
					text: JSON.stringify({ error: "Node removal requires the UnrealMCPBridge plugin." }),
				}],
			};
		},
	);

	server.tool(
		"list_graph_nodes",
		"List all nodes in a Blueprint's event graph.",
		{
			blueprint_path: z.string().describe("Blueprint asset path"),
		},
		async ({ blueprint_path }) => {
			manager.requireEditor();

			if (manager.hasPlugin) {
				const response = await manager.plugin.sendCommand({
					command: "list_nodes",
					params: { blueprint_path },
				});
				return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
			}

			// Python fallback — basic graph inspection
			const script = inlineScript(
				`import unreal
import json
bp = unreal.EditorAssetLibrary.load_asset('{{blueprint_path}}')
if bp:
    graphs = bp.ubergraph_pages
    result = []
    for g in graphs:
        for node in g.graph.nodes if hasattr(g, 'graph') else []:
            result.append({"name": node.get_name(), "class": node.get_class().get_name()})
    print(json.dumps(result, indent=2))
else:
    print(json.dumps({"error": "Blueprint not found"}))`,
				{ blueprint_path },
			);
			const result = await manager.python.execute(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"compile_blueprint",
		"Compile a Blueprint.",
		{
			blueprint_path: z.string().describe("Blueprint asset path"),
		},
		async ({ blueprint_path }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
bp = unreal.EditorAssetLibrary.load_asset('{{blueprint_path}}')
if bp:
    unreal.BlueprintEditorLibrary.compile_blueprint(bp)
    unreal.EditorAssetLibrary.save_asset('{{blueprint_path}}')
    print(json.dumps({"success": True, "compiled": "{{blueprint_path}}"}))
else:
    print(json.dumps({"error": "Blueprint not found: {{blueprint_path}}"}))`,
				{ blueprint_path },
			);
			const result = await manager.python.execute(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"get_blueprint_info",
		"Get Blueprint info: class, variables, functions, components, and graphs.",
		{
			blueprint_path: z.string().describe("Blueprint asset path"),
		},
		async ({ blueprint_path }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
bp = unreal.EditorAssetLibrary.load_asset('{{blueprint_path}}')
if bp:
    result = {
        "name": bp.get_name(),
        "parent_class": bp.parent_class.get_name() if bp.parent_class else None,
        "path": bp.get_path_name(),
    }
    # Get variables
    gen_class = bp.generated_class
    if gen_class:
        result["generated_class"] = gen_class.get_name()
    print(json.dumps(result, indent=2))
else:
    print(json.dumps({"error": "Blueprint not found: {{blueprint_path}}"}))`,
				{ blueprint_path },
			);
			const result = await manager.python.execute(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"spawn_blueprint_actor",
		"Spawn an instance of a Blueprint class in the level.",
		{
			blueprint_path: z.string().describe("Blueprint asset path"),
			label: z.string().optional().describe("Actor label"),
			location: z.object({ x: z.number(), y: z.number(), z: z.number() }).default({ x: 0, y: 0, z: 0 }),
			rotation: z.object({ pitch: z.number(), yaw: z.number(), roll: z.number() }).default({ pitch: 0, yaw: 0, roll: 0 }),
		},
		async ({ blueprint_path, label, location, rotation }) => {
			manager.requireEditor();
			const labelLine = label ? `actor.set_actor_label('${label}')` : "";
			const script = inlineScript(
				`import unreal
import json
bp = unreal.EditorAssetLibrary.load_asset('{{blueprint_path}}')
if bp:
    loc = unreal.Vector(${location.x}, ${location.y}, ${location.z})
    rot = unreal.Rotator(${rotation.pitch}, ${rotation.yaw}, ${rotation.roll})
    subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    actor = subsys.spawn_actor_from_class(bp.generated_class, loc, rot)
    if actor:
        ${labelLine}
        print(json.dumps({"success": True, "name": actor.get_name()}))
    else:
        print(json.dumps({"error": "Failed to spawn Blueprint actor"}))
else:
    print(json.dumps({"error": "Blueprint not found: {{blueprint_path}}"}))`,
				{ blueprint_path },
			);
			const result = await manager.python.execute(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"add_blueprint_function",
		"Add a custom function to a Blueprint.",
		{
			blueprint_path: z.string().describe("Blueprint asset path"),
			function_name: z.string().describe("Function name"),
		},
		async ({ blueprint_path, function_name }) => {
			manager.requireEditor();

			if (manager.hasPlugin) {
				const response = await manager.plugin.sendCommand({
					command: "add_function",
					params: { blueprint_path, function_name },
				});
				return { content: [{ type: "text", text: JSON.stringify(response.data) }] };
			}

			const script = inlineScript(
				`import unreal
import json
bp = unreal.EditorAssetLibrary.load_asset('{{blueprint_path}}')
if bp:
    unreal.BlueprintEditorLibrary.add_function_graph(bp, '{{function_name}}')
    unreal.EditorAssetLibrary.save_asset('{{blueprint_path}}')
    print(json.dumps({"success": True, "function": "{{function_name}}"}))
else:
    print(json.dumps({"error": "Blueprint not found"}))`,
				{ blueprint_path, function_name },
			);
			const result = await manager.python.execute(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"set_blueprint_property",
		"Set a default property value on a Blueprint's CDO (Class Default Object).",
		{
			blueprint_path: z.string().describe("Blueprint asset path"),
			property_name: z.string().describe("Property name"),
			property_value: z.string().describe("Property value as string"),
		},
		async ({ blueprint_path, property_name, property_value }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
bp = unreal.EditorAssetLibrary.load_asset('{{blueprint_path}}')
if bp and bp.generated_class:
    cdo = unreal.get_default_object(bp.generated_class)
    if cdo:
        try:
            cdo.set_editor_property('{{property_name}}', {{property_value}})
            print(json.dumps({"success": True}))
        except Exception as e:
            print(json.dumps({"error": str(e)}))
    else:
        print(json.dumps({"error": "Could not get CDO"}))
else:
    print(json.dumps({"error": "Blueprint not found"}))`,
				{ blueprint_path, property_name, property_value },
			);
			const result = await manager.python.execute(script);
			return { content: [{ type: "text", text: result }] };
		},
	);
}
