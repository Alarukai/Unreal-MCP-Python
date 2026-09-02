import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";
import { inlineScript } from "../utils/template.js";

export function registerPcgTools(
	server: McpServer,
	manager: ConnectionManager,
	_config: UnrealMcpConfig,
): void {
	server.tool(
		"create_pcg_graph",
		"Create a new, empty PCG (Procedural Content Generation) Graph asset. Requires the PCG plugin enabled.",
		{
			name: z.string().describe("PCG graph asset name"),
			path: z.string().default("/Game/PCG").describe("Content directory to create in"),
		},
		async ({ name, path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
graph_class = getattr(unreal, 'PCGGraph', None)
if graph_class is None:
    print(json.dumps({"error": "PCGGraph class not found — is the PCG plugin enabled?"}))
else:
    existing = unreal.EditorAssetLibrary.load_asset('{{path}}' + '/' + '{{name}}')
    if existing:
        print(json.dumps({"success": True, "name": existing.get_name(), "path": existing.get_path_name(), "existed": True}))
    else:
        asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
        factory_class = getattr(unreal, 'PCGGraphFactory', None)
        factory = unreal.new_object(factory_class) if factory_class else None
        graph = asset_tools.create_asset('{{name}}', '{{path}}', graph_class, factory)
        if graph:
            print(json.dumps({"success": True, "name": graph.get_name(), "path": graph.get_path_name()}))
        else:
            print(json.dumps({"error": "Failed to create PCG graph"}))`,
				{ name, path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"find_pcg_graphs",
		"Search a content directory for PCG Graph assets.",
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
    if cls != 'PCGGraph':
        continue
    results.append({
        "name": str(a.asset_name),
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
		"spawn_pcg_volume",
		"Spawn a PCGVolume actor and assign a PCG graph to it. Does NOT generate immediately — an empty/unwired graph can crash the editor on generate, so call generate_pcg explicitly once the graph has nodes.",
		{
			graph_path: z.string().describe("PCG graph asset path"),
			label: z.string().default("PCG_Volume").describe("Actor label"),
			location: z
				.object({ x: z.number(), y: z.number(), z: z.number() })
				.default({ x: 0, y: 0, z: 0 }),
			scale: z
				.object({ x: z.number(), y: z.number(), z: z.number() })
				.default({ x: 20, y: 20, z: 5 })
				.describe("Volume scale (default ~2000x2000x500cm box)"),
		},
		async ({ graph_path, label, location, scale }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
graph = unreal.EditorAssetLibrary.load_asset('{{graph_path}}')
if not graph:
    print(json.dumps({"error": "PCG graph not found: {{graph_path}}"}))
else:
    loc = unreal.Vector({{x}}, {{y}}, {{z}})
    subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    volume_class = getattr(unreal, 'PCGVolume', None)
    if volume_class is None:
        print(json.dumps({"error": "PCGVolume class not found — is the PCG plugin enabled?"}))
    else:
        volume = subsys.spawn_actor_from_class(volume_class, loc)
        if not volume:
            print(json.dumps({"error": "Failed to spawn PCGVolume"}))
        else:
            volume.set_actor_scale3d(unreal.Vector({{sx}}, {{sy}}, {{sz}}))
            volume.set_actor_label('{{label}}')
            warnings = []
            comp = volume.get_component_by_class(unreal.PCGComponent) if hasattr(unreal, 'PCGComponent') else None
            if comp:
                try:
                    comp.set_graph(graph)
                except Exception as e:
                    warnings.append('set_graph: ' + str(e))
            else:
                warnings.append('No PCGComponent found on spawned volume')
            print(json.dumps({"success": True, "actor": volume.get_actor_label(), "graph": '{{graph_path}}', "warnings": warnings}))`,
				{
					graph_path,
					label,
					x: location.x,
					y: location.y,
					z: location.z,
					sx: scale.x,
					sy: scale.y,
					sz: scale.z,
				},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"generate_pcg",
		"Force a PCG volume to (re-)run generation.",
		{ actor: z.string().describe("PCG volume actor name or label") },
		async ({ actor }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
target = None
for a in actors:
    if hasattr(unreal, 'PCGVolume') and isinstance(a, unreal.PCGVolume) and (a.get_name() == '{{actor}}' or a.get_actor_label() == '{{actor}}'):
        target = a
        break
if not target:
    print(json.dumps({"error": "PCG volume not found: {{actor}}"}))
else:
    comp = target.get_component_by_class(unreal.PCGComponent)
    if not comp:
        print(json.dumps({"error": "PCG volume has no PCGComponent"}))
    else:
        try:
            comp.generate()
            print(json.dumps({"success": True, "actor": target.get_actor_label()}))
        except Exception as e:
            print(json.dumps({"error": "generate() failed: " + str(e)}))`,
				{ actor },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"add_pcg_node",
		"Add a node to a PCG graph by settings-class name (e.g. PCGStaticMeshSpawnerSettings, PCGSurfaceSamplerSettings, PCGSelfPruningSettings — the exact class name, or its 'PCG'/'Settings'-stripped short form like StaticMeshSpawner). Does not wire edges — connect the node to others in the graph editor or via execute_python.",
		{
			graph_path: z.string().describe("PCG graph asset path"),
			node_settings_class: z
				.string()
				.describe(
					"Settings class name, full (PCGStaticMeshSpawnerSettings) or short (StaticMeshSpawner)",
				),
			x: z.number().default(0).describe("X position in graph"),
			y: z.number().default(0).describe("Y position in graph"),
		},
		async ({ graph_path, node_settings_class, x, y }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
graph = unreal.EditorAssetLibrary.load_asset('{{graph_path}}')
if not graph:
    print(json.dumps({"error": "PCG graph not found: {{graph_path}}"}))
else:
    requested = '{{node_settings_class}}'
    candidates = [requested]
    if not requested.startswith('PCG'):
        candidates.append('PCG' + requested)
    if not requested.endswith('Settings'):
        candidates.append(candidates[-1] + 'Settings')
    settings_class = None
    for c in candidates:
        settings_class = getattr(unreal, c, None)
        if settings_class:
            break
    if not settings_class:
        print(json.dumps({"error": "Could not resolve PCG settings class for: " + requested, "tried": candidates}))
    else:
        settings = unreal.new_object(settings_class, outer=graph)
        node = None
        try:
            node = graph.add_node_of_type(settings_class, settings)
        except Exception:
            node = None
        if not node:
            try:
                node = unreal.new_object(unreal.PCGNode, outer=graph)
                node.set_settings_interface(settings)
                graph.add_node(node)
            except Exception as e:
                print(json.dumps({"error": "Failed to add node via both add_node_of_type and manual add_node: " + str(e)}))
                raise SystemExit()
        try:
            node.set_editor_property('PositionX', {{x}})
            node.set_editor_property('PositionY', {{y}})
        except Exception:
            pass
        graph.mark_package_dirty()
        print(json.dumps({"success": True, "graph": graph.get_path_name(), "settings_class": settings_class.get_name()}))`,
				{ graph_path, node_settings_class, x, y },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"get_pcg_info",
		"Read the UPCGComponent attached to an actor: assigned graph, seed, generation trigger, and actor location/scale (which sets the generation bounds).",
		{ actor: z.string().describe("Actor name or label with a PCGComponent") },
		{ readOnlyHint: true },
		async ({ actor }) => {
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
    comp = target.get_component_by_class(unreal.PCGComponent) if hasattr(unreal, 'PCGComponent') else None
    if not comp:
        print(json.dumps({"error": "Actor '{{actor}}' has no PCGComponent"}))
    else:
        warnings = []
        graph_info = {"name": None, "path": None}
        try:
            graph = comp.get_editor_property('graph')
            if graph:
                graph_info = {"name": graph.get_name(), "path": graph.get_path_name()}
        except Exception as e:
            warnings.append('graph: ' + str(e))

        seed = None
        try:
            seed = comp.get_editor_property('seed')
        except Exception as e:
            warnings.append('seed: ' + str(e))

        trigger = None
        try:
            trigger = str(comp.get_editor_property('generation_trigger'))
        except Exception as e:
            warnings.append('generation_trigger: ' + str(e))

        loc = target.get_actor_location()
        scale = target.get_actor_scale3d()
        result = {
            "success": True,
            "actor": target.get_actor_label(),
            "graph": graph_info,
            "seed": seed,
            "generation_trigger": trigger,
            "location": {"x": loc.x, "y": loc.y, "z": loc.z},
            "scale": {"x": scale.x, "y": scale.y, "z": scale.z},
        }
        if warnings:
            result["warnings"] = warnings
        print(json.dumps(result, indent=2))`,
				{ actor },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"get_pcg_graph_nodes",
		"List the nodes in a PCG Graph asset: index, title, settings class, editor position, and pin counts. Node indices can be used with connect_pcg_nodes / set_pcg_static_mesh_spawner_meshes. NOTE: not yet verified against a live editor — the exact Python reflection names for node title/position/pins may differ between UE versions; fields that fail to read come back as null with a note in `warnings` rather than failing the whole call.",
		{ graph_path: z.string().describe("PCG graph asset path") },
		{ readOnlyHint: true },
		async ({ graph_path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
graph = unreal.EditorAssetLibrary.load_asset('{{graph_path}}')
if not graph:
    print(json.dumps({"error": "PCG graph not found: {{graph_path}}"}))
else:
    warnings = []
    nodes = []
    try:
        nodes = graph.get_nodes()
    except Exception as e1:
        try:
            nodes = graph.get_editor_property('nodes')
        except Exception as e2:
            print(json.dumps({"error": "Could not read graph nodes (tried get_nodes() and get_editor_property('nodes')): " + str(e1) + ' / ' + str(e2)}))
            raise SystemExit()

    results = []
    for i, node in enumerate(nodes):
        entry = {"node_index": i}
        try:
            entry["node_title"] = node.get_name()
        except Exception as e:
            entry["node_title"] = None
            warnings.append(f"node {i} node_title: {e}")
        try:
            settings = node.get_settings()
            entry["settings_class"] = settings.get_class().get_name() if settings else "(none)"
        except Exception as e:
            entry["settings_class"] = None
            warnings.append(f"node {i} settings_class: {e}")
        try:
            entry["position_x"] = node.get_editor_property('position_x')
            entry["position_y"] = node.get_editor_property('position_y')
        except Exception as e:
            entry["position_x"] = None
            entry["position_y"] = None
            warnings.append(f"node {i} position: {e}")
        try:
            entry["input_pins"] = len(node.get_input_pins())
            entry["output_pins"] = len(node.get_output_pins())
        except Exception as e:
            entry["input_pins"] = None
            entry["output_pins"] = None
            warnings.append(f"node {i} pins: {e}")
        results.append(entry)

    result = {
        "success": True,
        "graph": graph.get_name(),
        "graph_path": '{{graph_path}}',
        "node_count": len(results),
        "nodes": results,
    }
    if warnings:
        result["warnings"] = warnings
    print(json.dumps(result, indent=2))`,
				{ graph_path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"connect_pcg_nodes",
		"Connect an output pin of one PCG node to an input pin of another, by index (from get_pcg_graph_nodes). Default pin labels 'Out'/'In' are used when omitted. NOT YET VERIFIED against a live editor — PCG pin/edge manipulation may require the optional C++ plugin rather than being reachable from Python; this returns a clear error rather than a false success if the underlying API isn't available.",
		{
			graph_path: z.string().describe("PCG graph asset path"),
			source_node_index: z
				.number()
				.int()
				.describe("Index of the source node (from get_pcg_graph_nodes)"),
			target_node_index: z
				.number()
				.int()
				.describe("Index of the target node (from get_pcg_graph_nodes)"),
			source_pin_label: z.string().default("Out").describe("Output pin label on the source node"),
			target_pin_label: z.string().default("In").describe("Input pin label on the target node"),
		},
		async ({
			graph_path,
			source_node_index,
			target_node_index,
			source_pin_label,
			target_pin_label,
		}) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
graph = unreal.EditorAssetLibrary.load_asset('{{graph_path}}')
if not graph:
    print(json.dumps({"error": "PCG graph not found: {{graph_path}}"}))
else:
    try:
        nodes = graph.get_nodes()
    except Exception:
        try:
            nodes = graph.get_editor_property('nodes')
        except Exception as e:
            print(json.dumps({"error": "Could not read graph nodes: " + str(e)}))
            raise SystemExit()

    src_idx = {{source_node_index}}
    tgt_idx = {{target_node_index}}
    if src_idx < 0 or src_idx >= len(nodes):
        print(json.dumps({"error": f"source_node_index {src_idx} out of range (graph has {len(nodes)} nodes)"}))
        raise SystemExit()
    if tgt_idx < 0 or tgt_idx >= len(nodes):
        print(json.dumps({"error": f"target_node_index {tgt_idx} out of range (graph has {len(nodes)} nodes)"}))
        raise SystemExit()

    source_node = nodes[src_idx]
    target_node = nodes[tgt_idx]
    source_label = '{{source_pin_label}}'
    target_label = '{{target_pin_label}}'

    try:
        out_pins = source_node.get_output_pins()
        in_pins = target_node.get_input_pins()
    except Exception as e:
        print(json.dumps({"error": "Could not read node pins — get_output_pins/get_input_pins may not be exposed to Python on this UE version: " + str(e)}))
        raise SystemExit()

    source_pin = None
    for p in out_pins:
        try:
            if str(p.get_editor_property('label')) == source_label:
                source_pin = p
                break
        except Exception:
            pass
    if not source_pin and out_pins:
        source_pin = out_pins[0]

    target_pin = None
    for p in in_pins:
        try:
            if str(p.get_editor_property('label')) == target_label:
                target_pin = p
                break
        except Exception:
            pass
    if not target_pin and in_pins:
        target_pin = in_pins[0]

    if not source_pin or not target_pin:
        print(json.dumps({"error": "Could not resolve a source/target pin on the given nodes. Check available pins with get_pcg_graph_nodes."}))
        raise SystemExit()

    try:
        connected = source_pin.add_edge_to(target_pin)
    except Exception as e:
        print(json.dumps({"error": "add_edge_to is not exposed to Python on this UE version, or failed: " + str(e)}))
        raise SystemExit()

    if not connected:
        print(json.dumps({"error": "Connection failed — pins may be incompatible or already connected"}))
    else:
        graph.mark_package_dirty()
        print(json.dumps({"success": True, "graph": graph.get_name(), "source_node_index": src_idx, "target_node_index": tgt_idx}))`,
				{
					graph_path,
					source_node_index,
					target_node_index,
					source_pin_label,
					target_pin_label,
				},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"set_pcg_static_mesh_spawner_meshes",
		"Assign one or more static meshes (equal weight) to a PCG Static Mesh Spawner node. NOT YET VERIFIED against a live editor — the weighted mesh selector's struct-array layout is guessed from the reference C++ implementation and may not match this UE version's Python bindings; returns a clear error rather than a false success if assignment fails.",
		{
			graph_path: z.string().describe("PCG graph asset path"),
			node_index: z
				.number()
				.int()
				.describe("Index of the Static Mesh Spawner node (from get_pcg_graph_nodes)"),
			mesh_paths: z.array(z.string()).min(1).describe("Static mesh asset paths to assign"),
		},
		async ({ graph_path, node_index, mesh_paths }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
graph = unreal.EditorAssetLibrary.load_asset('{{graph_path}}')
if not graph:
    print(json.dumps({"error": "PCG graph not found: {{graph_path}}"}))
else:
    try:
        nodes = graph.get_nodes()
    except Exception:
        try:
            nodes = graph.get_editor_property('nodes')
        except Exception as e:
            print(json.dumps({"error": "Could not read graph nodes: " + str(e)}))
            raise SystemExit()

    idx = {{node_index}}
    if idx < 0 or idx >= len(nodes):
        print(json.dumps({"error": f"node_index {idx} out of range (graph has {len(nodes)} nodes)"}))
        raise SystemExit()

    node = nodes[idx]
    try:
        settings = node.get_settings()
    except Exception as e:
        print(json.dumps({"error": "Could not read node settings: " + str(e)}))
        raise SystemExit()

    spawner_class = getattr(unreal, 'PCGStaticMeshSpawnerSettings', None)
    if not settings or not spawner_class or not isinstance(settings, spawner_class):
        actual = settings.get_class().get_name() if settings else "(none)"
        print(json.dumps({"error": f"Node {idx} is not a PCGStaticMeshSpawnerSettings node (actual: {actual})"}))
        raise SystemExit()

    mesh_paths = json.loads('{{mesh_paths_json}}')
    meshes = []
    for p in mesh_paths:
        mesh = unreal.EditorAssetLibrary.load_asset(p)
        if not mesh:
            print(json.dumps({"error": "Failed to load static mesh: " + p}))
            raise SystemExit()
        meshes.append(mesh)

    try:
        selector_class = unreal.PCGMeshSelectorWeighted
        entry_class = unreal.PCGMeshSelectorWeightedEntry
        selector = unreal.new_object(selector_class, outer=settings)
        entries = []
        for m in meshes:
            entry = unreal.new_object(entry_class, outer=selector)
            descriptor = entry.get_editor_property('descriptor')
            descriptor.set_editor_property('static_mesh', m)
            entry.set_editor_property('descriptor', descriptor)
            entry.set_editor_property('weight', 1)
            entries.append(entry)
        selector.set_editor_property('mesh_entries', entries)
        settings.set_editor_property('mesh_selector_parameters', selector)
        settings.set_editor_property('mesh_selector_type', selector_class)
        graph.mark_package_dirty()
        print(json.dumps({"success": True, "graph": graph.get_name(), "node_index": idx, "meshes": [m.get_name() for m in meshes]}))
    except Exception as e:
        print(json.dumps({"error": "Could not assign the mesh selector — the struct/property names guessed from the reference C++ implementation may not match this UE version's Python bindings: " + str(e)}))`,
				{ graph_path, node_index, mesh_paths_json: JSON.stringify(mesh_paths) },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);
}
