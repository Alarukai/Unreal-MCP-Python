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
}
