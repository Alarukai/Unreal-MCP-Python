import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";
import { inlineScript } from "../utils/template.js";

export function registerNiagaraTools(
	server: McpServer,
	manager: ConnectionManager,
	_config: UnrealMcpConfig,
): void {
	server.tool(
		"spawn_niagara_at_location",
		"Spawn a Niagara particle system at a world location.",
		{
			system_path: z.string().describe("Niagara system asset path"),
			location: z
				.object({ x: z.number(), y: z.number(), z: z.number() })
				.describe("World location"),
			rotation: z
				.object({ pitch: z.number(), yaw: z.number(), roll: z.number() })
				.default({ pitch: 0, yaw: 0, roll: 0 }),
			auto_destroy: z.boolean().default(true).describe("Auto-destroy when finished"),
		},
		async ({ system_path, location, rotation, auto_destroy }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
system = unreal.EditorAssetLibrary.load_asset('{{system_path}}')
if system:
    loc = unreal.Vector({{loc_x}}, {{loc_y}}, {{loc_z}})
    rot = unreal.Rotator({{rot_pitch}}, {{rot_yaw}}, {{rot_roll}})
    world = unreal.EditorLevelLibrary.get_editor_world()
    comp = unreal.NiagaraFunctionLibrary.spawn_system_at_location(world, system, loc, rot, unreal.Vector(1,1,1), {{auto_destroy}})
    if comp:
        print(json.dumps({"success": True, "component": comp.get_name()}))
    else:
        print(json.dumps({"error": "Failed to spawn Niagara system"}))
else:
    print(json.dumps({"error": "Niagara system not found: {{system_path}}"}))`,
				{
					system_path,
					loc_x: location.x,
					loc_y: location.y,
					loc_z: location.z,
					rot_pitch: rotation.pitch,
					rot_yaw: rotation.yaw,
					rot_roll: rotation.roll,
					auto_destroy: auto_destroy ? "True" : "False",
				},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"spawn_niagara_attached",
		"Spawn a Niagara system attached to an actor.",
		{
			system_path: z.string().describe("Niagara system asset path"),
			actor_name: z.string().describe("Actor name or label to attach to"),
		},
		async ({ system_path, actor_name }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
system = unreal.EditorAssetLibrary.load_asset('{{system_path}}')
if system:
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
    target = None
    for a in actors:
        if a.get_name() == '{{actor_name}}' or a.get_actor_label() == '{{actor_name}}':
            target = a
            break
    if target:
        comp = unreal.NiagaraFunctionLibrary.spawn_system_attached(
            system, target.root_component, '', unreal.Vector(0,0,0), unreal.Rotator(0,0,0),
            unreal.EAttachLocation.KEEP_RELATIVE_OFFSET, True
        )
        if comp:
            print(json.dumps({"success": True, "component": comp.get_name()}))
        else:
            print(json.dumps({"error": "Failed to attach Niagara system"}))
    else:
        print(json.dumps({"error": "Actor not found: {{actor_name}}"}))
else:
    print(json.dumps({"error": "Niagara system not found"}))`,
				{ system_path, actor_name },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"set_niagara_float",
		"Set a float parameter on a Niagara component.",
		{
			actor_name: z.string().describe("Actor with Niagara component"),
			parameter_name: z.string().describe("Parameter name"),
			value: z.number().describe("Float value"),
		},
		async ({ actor_name, parameter_name, value }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
for a in actors:
    if a.get_name() == '{{actor_name}}' or a.get_actor_label() == '{{actor_name}}':
        comps = a.get_components_by_class(unreal.NiagaraComponent)
        if comps:
            comps[0].set_niagara_variable_float('{{parameter_name}}', {{value}})
            print(json.dumps({"success": True}))
        else:
            print(json.dumps({"error": "No Niagara component found"}))
        break
else:
    print(json.dumps({"error": "Actor not found: {{actor_name}}"}))`,
				{ actor_name, parameter_name, value },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"set_niagara_vector",
		"Set a vector parameter on a Niagara component.",
		{
			actor_name: z.string().describe("Actor with Niagara component"),
			parameter_name: z.string().describe("Parameter name"),
			value: z.object({ x: z.number(), y: z.number(), z: z.number() }).describe("Vector value"),
		},
		async ({ actor_name, parameter_name, value }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
for a in actors:
    if a.get_name() == '{{actor_name}}' or a.get_actor_label() == '{{actor_name}}':
        comps = a.get_components_by_class(unreal.NiagaraComponent)
        if comps:
            comps[0].set_niagara_variable_vec3('{{parameter_name}}', unreal.Vector({{value_x}}, {{value_y}}, {{value_z}}))
            print(json.dumps({"success": True}))
        else:
            print(json.dumps({"error": "No Niagara component found"}))
        break
else:
    print(json.dumps({"error": "Actor not found: {{actor_name}}"}))`,
				{ actor_name, parameter_name, value_x: value.x, value_y: value.y, value_z: value.z },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"set_niagara_color",
		"Set a linear color parameter on a Niagara component.",
		{
			actor_name: z.string().describe("Actor with Niagara component"),
			parameter_name: z.string().describe("Parameter name"),
			value: z
				.object({ r: z.number(), g: z.number(), b: z.number(), a: z.number().default(1) })
				.describe("RGBA color (0-1)"),
		},
		async ({ actor_name, parameter_name, value }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
for a in actors:
    if a.get_name() == '{{actor_name}}' or a.get_actor_label() == '{{actor_name}}':
        comps = a.get_components_by_class(unreal.NiagaraComponent)
        if comps:
            comps[0].set_niagara_variable_linear_color('{{parameter_name}}', unreal.LinearColor({{value_r}}, {{value_g}}, {{value_b}}, {{value_a}}))
            print(json.dumps({"success": True}))
        else:
            print(json.dumps({"error": "No Niagara component found"}))
        break
else:
    print(json.dumps({"error": "Actor not found: {{actor_name}}"}))`,
				{
					actor_name,
					parameter_name,
					value_r: value.r,
					value_g: value.g,
					value_b: value.b,
					value_a: value.a,
				},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"set_niagara_bool",
		"Set a bool parameter on a Niagara component.",
		{
			actor_name: z.string().describe("Actor with Niagara component"),
			parameter_name: z.string().describe("Parameter name"),
			value: z.boolean().describe("Bool value"),
		},
		async ({ actor_name, parameter_name, value }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
for a in actors:
    if a.get_name() == '{{actor_name}}' or a.get_actor_label() == '{{actor_name}}':
        comps = a.get_components_by_class(unreal.NiagaraComponent)
        if comps:
            comps[0].set_variable_bool('{{parameter_name}}', {{value}})
            print(json.dumps({"success": True}))
        else:
            print(json.dumps({"error": "No Niagara component found"}))
        break
else:
    print(json.dumps({"error": "Actor not found: {{actor_name}}"}))`,
				{ actor_name, parameter_name, value: value ? "True" : "False" },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"reset_niagara_system",
		"Reset a Niagara system on an actor.",
		{
			actor_name: z.string().describe("Actor with Niagara component"),
		},
		async ({ actor_name }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
for a in actors:
    if a.get_name() == '{{actor_name}}' or a.get_actor_label() == '{{actor_name}}':
        comps = a.get_components_by_class(unreal.NiagaraComponent)
        if comps:
            comps[0].reset_system()
            print(json.dumps({"success": True}))
        else:
            print(json.dumps({"error": "No Niagara component found"}))
        break
else:
    print(json.dumps({"error": "Actor not found: {{actor_name}}"}))`,
				{ actor_name },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"reinit_niagara_system",
		"Reinitialize a Niagara system on an actor.",
		{
			actor_name: z.string().describe("Actor with Niagara component"),
		},
		async ({ actor_name }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
for a in actors:
    if a.get_name() == '{{actor_name}}' or a.get_actor_label() == '{{actor_name}}':
        comps = a.get_components_by_class(unreal.NiagaraComponent)
        if comps:
            comps[0].reinit_system()
            print(json.dumps({"success": True}))
        else:
            print(json.dumps({"error": "No Niagara component found"}))
        break
else:
    print(json.dumps({"error": "Actor not found: {{actor_name}}"}))`,
				{ actor_name },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"create_niagara_system",
		"Create a new, empty Niagara System asset.",
		{
			name: z.string().describe("Niagara system asset name"),
			path: z.string().default("/Game/FX").describe("Content directory to create in"),
		},
		async ({ name, path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
factory = unreal.NiagaraSystemFactoryNew()
asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
system = asset_tools.create_asset('{{name}}', '{{path}}', unreal.NiagaraSystem, factory)
if system:
    print(json.dumps({"success": True, "name": system.get_name(), "path": system.get_path_name()}))
else:
    print(json.dumps({"error": "Failed to create Niagara system"}))`,
				{ name, path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"read_niagara_system",
		"Read back a Niagara System's emitter handles (best-effort — NiagaraSystem's Python-exposed reflection surface is version-sensitive; fields that fail to read come back null rather than failing the whole call).",
		{ system_path: z.string().describe("Niagara system asset path") },
		{ readOnlyHint: true },
		async ({ system_path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
system = unreal.EditorAssetLibrary.load_asset('{{system_path}}')
if not system or not isinstance(system, unreal.NiagaraSystem):
    print(json.dumps({"error": "Niagara system not found: {{system_path}}"}))
else:
    emitters = []
    try:
        handles = system.get_editor_property('EmitterHandles')
    except Exception as e:
        handles = []
        print(json.dumps({"error": "Could not read EmitterHandles: " + str(e)}))
        raise SystemExit()
    for h in handles:
        entry = {}
        try:
            entry["name"] = str(h.get_editor_property('Name'))
        except Exception:
            entry["name"] = None
        try:
            entry["is_enabled"] = h.get_editor_property('bIsEnabled')
        except Exception:
            entry["is_enabled"] = None
        try:
            emitter = h.get_editor_property('Instance')
            entry["emitter"] = emitter.get_name() if emitter else None
        except Exception:
            entry["emitter"] = None
        emitters.append(entry)
    print(json.dumps({"success": True, "name": system.get_name(), "emitters": emitters}, indent=2))`,
				{ system_path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"add_niagara_emitter",
		"Add an existing Niagara Emitter asset to a Niagara System. Uses NiagaraEditorLibrary.add_emitter_to_system, which is version-sensitive — verify against your engine version if this errors.",
		{
			system_path: z.string().describe("Niagara system asset path"),
			emitter_path: z.string().describe("Niagara emitter asset path to add"),
		},
		async ({ system_path, emitter_path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
system = unreal.EditorAssetLibrary.load_asset('{{system_path}}')
emitter = unreal.EditorAssetLibrary.load_asset('{{emitter_path}}')
if not system or not isinstance(system, unreal.NiagaraSystem):
    print(json.dumps({"error": "Niagara system not found: {{system_path}}"}))
elif not emitter:
    print(json.dumps({"error": "Niagara emitter not found: {{emitter_path}}"}))
else:
    try:
        handle = unreal.NiagaraEditorLibrary.add_emitter_to_system(system, emitter)
        print(json.dumps({"success": True, "handle_added": handle is not None}))
    except Exception as e:
        print(json.dumps({"error": "add_emitter_to_system failed (API is engine-version-sensitive): " + str(e)}))`,
				{ system_path, emitter_path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);
}
