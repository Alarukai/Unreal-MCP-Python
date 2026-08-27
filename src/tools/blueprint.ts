import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { PluginBridgeResponse, UnrealMcpConfig } from "../types.js";
import { inlineScript } from "../utils/template.js";

const VARIABLE_TYPE_MAP: Record<string, string> = {
	bool: "bool",
	int: "int",
	float: "float",
	string: "string",
	vector: "struct'/Script/CoreUObject.Vector'",
	rotator: "struct'/Script/CoreUObject.Rotator'",
	object: "object'/Script/Engine.Object'",
};

/**
 * Best-effort extraction of a node id from a plugin response. The
 * UnrealMCPBridge C++ plugin isn't part of this repo (optional, built
 * separately), so its exact response shape for add_node isn't verifiable
 * here — try the field names its sibling projects commonly use rather
 * than assuming one and failing silently on the others.
 */
export function extractNodeId(data: unknown): string | undefined {
	if (!data || typeof data !== "object") return undefined;
	const obj = data as Record<string, unknown>;
	const candidate = obj.node_id ?? obj.nodeId ?? obj.id;
	return typeof candidate === "string" ? candidate : undefined;
}

export function splitRefPin(spec: string): { ref: string; pin: string } {
	const dot = spec.indexOf(".");
	if (dot === -1) return { ref: spec, pin: "" };
	return { ref: spec.slice(0, dot), pin: spec.slice(dot + 1) };
}

/**
 * Parse a runPython() result as the JSON our scripts print. UE occasionally
 * emits log lines to stdout before the payload, and runPython can surface a
 * plain error string, so a bare JSON.parse can throw. Callers run inside the
 * edit_blueprint batch loop where a throw would discard all partial results,
 * so failures must come back as structured data, never as an exception.
 */
export function safeParsePython(result: string): { success: boolean; data: unknown } {
	try {
		const parsed = JSON.parse(result);
		return { success: !(parsed && typeof parsed === "object" && "error" in parsed), data: parsed };
	} catch {
		// Retry against the last JSON-looking line, in case log spam preceded it.
		const lastBrace = result.lastIndexOf("{");
		if (lastBrace > 0) {
			try {
				const parsed = JSON.parse(result.slice(lastBrace));
				return {
					success: !(parsed && typeof parsed === "object" && "error" in parsed),
					data: parsed,
				};
			} catch {
				// fall through
			}
		}
		return { success: false, data: { error: "Unparseable response from editor", raw: result } };
	}
}

export function registerBlueprintTools(
	server: McpServer,
	manager: ConnectionManager,
	_config: UnrealMcpConfig,
): void {
	/**
	 * Shared by add_blueprint_variable and edit_blueprint.
	 * compileAndSave=false lets the batch tool defer to a single final compile
	 * instead of compiling once per variable.
	 */
	async function addVariableImpl(
		blueprint_path: string,
		variable_name: string,
		variable_type: string,
		default_value?: string,
		compileAndSave = true,
	): Promise<{ success: boolean; data: unknown }> {
		if (manager.hasPlugin) {
			const response = await manager.plugin.sendCommand({
				command: "add_variable",
				params: { blueprint_path, variable_name, variable_type, default_value },
			});
			return { success: response.success, data: response.data ?? response.error };
		}

		const pinType = VARIABLE_TYPE_MAP[variable_type] || "bool";
		// UE's add_member_variable(blueprint, name, pin_type) takes no default-value
		// argument, and setting one from Python requires fragile FBPVariableDescription
		// manipulation. Rather than silently drop a default the caller passed, surface
		// that it wasn't applied so they can use the plugin path or set_blueprint_property.
		const compileLine = compileAndSave
			? "    unreal.BlueprintEditorLibrary.compile_blueprint(bp)\n"
			: "";
		const script = inlineScript(
			`import unreal
import json
bp = unreal.EditorAssetLibrary.load_asset('{{blueprint_path}}')
if bp:
    unreal.BlueprintEditorLibrary.add_member_variable(bp, '{{variable_name}}', '{{pin_type}}')
${compileLine}    print(json.dumps({"success": True, "variable": "{{variable_name}}", "type": "{{variable_type}}"}))
else:
    print(json.dumps({"error": "Blueprint not found"}))`,
			{ blueprint_path, variable_name, pin_type: pinType, variable_type },
		);
		const result = await manager.runPython(script);
		const parsed = safeParsePython(result);
		if (parsed.success && default_value && parsed.data && typeof parsed.data === "object") {
			(parsed.data as Record<string, unknown>).default_value_note =
				"default_value was not applied: the Python fallback cannot set variable defaults. " +
				"Use set_blueprint_property, or install the UnrealMCPBridge plugin.";
		}
		return parsed;
	}

	/**
	 * Shared by add_blueprint_component and edit_blueprint.
	 * compileAndSave=false lets the batch tool defer to a single final compile
	 * instead of compiling+saving once per component.
	 */
	async function addComponentImpl(
		blueprint_path: string,
		component_class: string,
		component_name?: string,
		compileAndSave = true,
	): Promise<{ success: boolean; data: unknown }> {
		if (manager.hasPlugin) {
			const response = await manager.plugin.sendCommand({
				command: "add_component",
				params: { blueprint_path, component_class, component_name },
			});
			return { success: response.success, data: response.data ?? response.error };
		}

		const cname = component_name || component_class.replace("Component", "");
		const compileLines = compileAndSave
			? "                unreal.BlueprintEditorLibrary.compile_blueprint(bp)\n                unreal.EditorAssetLibrary.save_asset('{{blueprint_path}}')\n"
			: "";
		const script = inlineScript(
			`import unreal
import json
bp = unreal.EditorAssetLibrary.load_asset('{{blueprint_path}}')
if bp:
    comp_class = getattr(unreal, '{{component_class}}', None)
    if comp_class:
        try:
            subsys = unreal.get_engine_subsystem(unreal.SubobjectDataSubsystem)
            handles = subsys.k2_gather_subobject_data_for_blueprint(bp)
            root_handle = handles[0] if handles else None
            new_handle, fail = subsys.k2_add_new_subobject(unreal.AddNewSubobjectParams(parent_handle=root_handle, new_class=comp_class, blueprint_context=bp))
            if new_handle.is_valid():
${compileLines}                print(json.dumps({"success": True, "component": "{{cname}}"}))
            else:
                print(json.dumps({"error": "Failed to add component: " + str(fail)}))
        except Exception as e:
            print(json.dumps({"error": str(e)}))
    else:
        print(json.dumps({"error": "Component class not found: {{component_class}}"}))
else:
    print(json.dumps({"error": "Blueprint not found: {{blueprint_path}}"}))`,
			{ blueprint_path, component_class, cname, component_name: cname },
		);
		const result = await manager.runPython(script);
		return safeParsePython(result);
	}

	/** Shared by add_graph_node and edit_blueprint. Plugin-only, no Python fallback. */
	async function addNodeImpl(
		blueprint_path: string,
		node_type: string,
		x: number,
		y: number,
		properties?: Record<string, unknown>,
	): Promise<PluginBridgeResponse> {
		return manager.plugin.sendCommand({
			command: "add_node",
			params: { blueprint_path, node_type, x, y, properties: properties || {} },
		});
	}

	/** Shared by connect_graph_nodes and edit_blueprint. Plugin-only, no Python fallback. */
	async function connectNodesImpl(
		blueprint_path: string,
		source_node_id: string,
		source_pin: string,
		target_node_id: string,
		target_pin: string,
	): Promise<PluginBridgeResponse> {
		return manager.plugin.sendCommand({
			command: "connect_nodes",
			params: { blueprint_path, source_node_id, source_pin, target_node_id, target_pin },
		});
	}

	server.tool(
		"create_blueprint",
		"Create a new Blueprint class.",
		{
			name: z.string().describe("Blueprint asset name"),
			parent_class: z
				.string()
				.default("Actor")
				.describe("Parent class (e.g., Actor, Character, Pawn, PlayerController)"),
			path: z.string().default("/Game/Blueprints").describe("Content directory to create in"),
		},
		async ({ name, parent_class, path }) => {
			await manager.requireEditor();

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
parent = getattr(unreal, '{{parent_class}}', None) or unreal.EditorAssetLibrary.load_asset('/Script/Engine.{{parent_class}}')
factory.set_editor_property('ParentClass', parent)
asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
bp = asset_tools.create_asset('{{name}}', '{{path}}', unreal.Blueprint, factory)
if bp:
    print(json.dumps({"success": True, "name": bp.get_name(), "path": bp.get_path_name()}))
else:
    print(json.dumps({"error": "Failed to create Blueprint"}))`,
				{ name, parent_class, path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"add_blueprint_component",
		"Add a component to a Blueprint.",
		{
			blueprint_path: z.string().describe("Blueprint asset path"),
			component_class: z
				.string()
				.describe(
					"Component class (e.g., StaticMeshComponent, BoxCollisionComponent, PointLightComponent)",
				),
			component_name: z.string().optional().describe("Name for the component"),
		},
		async ({ blueprint_path, component_class, component_name }) => {
			await manager.requireEditor();
			const { data } = await addComponentImpl(blueprint_path, component_class, component_name);
			return { content: [{ type: "text", text: JSON.stringify(data) }] };
		},
	);

	server.tool(
		"add_blueprint_variable",
		"Add a variable to a Blueprint.",
		{
			blueprint_path: z.string().describe("Blueprint asset path"),
			variable_name: z.string().describe("Variable name"),
			variable_type: z
				.enum(["bool", "int", "float", "string", "vector", "rotator", "object"])
				.describe("Variable type"),
			default_value: z.string().optional().describe("Default value as string"),
		},
		async ({ blueprint_path, variable_name, variable_type, default_value }) => {
			await manager.requireEditor();
			const { data } = await addVariableImpl(
				blueprint_path,
				variable_name,
				variable_type,
				default_value,
			);
			return { content: [{ type: "text", text: JSON.stringify(data) }] };
		},
	);

	server.tool(
		"add_graph_node",
		"Add a node to a Blueprint's event graph. Requires the optional C++ plugin for full node type support. Falls back to Python for basic operations.",
		{
			blueprint_path: z.string().describe("Blueprint asset path"),
			node_type: z
				.string()
				.describe(
					"Node type (e.g., Branch, Print, CallFunction, VariableGet, VariableSet, ReceiveBeginPlay, ReceiveTick, Comparison, Switch, ExecutionSequence, SpawnActor, DynamicCast, etc.)",
				),
			x: z.number().default(0).describe("X position in graph"),
			y: z.number().default(0).describe("Y position in graph"),
			properties: z
				.record(z.unknown())
				.optional()
				.describe(
					"Node-specific properties (e.g., {function_name: 'PrintString', target_class: 'KismetSystemLibrary'})",
				),
		},
		async ({ blueprint_path, node_type, x, y, properties }) => {
			await manager.requireEditor();

			if (manager.hasPlugin) {
				const response = await addNodeImpl(blueprint_path, node_type, x, y, properties);
				return {
					content: [{ type: "text", text: JSON.stringify(response.data ?? response.error) }],
				};
			}

			// Python fallback — limited to basic node types
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							error:
								"Full node graph editing requires the UnrealMCPBridge plugin. Without it, use create_blueprint, add_blueprint_component, add_blueprint_variable, and compile_blueprint for basic Blueprint operations.",
							hint: "Install the plugin from plugin/UnrealMCPBridge/ in your UE project's Plugins directory.",
						}),
					},
				],
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
			await manager.requireEditor();

			if (manager.hasPlugin) {
				const response = await connectNodesImpl(
					blueprint_path,
					source_node_id,
					source_pin,
					target_node_id,
					target_pin,
				);
				return {
					content: [{ type: "text", text: JSON.stringify(response.data ?? response.error) }],
				};
			}

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							error: "Node pin wiring requires the UnrealMCPBridge plugin.",
							hint: "Install the plugin from plugin/UnrealMCPBridge/ in your UE project's Plugins directory.",
						}),
					},
				],
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
		{ destructiveHint: true },
		async ({ blueprint_path, node_id }) => {
			await manager.requireEditor();

			if (manager.hasPlugin) {
				const response = await manager.plugin.sendCommand({
					command: "remove_node",
					params: { blueprint_path, node_id },
				});
				return { content: [{ type: "text", text: JSON.stringify(response.data) }] };
			}

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({ error: "Node removal requires the UnrealMCPBridge plugin." }),
					},
				],
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
			await manager.requireEditor();

			if (manager.hasPlugin) {
				const response = await manager.plugin.sendCommand({
					command: "list_nodes",
					params: { blueprint_path },
				});
				return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
			}

			// Python fallback — graph node enumeration is not available via Python API
			// (ubergraph_pages is not exposed). Return helpful message.
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							error:
								"Blueprint graph node listing requires the UnrealMCPBridge plugin. The Blueprint graph API (ubergraph_pages) is not exposed to Python.",
							hint: "Install the plugin from plugin/UnrealMCPBridge/ in your UE project's Plugins directory.",
						}),
					},
				],
			};
		},
	);

	server.tool(
		"compile_blueprint",
		"Compile a Blueprint.",
		{
			blueprint_path: z.string().describe("Blueprint asset path"),
		},
		async ({ blueprint_path }) => {
			await manager.requireEditor();
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
			const result = await manager.runPython(script);
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
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
bp = unreal.EditorAssetLibrary.load_asset('{{blueprint_path}}')
if bp:
    result = {"name": bp.get_name(), "path": bp.get_path_name()}
    try:
        gen = bp.generated_class()
        if gen:
            super_class = gen.get_super_class()
            if super_class:
                result["parent_class"] = super_class.get_name()
    except:
        pass
    try:
        gen_class = bp.generated_class()
        if gen_class:
            result["generated_class"] = gen_class.get_name()
    except:
        pass
    try:
        gen = bp.generated_class()
        if gen:
            # Spawn temp actor to get all components including inherited
            subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
            temp = subsys.spawn_actor_from_class(gen, unreal.Vector(0, 0, -100000))
            if temp:
                all_comps = temp.get_components_by_class(unreal.ActorComponent)
                result["components"] = [{"name": c.get_name(), "class": c.get_class().get_name()} for c in all_comps]
                subsys.destroy_actor(temp)
    except:
        pass
    print(json.dumps(result, indent=2))
else:
    print(json.dumps({"error": "Blueprint not found: {{blueprint_path}}"}))`,
				{ blueprint_path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"spawn_blueprint_actor",
		"Spawn an instance of a Blueprint class in the level.",
		{
			blueprint_path: z.string().describe("Blueprint asset path"),
			label: z.string().optional().describe("Actor label"),
			location: z
				.object({ x: z.number(), y: z.number(), z: z.number() })
				.default({ x: 0, y: 0, z: 0 }),
			rotation: z
				.object({ pitch: z.number(), yaw: z.number(), roll: z.number() })
				.default({ pitch: 0, yaw: 0, roll: 0 }),
		},
		async ({ blueprint_path, label, location, rotation }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
bp = unreal.EditorAssetLibrary.load_asset('{{blueprint_path}}')
if bp:
    loc = unreal.Vector({{loc_x}}, {{loc_y}}, {{loc_z}})
    rot = unreal.Rotator({{rot_pitch}}, {{rot_yaw}}, {{rot_roll}})
    subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    actor = subsys.spawn_actor_from_class(bp.generated_class(), loc, rot)
    if actor:
        label = '{{label}}'
        if label:
            actor.set_actor_label(label)
        print(json.dumps({"success": True, "name": actor.get_name()}))
    else:
        print(json.dumps({"error": "Failed to spawn Blueprint actor"}))
else:
    print(json.dumps({"error": "Blueprint not found: {{blueprint_path}}"}))`,
				{
					blueprint_path,
					label: label || "",
					loc_x: location.x,
					loc_y: location.y,
					loc_z: location.z,
					rot_pitch: rotation.pitch,
					rot_yaw: rotation.yaw,
					rot_roll: rotation.roll,
				},
			);
			const result = await manager.runPython(script);
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
			await manager.requireEditor();

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
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"set_blueprint_property",
		"Set a default property value on a Blueprint's CDO (Class Default Object). For component properties, use a dot path like 'ComponentName.PropertyName'.",
		{
			blueprint_path: z.string().describe("Blueprint asset path"),
			property_name: z
				.string()
				.describe("Property name, or ComponentName.PropertyName for component sub-properties"),
			property_value: z
				.string()
				.describe(
					"Property value — asset paths (/Game/...), Python expressions (True, 42.0), or plain strings",
				),
		},
		async ({ blueprint_path, property_name, property_value }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json

bp = unreal.EditorAssetLibrary.load_asset('{{blueprint_path}}')
if not bp:
    print(json.dumps({"error": "Blueprint not found: {{blueprint_path}}"}))
else:
    prop_name = '{{property_name}}'
    raw_value = '{{property_value}}'

    # Auto-load asset paths
    value = raw_value
    if raw_value.startswith('/Game/') or raw_value.startswith('/Script/') or raw_value.startswith('/Engine/'):
        loaded = unreal.EditorAssetLibrary.load_asset(raw_value)
        if loaded:
            value = loaded
        else:
            print(json.dumps({"error": "Could not load asset: " + raw_value}))
            raise SystemExit()
    elif raw_value in ('True', 'False'):
        value = raw_value == 'True'
    elif raw_value == 'None':
        value = None
    else:
        try:
            value = float(raw_value) if '.' in raw_value else int(raw_value)
        except ValueError:
            value = raw_value

    # Handle dot-path for component properties (e.g., BodyMesh.StaticMesh)
    if '.' in prop_name:
        comp_name, sub_prop = prop_name.split('.', 1)
        # Spawn a temporary actor to access all components (including inherited)
        gen = bp.generated_class()
        if not gen:
            print(json.dumps({"error": "Could not get generated class"}))
        else:
            # Try CDO first
            cdo = unreal.get_default_object(gen)
            target_comp = None
            if cdo:
                for comp in cdo.get_components_by_class(unreal.ActorComponent):
                    if comp.get_name() == comp_name or comp_name in comp.get_name():
                        target_comp = comp
                        break
            # If not found in CDO, spawn a temp actor to find inherited components
            if not target_comp:
                subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
                temp = subsys.spawn_actor_from_class(gen, unreal.Vector(0, 0, -100000))
                if temp:
                    for comp in temp.get_components_by_class(unreal.ActorComponent):
                        if comp.get_name() == comp_name or comp_name in comp.get_name():
                            # Found it on the instance — now set on CDO template
                            # Find matching component on CDO by class
                            if cdo:
                                for cdo_comp in cdo.get_components_by_class(comp.get_class()):
                                    target_comp = cdo_comp
                                    break
                            break
                    subsys.destroy_actor(temp)
            if target_comp:
                try:
                    if sub_prop == 'StaticMesh' and hasattr(target_comp, 'set_static_mesh'):
                        target_comp.set_static_mesh(value)
                    elif sub_prop == 'SkeletalMesh' and hasattr(target_comp, 'set_skeletal_mesh_asset'):
                        target_comp.set_skeletal_mesh_asset(value)
                    else:
                        target_comp.set_editor_property(sub_prop, value)
                    unreal.EditorAssetLibrary.save_asset('{{blueprint_path}}')
                    print(json.dumps({"success": True, "component": comp_name, "property": sub_prop}))
                except Exception as e:
                    print(json.dumps({"error": str(e)}))
            else:
                # List available components to help the user
                available = []
                if cdo:
                    available = [c.get_name() for c in cdo.get_components_by_class(unreal.ActorComponent)]
                print(json.dumps({"error": "Component not found: " + comp_name, "available_components": available, "hint": "Component may be inherited. Try using execute_python for direct access."}))
    else:
        # Top-level CDO property
        try:
            gen_class = bp.generated_class()
            cdo = unreal.get_default_object(gen_class) if gen_class else None
            if cdo:
                cdo.set_editor_property(prop_name, value)
                print(json.dumps({"success": True}))
            else:
                print(json.dumps({"error": "Could not get CDO"}))
        except Exception as e:
            print(json.dumps({"error": str(e)}))`,
				{ blueprint_path, property_name, property_value },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"edit_blueprint",
		"Batch-edit a Blueprint in one call instead of one tool call per operation: add nodes, wire " +
			"pin connections, add variables, and add components together. Each add_nodes entry gets a " +
			"local `ref` (only valid within this call) that connect_pins references as `ref.PinName` — " +
			"e.g. {from:'myBranch.True', to:'printNode.execute'}. Node graph editing (add_nodes/connect_pins) " +
			"requires the optional UnrealMCPBridge plugin; add_variables/add_components work either way. " +
			"On a connect_pins failure the error lists the refs and node ids that were actually created " +
			"in this call — use that to fix the one bad reference and retry, rather than re-running the " +
			"whole batch from scratch. `ref` only resolves within this one call: to wire a new node to a " +
			"node from a previous edit_blueprint call, use list_graph_nodes first to get its real node id " +
			"and pass that id directly as the ref instead (it's used as a lookup key, not validated syntax).",
		{
			blueprint_path: z.string().describe("Blueprint asset path"),
			add_nodes: z
				.array(
					z.object({
						ref: z.string().describe("Local ID for this node, referenced by connect_pins"),
						node_type: z.string().describe("Node type, e.g. Branch, CallFunction, VariableGet"),
						x: z.number().default(0),
						y: z.number().default(0),
						properties: z.record(z.unknown()).optional(),
					}),
				)
				.optional()
				.describe("Nodes to add. Requires the UnrealMCPBridge plugin."),
			connect_pins: z
				.array(
					z.object({
						from: z.string().describe("ref.PinName of the source node added in this call"),
						to: z.string().describe("ref.PinName of the target node added in this call"),
					}),
				)
				.optional()
				.describe("Pin connections between nodes added in this same call. Requires the plugin."),
			add_variables: z
				.array(
					z.object({
						variable_name: z.string(),
						variable_type: z.enum([
							"bool",
							"int",
							"float",
							"string",
							"vector",
							"rotator",
							"object",
						]),
						default_value: z.string().optional(),
					}),
				)
				.optional(),
			add_components: z
				.array(
					z.object({
						component_class: z.string(),
						component_name: z.string().optional(),
					}),
				)
				.optional(),
			compile: z
				.boolean()
				.default(true)
				.describe(
					"Compile and save the Blueprint once after applying all changes. If false, the " +
						"additions are made but NOT compiled or saved — call compile_blueprint yourself " +
						"afterward, e.g. when chaining several edit_blueprint calls.",
				),
		},
		async ({ blueprint_path, add_nodes, connect_pins, add_variables, add_components, compile }) => {
			await manager.requireEditor();

			const created: Record<string, unknown>[] = [];
			const modified: Record<string, unknown>[] = [];
			const errors: Record<string, unknown>[] = [];

			// Defer compilation to the single final compile step below (compileAndSave=false)
			// instead of compiling once per variable/component.
			for (const v of add_variables || []) {
				const { success, data } = await addVariableImpl(
					blueprint_path,
					v.variable_name,
					v.variable_type,
					v.default_value,
					false,
				);
				(success ? created : errors).push({ op: "add_variable", variable: v.variable_name, data });
			}

			for (const c of add_components || []) {
				const { success, data } = await addComponentImpl(
					blueprint_path,
					c.component_class,
					c.component_name,
					false,
				);
				(success ? created : errors).push({
					op: "add_component",
					component: c.component_class,
					data,
				});
			}

			const refToNodeId = new Map<string, string>();
			if (add_nodes && add_nodes.length > 0) {
				if (!manager.hasPlugin) {
					errors.push({
						op: "add_nodes",
						error: "Node graph editing requires the UnrealMCPBridge plugin.",
						hint: "Install the plugin from plugin/UnrealMCPBridge/ in your UE project's Plugins directory.",
					});
				} else {
					for (const n of add_nodes) {
						const response = await addNodeImpl(blueprint_path, n.node_type, n.x, n.y, n.properties);
						if (!response.success) {
							errors.push({ op: "add_node", ref: n.ref, error: response.error ?? response.data });
							continue;
						}
						const nodeId = extractNodeId(response.data);
						if (!nodeId) {
							errors.push({
								op: "add_node",
								ref: n.ref,
								error:
									"Plugin response did not include a recognizable node id (expected node_id/nodeId/id field).",
								raw: response.data,
							});
							continue;
						}
						refToNodeId.set(n.ref, nodeId);
						created.push({ op: "add_node", ref: n.ref, node_id: nodeId });
					}
				}
			}

			if (connect_pins && connect_pins.length > 0) {
				if (!manager.hasPlugin) {
					errors.push({
						op: "connect_pins",
						error: "Pin wiring requires the UnrealMCPBridge plugin.",
					});
				} else {
					for (const c of connect_pins) {
						const from = splitRefPin(c.from);
						const to = splitRefPin(c.to);
						// Refs created by add_nodes in this same call resolve to their real node id.
						// A ref not found here is treated as a literal node id (e.g. from a prior
						// edit_blueprint call via list_graph_nodes) and passed through as-is — the
						// plugin's own response is the source of truth on whether it actually exists.
						const sourceId = refToNodeId.get(from.ref) ?? from.ref;
						const targetId = refToNodeId.get(to.ref) ?? to.ref;
						const response = await connectNodesImpl(
							blueprint_path,
							sourceId,
							from.pin,
							targetId,
							to.pin,
						);
						if (!response.success) {
							errors.push({
								op: "connect_pins",
								connection: `${c.from} -> ${c.to}`,
								error: response.error ?? response.data,
								available_refs: [...refToNodeId.keys()],
							});
						} else {
							modified.push({ op: "connect_pins", connection: `${c.from} -> ${c.to}` });
						}
					}
				}
			}

			if (compile) {
				const script = inlineScript(
					`import unreal
import json
bp = unreal.EditorAssetLibrary.load_asset('{{blueprint_path}}')
if bp:
    unreal.BlueprintEditorLibrary.compile_blueprint(bp)
    unreal.EditorAssetLibrary.save_asset('{{blueprint_path}}')
    print(json.dumps({"success": True}))
else:
    print(json.dumps({"error": "Blueprint not found: {{blueprint_path}}"}))`,
					{ blueprint_path },
				);
				const result = await manager.runPython(script);
				const { success, data } = safeParsePython(result);
				(success ? modified : errors).push({ op: "compile", data });
			}

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{ success: errors.length === 0, created, modified, errors },
							null,
							2,
						),
					},
				],
				isError: errors.length > 0 && created.length === 0 && modified.length === 0,
			};
		},
	);
}
