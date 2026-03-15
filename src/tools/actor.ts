import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";
import { inlineScript } from "../utils/template.js";

export function registerActorTools(
	server: McpServer,
	manager: ConnectionManager,
	_config: UnrealMcpConfig,
): void {
	server.tool(
		"list_actors",
		"List all actors in the current level, optionally filtered by class.",
		{
			class_filter: z
				.string()
				.optional()
				.describe("Filter by actor class (e.g., StaticMeshActor, PointLight)"),
			name_filter: z
				.string()
				.optional()
				.describe("Filter by name substring"),
		},
		async ({ class_filter, name_filter }) => {
			manager.requireEditor();
			const script = `import unreal
import json
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
results = []
for a in actors:
    name = a.get_name()
    cls = a.get_class().get_name()
    ${class_filter ? `if cls != '${class_filter}' and not cls.endswith('${class_filter}'): continue` : ""}
    ${name_filter ? `if '${name_filter}'.lower() not in name.lower(): continue` : ""}
    loc = a.get_actor_location()
    results.append({"name": name, "class": cls, "location": {"x": loc.x, "y": loc.y, "z": loc.z}})
print(json.dumps(results, indent=2))`;
			const result = await manager.python.execute(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"spawn_actor",
		"Spawn a new actor in the current level.",
		{
			actor_class: z
				.string()
				.describe("Actor class to spawn (e.g., StaticMeshActor, PointLight, CameraActor)"),
			label: z.string().optional().describe("Actor label in the editor"),
			location: z
				.object({ x: z.number(), y: z.number(), z: z.number() })
				.default({ x: 0, y: 0, z: 0 }),
			rotation: z
				.object({ pitch: z.number(), yaw: z.number(), roll: z.number() })
				.default({ pitch: 0, yaw: 0, roll: 0 }),
			scale: z
				.object({ x: z.number(), y: z.number(), z: z.number() })
				.optional()
				.describe("Actor scale (default: 1,1,1)"),
		},
		async ({ actor_class, label, location, rotation, scale }) => {
			manager.requireEditor();
			const scaleStr = scale
				? `actor.set_actor_scale3d(unreal.Vector(${scale.x}, ${scale.y}, ${scale.z}))`
				: "";
			const labelStr = label
				? `actor.set_actor_label('${label}')`
				: "";

			const script = `import unreal
import json
loc = unreal.Vector(${location.x}, ${location.y}, ${location.z})
rot = unreal.Rotator(${rotation.pitch}, ${rotation.yaw}, ${rotation.roll})
actor_class = unreal.EditorAssetLibrary.load_blueprint_class('/Script/Engine.${actor_class}') if not hasattr(unreal, '${actor_class}') else getattr(unreal, '${actor_class}')
subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
actor = unreal.EditorLevelLibrary.spawn_actor_from_class(actor_class, loc, rot)
if actor:
    ${scaleStr}
    ${labelStr}
    print(json.dumps({"success": True, "name": actor.get_name(), "label": actor.get_actor_label()}))
else:
    print(json.dumps({"error": "Failed to spawn actor of class ${actor_class}"}))`;
			const result = await manager.python.execute(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"delete_actor",
		"Delete an actor from the current level by name or label.",
		{
			name: z.string().describe("Actor name or label to delete"),
		},
		async ({ name }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
actors = subsys.get_all_level_actors()
deleted = False
for a in actors:
    if a.get_name() == '{{name}}' or a.get_actor_label() == '{{name}}':
        unreal.get_editor_subsystem(unreal.EditorActorSubsystem).destroy_actor(a)
        deleted = True
        break
print(json.dumps({"deleted": deleted, "name": "{{name}}"}))`,
				{ name },
			);
			const result = await manager.python.execute(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"get_actor_properties",
		"Get all properties of an actor by name.",
		{
			name: z.string().describe("Actor name or label"),
		},
		async ({ name }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
actors = subsys.get_all_level_actors()
for a in actors:
    if a.get_name() == '{{name}}' or a.get_actor_label() == '{{name}}':
        loc = a.get_actor_location()
        rot = a.get_actor_rotation()
        scale = a.get_actor_scale3d()
        result = {
            "name": a.get_name(),
            "label": a.get_actor_label(),
            "class": a.get_class().get_name(),
            "location": {"x": loc.x, "y": loc.y, "z": loc.z},
            "rotation": {"pitch": rot.pitch, "yaw": rot.yaw, "roll": rot.roll},
            "scale": {"x": scale.x, "y": scale.y, "z": scale.z},
            "hidden": a.is_hidden_ed(),
            "tags": [str(t) for t in a.tags]
        }
        print(json.dumps(result, indent=2))
        break
else:
    print(json.dumps({"error": "Actor not found: {{name}}"}))`,
				{ name },
			);
			const result = await manager.python.execute(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"set_actor_transform",
		"Set the location, rotation, and/or scale of an actor.",
		{
			name: z.string().describe("Actor name or label"),
			location: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional(),
			rotation: z
				.object({ pitch: z.number(), yaw: z.number(), roll: z.number() })
				.optional(),
			scale: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional(),
		},
		async ({ name, location, rotation, scale }) => {
			manager.requireEditor();
			const lines = [
				"import unreal",
				"import json",
				"subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)",
				"actors = subsys.get_all_level_actors()",
				"found = False",
				"for a in actors:",
				`    if a.get_name() == '${name}' or a.get_actor_label() == '${name}':`,
				"        found = True",
			];
			if (location) {
				lines.push(
					`        a.set_actor_location(unreal.Vector(${location.x}, ${location.y}, ${location.z}), False, False)`,
				);
			}
			if (rotation) {
				lines.push(
					`        a.set_actor_rotation(unreal.Rotator(${rotation.pitch}, ${rotation.yaw}, ${rotation.roll}), False)`,
				);
			}
			if (scale) {
				lines.push(
					`        a.set_actor_scale3d(unreal.Vector(${scale.x}, ${scale.y}, ${scale.z}))`,
				);
			}
			lines.push("        print(json.dumps({'success': True}))");
			lines.push("        break");
			lines.push("if not found:");
			lines.push(`    print(json.dumps({{'error': 'Actor not found: ${name}'}}))`);

			const result = await manager.python.execute(lines.join("\n"));
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"set_actor_property",
		"Set a property on an actor via the Remote Control API.",
		{
			actor_path: z
				.string()
				.describe("Full object path of the actor (e.g., /Game/Level.Level:PersistentLevel.MyActor)"),
			property_name: z.string().describe("Property name to set"),
			property_value: z.unknown().describe("Value to set"),
		},
		async ({ actor_path, property_name, property_value }) => {
			manager.requireEditor();
			await manager.rc.setProperty(actor_path, property_name, property_value);
			return {
				content: [
					{ type: "text", text: `Set ${property_name} on ${actor_path}` },
				],
			};
		},
	);

	server.tool(
		"get_actor_components",
		"List all components on an actor.",
		{
			name: z.string().describe("Actor name or label"),
		},
		async ({ name }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
actors = subsys.get_all_level_actors()
for a in actors:
    if a.get_name() == '{{name}}' or a.get_actor_label() == '{{name}}':
        comps = a.get_components_by_class(unreal.ActorComponent)
        result = [{"name": c.get_name(), "class": c.get_class().get_name()} for c in comps]
        print(json.dumps(result, indent=2))
        break
else:
    print(json.dumps({"error": "Actor not found: {{name}}"}))`,
				{ name },
			);
			const result = await manager.python.execute(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"select_actors",
		"Set the editor's actor selection.",
		{
			names: z.array(z.string()).describe("Actor names or labels to select"),
		},
		async ({ names }) => {
			manager.requireEditor();
			const nameList = names.map((n) => `'${n}'`).join(", ");
			const script = `import unreal
import json
target_names = [${nameList}]
subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
all_actors = subsys.get_all_level_actors()
to_select = []
for a in all_actors:
    if a.get_name() in target_names or a.get_actor_label() in target_names:
        to_select.append(a)
subsys.set_selected_level_actors(to_select)
print(json.dumps({"selected": len(to_select)}))`;
			const result = await manager.python.execute(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"duplicate_actors",
		"Duplicate actors by name.",
		{
			names: z.array(z.string()).describe("Actor names or labels to duplicate"),
			offset: z
				.object({ x: z.number(), y: z.number(), z: z.number() })
				.optional()
				.describe("Offset for duplicated actors"),
		},
		async ({ names, offset }) => {
			manager.requireEditor();
			const nameList = names.map((n) => `'${n}'`).join(", ");
			const offsetStr = offset
				? `unreal.Vector(${offset.x}, ${offset.y}, ${offset.z})`
				: "unreal.Vector(100, 0, 0)";
			const script = `import unreal
import json
target_names = [${nameList}]
subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
all_actors = subsys.get_all_level_actors()
duplicated = []
for a in all_actors:
    if a.get_name() in target_names or a.get_actor_label() in target_names:
        new_actors = subsys.duplicate_actors([a])
        for na in new_actors:
            loc = na.get_actor_location()
            offset = ${offsetStr}
            na.set_actor_location(unreal.Vector(loc.x + offset.x, loc.y + offset.y, loc.z + offset.z), False, False)
            duplicated.append(na.get_name())
print(json.dumps({"duplicated": duplicated}))`;
			const result = await manager.python.execute(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"set_actor_tags",
		"Set tags on an actor.",
		{
			name: z.string().describe("Actor name or label"),
			tags: z.array(z.string()).describe("Tags to set"),
		},
		async ({ name, tags }) => {
			manager.requireEditor();
			const tagList = tags.map((t) => `'${t}'`).join(", ");
			const script = inlineScript(
				`import unreal
import json
subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
actors = subsys.get_all_level_actors()
for a in actors:
    if a.get_name() == '{{name}}' or a.get_actor_label() == '{{name}}':
        a.tags = [unreal.Name(t) for t in [${tagList}]]
        print(json.dumps({"success": True}))
        break
else:
    print(json.dumps({"error": "Actor not found: {{name}}"}))`,
				{ name },
			);
			const result = await manager.python.execute(script);
			return { content: [{ type: "text", text: result }] };
		},
	);
}
