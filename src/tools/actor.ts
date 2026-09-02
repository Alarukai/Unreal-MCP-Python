import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";
import { escapePythonArray, inlineScript } from "../utils/template.js";

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
			name_filter: z.string().optional().describe("Filter by name substring"),
		},
		{ readOnlyHint: true },
		async ({ class_filter, name_filter }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
class_filter = '{{class_filter}}'
name_filter = '{{name_filter}}'
results = []
for a in actors:
    name = a.get_name()
    cls = a.get_class().get_name()
    if class_filter and cls != class_filter and not cls.endswith(class_filter):
        continue
    if name_filter and name_filter.lower() not in name.lower():
        continue
    loc = a.get_actor_location()
    results.append({"name": name, "class": cls, "location": {"x": loc.x, "y": loc.y, "z": loc.z}})
print(json.dumps(results, indent=2))`,
				{ class_filter: class_filter || "", name_filter: name_filter || "" },
			);
			const result = await manager.runPython(script);
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
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
loc = unreal.Vector({{loc_x}}, {{loc_y}}, {{loc_z}})
rot = unreal.Rotator({{rot_pitch}}, {{rot_yaw}}, {{rot_roll}})
actor_class_name = '{{actor_class}}'
if hasattr(unreal, actor_class_name):
    actor_class = getattr(unreal, actor_class_name)
else:
    actor_class = unreal.EditorAssetLibrary.load_asset('/Script/Engine.' + actor_class_name)
    if actor_class:
        actor_class = actor_class.generated_class() if hasattr(actor_class, 'generated_class') else actor_class
if actor_class:
    actor = unreal.EditorLevelLibrary.spawn_actor_from_class(actor_class, loc, rot)
    if actor:
        label = '{{label}}'
        if label:
            actor.set_actor_label(label)
        do_scale = {{do_scale}}
        if do_scale:
            actor.set_actor_scale3d(unreal.Vector({{scale_x}}, {{scale_y}}, {{scale_z}}))
        print(json.dumps({"success": True, "name": actor.get_name(), "label": actor.get_actor_label()}))
    else:
        print(json.dumps({"error": "Failed to spawn actor of class " + actor_class_name}))
else:
    print(json.dumps({"error": "Actor class not found: " + actor_class_name}))`,
				{
					actor_class,
					label: label || "",
					loc_x: location.x,
					loc_y: location.y,
					loc_z: location.z,
					rot_pitch: rotation.pitch,
					rot_yaw: rotation.yaw,
					rot_roll: rotation.roll,
					do_scale: scale ? "True" : "False",
					scale_x: scale?.x ?? 1,
					scale_y: scale?.y ?? 1,
					scale_z: scale?.z ?? 1,
				},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"delete_actor",
		"Delete an actor from the current level by name or label.",
		{
			name: z.string().describe("Actor name or label to delete"),
		},
		{ destructiveHint: true },
		async ({ name }) => {
			await manager.requireEditor();
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
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"get_actor_properties",
		"Get all properties of an actor by name.",
		{
			name: z.string().describe("Actor name or label"),
		},
		{ readOnlyHint: true },
		async ({ name }) => {
			await manager.requireEditor();
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
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"set_actor_transform",
		"Set the location, rotation, and/or scale of an actor.",
		{
			name: z.string().describe("Actor name or label"),
			location: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional(),
			rotation: z.object({ pitch: z.number(), yaw: z.number(), roll: z.number() }).optional(),
			scale: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional(),
		},
		async ({ name, location, rotation, scale }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
actors = subsys.get_all_level_actors()
found = False
for a in actors:
    if a.get_name() == '{{name}}' or a.get_actor_label() == '{{name}}':
        found = True
        do_loc = {{do_loc}}
        do_rot = {{do_rot}}
        do_scale = {{do_scale}}
        if do_loc:
            a.set_actor_location(unreal.Vector({{loc_x}}, {{loc_y}}, {{loc_z}}), False, False)
        if do_rot:
            a.set_actor_rotation(unreal.Rotator({{rot_pitch}}, {{rot_yaw}}, {{rot_roll}}), False)
        if do_scale:
            a.set_actor_scale3d(unreal.Vector({{scale_x}}, {{scale_y}}, {{scale_z}}))
        print(json.dumps({"success": True}))
        break
if not found:
    print(json.dumps({"error": "Actor not found: {{name}}"}))`,
				{
					name,
					do_loc: location ? "True" : "False",
					do_rot: rotation ? "True" : "False",
					do_scale: scale ? "True" : "False",
					loc_x: location?.x ?? 0,
					loc_y: location?.y ?? 0,
					loc_z: location?.z ?? 0,
					rot_pitch: rotation?.pitch ?? 0,
					rot_yaw: rotation?.yaw ?? 0,
					rot_roll: rotation?.roll ?? 0,
					scale_x: scale?.x ?? 1,
					scale_y: scale?.y ?? 1,
					scale_z: scale?.z ?? 1,
				},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"set_actor_property",
		"Set a property on an actor via the Remote Control API.",
		{
			actor_path: z
				.string()
				.describe(
					"Full object path of the actor (e.g., /Game/Level.Level:PersistentLevel.MyActor)",
				),
			property_name: z.string().describe("Property name to set"),
			property_value: z.unknown().describe("Value to set"),
		},
		async ({ actor_path, property_name, property_value }) => {
			await manager.requireEditor();
			await manager.rc.setProperty(actor_path, property_name, property_value);
			return {
				content: [{ type: "text", text: `Set ${property_name} on ${actor_path}` }],
			};
		},
	);

	server.tool(
		"get_actor_components",
		"List all components on an actor.",
		{
			name: z.string().describe("Actor name or label"),
		},
		{ readOnlyHint: true },
		async ({ name }) => {
			await manager.requireEditor();
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
			const result = await manager.runPython(script);
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
			await manager.requireEditor();
			const namesJson = JSON.stringify(names);
			const script = inlineScript(
				`import unreal
import json
target_names = json.loads('{{names_json}}')
subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
all_actors = subsys.get_all_level_actors()
to_select = []
for a in all_actors:
    if a.get_name() in target_names or a.get_actor_label() in target_names:
        to_select.append(a)
subsys.set_selected_level_actors(to_select)
print(json.dumps({"selected": len(to_select)}))`,
				{ names_json: namesJson },
			);
			const result = await manager.runPython(script);
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
			await manager.requireEditor();
			const namesJson = JSON.stringify(names);
			const script = inlineScript(
				`import unreal
import json
target_names = json.loads('{{names_json}}')
subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
all_actors = subsys.get_all_level_actors()
offset_vec = unreal.Vector({{off_x}}, {{off_y}}, {{off_z}})
duplicated = []
for a in all_actors:
    if a.get_name() in target_names or a.get_actor_label() in target_names:
        new_actors = subsys.duplicate_actors([a])
        for na in new_actors:
            loc = na.get_actor_location()
            na.set_actor_location(unreal.Vector(loc.x + offset_vec.x, loc.y + offset_vec.y, loc.z + offset_vec.z), False, False)
            duplicated.append(na.get_name())
print(json.dumps({"duplicated": duplicated}))`,
				{
					names_json: namesJson,
					off_x: offset?.x ?? 100,
					off_y: offset?.y ?? 0,
					off_z: offset?.z ?? 0,
				},
			);
			const result = await manager.runPython(script);
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
			await manager.requireEditor();
			const tagsJson = JSON.stringify(tags);
			const script = inlineScript(
				`import unreal
import json
subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
actors = subsys.get_all_level_actors()
tag_list = json.loads('{{tags_json}}')
for a in actors:
    if a.get_name() == '{{name}}' or a.get_actor_label() == '{{name}}':
        a.tags = [unreal.Name(t) for t in tag_list]
        print(json.dumps({"success": True}))
        break
else:
    print(json.dumps({"error": "Actor not found: {{name}}"}))`,
				{ name, tags_json: tagsJson },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"attach_actor_to_actor",
		"Attach an actor to a parent actor (component-level attachment via AActor.attach_to_actor).",
		{
			actor: z.string().describe("Actor name or label to attach"),
			parent: z.string().describe("Parent actor name or label"),
			socket_name: z
				.string()
				.optional()
				.describe("Socket on the parent's root component to attach to"),
			keep_world_transform: z
				.boolean()
				.default(false)
				.describe("Keep world transform on attach (default: snap to parent-relative)"),
		},
		async ({ actor, parent, socket_name, keep_world_transform }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
child = None
parent_actor = None
for a in actors:
    if a.get_name() == '{{actor}}' or a.get_actor_label() == '{{actor}}':
        child = a
    if a.get_name() == '{{parent}}' or a.get_actor_label() == '{{parent}}':
        parent_actor = a
if not child or not parent_actor:
    print(json.dumps({"error": "Could not find both actors", "actor_found": child is not None, "parent_found": parent_actor is not None}))
else:
    rule = unreal.AttachmentRule.KEEP_WORLD if {{keep_world_transform}} else unreal.AttachmentRule.SNAP_TO_TARGET
    socket = '{{socket_name}}'
    child.attach_to_actor(parent_actor, unreal.Name(socket) if socket else unreal.Name(''), rule, rule, rule, False)
    print(json.dumps({"success": True, "actor": child.get_name(), "parent": parent_actor.get_name()}))`,
				{
					actor,
					parent,
					socket_name: socket_name || "",
					keep_world_transform: keep_world_transform ? "True" : "False",
				},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"detach_actor",
		"Detach an actor from its current parent, keeping its world transform.",
		{ actor: z.string().describe("Actor name or label to detach") },
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
    target.detach_from_actor(unreal.DetachmentRule.KEEP_WORLD, unreal.DetachmentRule.KEEP_WORLD, unreal.DetachmentRule.KEEP_WORLD)
    print(json.dumps({"success": True, "actor": target.get_name()}))`,
				{ actor },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"rename_actor",
		"Rename an actor's editor label (the name shown in the World Outliner). Does not change the internal object name.",
		{
			actor: z.string().describe("Actor name or label to rename"),
			new_label: z.string().describe("New actor label"),
		},
		async ({ actor, new_label }) => {
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
    target.set_actor_label('{{new_label}}')
    print(json.dumps({"success": True, "actor": target.get_name(), "label": target.get_actor_label()}))`,
				{ actor, new_label },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);
}
