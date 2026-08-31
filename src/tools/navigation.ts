import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";
import { inlineScript } from "../utils/template.js";

export function registerNavigationTools(
	server: McpServer,
	manager: ConnectionManager,
	_config: UnrealMcpConfig,
): void {
	server.tool(
		"build_navigation",
		"Rebuild the level's navigation mesh (NavMesh) via the 'buildpaths' console command. Required after moving/adding geometry a NavMeshBoundsVolume covers before pathfinding will reflect the change.",
		{},
		async () => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
unreal.SystemLibrary.execute_console_command(world, 'buildpaths')
print(json.dumps({"success": True, "note": "Navigation build queued via 'buildpaths' console command. This is async in the editor; check read_log or take_screenshot to confirm completion."}))`,
				{},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"query_navigation_path",
		"Find a navigable path between two world locations using the NavigationSystemV1. Returns the path points if reachable, or an error if no path exists (e.g. no NavMesh built, or points outside navigable bounds).",
		{
			start: z.object({ x: z.number(), y: z.number(), z: z.number() }).describe("Start location"),
			end: z.object({ x: z.number(), y: z.number(), z: z.number() }).describe("End location"),
		},
		{ readOnlyHint: true },
		async ({ start, end }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
nav_sys = unreal.NavigationSystemV1.get_navigation_system(world)
if not nav_sys:
    print(json.dumps({"error": "No NavigationSystemV1 available in this world"}))
else:
    start_loc = unreal.Vector({{start_x}}, {{start_y}}, {{start_z}})
    end_loc = unreal.Vector({{end_x}}, {{end_y}}, {{end_z}})
    path = nav_sys.find_path_to_location_synchronously(world, start_loc, end_loc)
    if not path:
        print(json.dumps({"error": "Pathfinding call failed (no NavigationSystemV1 result)"}))
    else:
        is_valid = path.is_valid()
        is_partial = path.is_partial()
        points = [{"x": p.x, "y": p.y, "z": p.z} for p in path.path_points]
        print(json.dumps({"success": is_valid, "partial": is_partial, "points": points}, indent=2))`,
				{
					start_x: start.x,
					start_y: start.y,
					start_z: start.z,
					end_x: end.x,
					end_y: end.y,
					end_z: end.z,
				},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"get_navigation_info",
		"Get info about NavMeshBoundsVolume actors in the level and whether a NavigationSystemV1 is present.",
		{},
		{ readOnlyHint: true },
		async () => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
nav_sys = unreal.NavigationSystemV1.get_navigation_system(world)
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
volumes = []
for a in actors:
    if isinstance(a, unreal.NavMeshBoundsVolume):
        origin, extent = a.get_actor_bounds(False)
        volumes.append({
            "name": a.get_actor_label(),
            "origin": {"x": origin.x, "y": origin.y, "z": origin.z},
            "extent": {"x": extent.x, "y": extent.y, "z": extent.z},
        })
print(json.dumps({"has_navigation_system": nav_sys is not None, "nav_bounds_volumes": volumes}, indent=2))`,
				{},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);
}
