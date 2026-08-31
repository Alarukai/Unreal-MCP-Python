import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";
import { inlineScript } from "../utils/template.js";

const FIND_ACTOR = `actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
target = None
for a in actors:
    if a.get_name() == '{{actor}}' or a.get_actor_label() == '{{actor}}':
        target = a
        break`;

const TRACE_TYPE_MAP: Record<string, string> = {
	Visibility: "TRACE_TYPE_QUERY1",
	Camera: "TRACE_TYPE_QUERY2",
};
const TRACE_CHANNELS = Object.keys(TRACE_TYPE_MAP) as [string, ...string[]];

export function registerSpatialTools(
	server: McpServer,
	manager: ConnectionManager,
	_config: UnrealMcpConfig,
): void {
	server.tool(
		"get_actor_bounds",
		"Get an actor's world-space bounding box (origin, extent, min, max).",
		{ actor: z.string().describe("Actor name or label") },
		{ readOnlyHint: true },
		async ({ actor }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
${FIND_ACTOR}
if not target:
    print(json.dumps({"error": "Actor not found: {{actor}}"}))
else:
    origin, extent = target.get_actor_bounds(False)
    print(json.dumps({
        "success": True,
        "origin": {"x": origin.x, "y": origin.y, "z": origin.z},
        "extent": {"x": extent.x, "y": extent.y, "z": extent.z},
        "min": {"x": origin.x - extent.x, "y": origin.y - extent.y, "z": origin.z - extent.z},
        "max": {"x": origin.x + extent.x, "y": origin.y + extent.y, "z": origin.z + extent.z},
    }, indent=2))`,
				{ actor },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"line_trace",
		"Cast a ray from A to B and report what it hits. Useful for finding ground level, checking line of sight, or placing objects on surfaces.",
		{
			start: z.object({ x: z.number(), y: z.number(), z: z.number() }),
			end: z.object({ x: z.number(), y: z.number(), z: z.number() }),
			trace_channel: z.enum(TRACE_CHANNELS).default("Visibility"),
			ignore_actors: z.array(z.string()).default([]).describe("Actor labels to ignore"),
		},
		{ readOnlyHint: true },
		async ({ start, end, trace_channel, ignore_actors }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
start = unreal.Vector({{sx}}, {{sy}}, {{sz}})
end = unreal.Vector({{ex}}, {{ey}}, {{ez}})
trace_type = unreal.TraceTypeQuery.{{trace_type}}
ignore_names = json.loads('{{ignore_json}}')
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
ignore_actors = [a for a in actors if a.get_actor_label() in ignore_names or a.get_name() in ignore_names]
hit = unreal.SystemLibrary.line_trace_single(
    world, start, end,
    trace_type,
    False, ignore_actors,
    unreal.DrawDebugTrace.NONE, False
)
if not hit:
    print(json.dumps({"success": True, "hit": False, "trace_start": {"x": start.x, "y": start.y, "z": start.z}, "trace_end": {"x": end.x, "y": end.y, "z": end.z}}))
else:
    result = {"success": True, "hit": True}
    result["hit_location"] = {"x": hit.location.x, "y": hit.location.y, "z": hit.location.z}
    result["hit_normal"] = {"x": hit.normal.x, "y": hit.normal.y, "z": hit.normal.z}
    result["hit_distance"] = hit.distance
    if hit.hit_actor:
        result["hit_actor"] = hit.hit_actor.get_actor_label()
        result["hit_actor_class"] = hit.hit_actor.get_class().get_name()
    if hit.hit_component:
        result["hit_component"] = hit.hit_component.get_name()
    print(json.dumps(result, indent=2))`,
				{
					sx: start.x,
					sy: start.y,
					sz: start.z,
					ex: end.x,
					ey: end.y,
					ez: end.z,
					trace_type: TRACE_TYPE_MAP[trace_channel],
					ignore_json: JSON.stringify(ignore_actors),
				},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"overlap_test",
		"Test whether a box at a position overlaps any actors — either at an existing actor's current bounds, or at an arbitrary position/extent. Useful for collision-free placement checks.",
		{
			actor: z
				.string()
				.optional()
				.describe("Test at this actor's current bounds (mutually exclusive with center/extent)"),
			center: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional(),
			extent: z
				.object({ x: z.number(), y: z.number(), z: z.number() })
				.default({ x: 50, y: 50, z: 50 })
				.describe("Half-extent of the test box"),
		},
		{ readOnlyHint: true },
		async ({ actor, center, extent }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
actors = subsys.get_all_level_actors()
test_actor = None
actor_name = '{{actor}}'
if actor_name:
    for a in actors:
        if a.get_name() == actor_name or a.get_actor_label() == actor_name:
            test_actor = a
            break
    if not test_actor:
        print(json.dumps({"error": "Actor not found: " + actor_name}))
        raise SystemExit()
    center_v, extent_v = test_actor.get_actor_bounds(False)
else:
    center_v = unreal.Vector({{cx}}, {{cy}}, {{cz}})
    extent_v = unreal.Vector({{ex}}, {{ey}}, {{ez}})

ignore = [test_actor] if test_actor else []
overlapping = []
hit = unreal.SystemLibrary.box_overlap_actors(
    unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world(),
    center_v, extent_v,
    [unreal.ObjectTypeQuery.OBJECT_TYPE_QUERY1, unreal.ObjectTypeQuery.OBJECT_TYPE_QUERY2],
    None, ignore, overlapping
)
seen = set()
results = []
for a in overlapping:
    if a in seen:
        continue
    seen.add(a)
    results.append({"name": a.get_actor_label(), "class": a.get_class().get_name()})
print(json.dumps({
    "success": True,
    "has_overlap": len(results) > 0,
    "test_center": {"x": center_v.x, "y": center_v.y, "z": center_v.z},
    "test_extent": {"x": extent_v.x, "y": extent_v.y, "z": extent_v.z},
    "overlapping_actors": results,
    "overlap_count": len(results),
}, indent=2))`,
				{
					actor: actor || "",
					cx: center?.x ?? 0,
					cy: center?.y ?? 0,
					cz: center?.z ?? 0,
					ex: extent.x,
					ey: extent.y,
					ez: extent.z,
				},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"place_actor_on_ground",
		"Move an actor straight down until it rests on the surface below (via a downward line trace from its current position).",
		{
			actor: z.string().describe("Actor name or label"),
			trace_channel: z.enum(TRACE_CHANNELS).default("Visibility"),
			trace_height: z
				.number()
				.default(10000)
				.describe("How far above/below the actor to search for ground"),
		},
		async ({ actor, trace_channel, trace_height }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
${FIND_ACTOR}
if not target:
    print(json.dumps({"error": "Actor not found: {{actor}}"}))
else:
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    loc = target.get_actor_location()
    start = unreal.Vector(loc.x, loc.y, loc.z + {{trace_height}})
    end = unreal.Vector(loc.x, loc.y, loc.z - {{trace_height}})
    hit = unreal.SystemLibrary.line_trace_single(
        world, start, end,
        unreal.TraceTypeQuery.{{trace_type}},
        False, [target],
        unreal.DrawDebugTrace.NONE, False
    )
    if not hit:
        print(json.dumps({"error": "No ground found within trace_height of the actor's position"}))
    else:
        new_loc = unreal.Vector(hit.location.x, hit.location.y, hit.location.z)
        target.set_actor_location(new_loc, False, False)
        print(json.dumps({"success": True, "actor": target.get_actor_label(), "location": {"x": new_loc.x, "y": new_loc.y, "z": new_loc.z}}))`,
				{ actor, trace_height, trace_type: TRACE_TYPE_MAP[trace_channel] },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"measure_distance",
		"Measure the distance between two points, two actors, or an actor and a point.",
		{
			from_actor: z.string().optional().describe("First actor's location"),
			from_point: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional(),
			to_actor: z.string().optional().describe("Second actor's location"),
			to_point: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional(),
		},
		{ readOnlyHint: true },
		async ({ from_actor, from_point, to_actor, to_point }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()

def resolve(actor_name, has_point, x, y, z):
    if actor_name:
        for a in actors:
            if a.get_name() == actor_name or a.get_actor_label() == actor_name:
                return ('ok', a.get_actor_location())
        return ('actor_not_found', None)
    if has_point:
        return ('ok', unreal.Vector(x, y, z))
    return ('missing', None)

from_actor = '{{from_actor}}'
to_actor = '{{to_actor}}'
from_status, from_v = resolve(from_actor, {{has_from_point}}, {{fx}}, {{fy}}, {{fz}})
to_status, to_v = resolve(to_actor, {{has_to_point}}, {{tx}}, {{ty}}, {{tz}})
if from_status == 'actor_not_found':
    print(json.dumps({"error": "from_actor not found: " + from_actor}))
elif from_status == 'missing':
    print(json.dumps({"error": "Provide either from_actor or from_point"}))
elif to_status == 'actor_not_found':
    print(json.dumps({"error": "to_actor not found: " + to_actor}))
elif to_status == 'missing':
    print(json.dumps({"error": "Provide either to_actor or to_point"}))
else:
    dist = ((from_v.x - to_v.x) ** 2 + (from_v.y - to_v.y) ** 2 + (from_v.z - to_v.z) ** 2) ** 0.5
    dist_2d = ((from_v.x - to_v.x) ** 2 + (from_v.y - to_v.y) ** 2) ** 0.5
    print(json.dumps({
        "success": True,
        "distance": dist,
        "distance_2d": dist_2d,
        "from": {"x": from_v.x, "y": from_v.y, "z": from_v.z},
        "to": {"x": to_v.x, "y": to_v.y, "z": to_v.z},
    }, indent=2))`,
				{
					from_actor: from_actor || "",
					to_actor: to_actor || "",
					has_from_point: from_point ? "True" : "False",
					has_to_point: to_point ? "True" : "False",
					fx: from_point?.x ?? 0,
					fy: from_point?.y ?? 0,
					fz: from_point?.z ?? 0,
					tx: to_point?.x ?? 0,
					ty: to_point?.y ?? 0,
					tz: to_point?.z ?? 0,
				},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"get_spatial_context",
		"Analyze the spatial layout of the level around a point: scene bounds, nearest actors, actor density by quadrant, estimated ground level, and empty space pockets. Useful for deciding where to place new actors.",
		{
			center: z
				.object({ x: z.number(), y: z.number(), z: z.number() })
				.optional()
				.describe("Center of the analysis (default: the scene's own bounding-box center)"),
			radius: z.number().default(5000).describe("Radius (cm) around the center to analyze"),
		},
		{ readOnlyHint: true },
		async ({ center, radius }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json

world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
radius = {{radius}}

scene_min = None
scene_max = None
smallest_extent = None
largest_extent = None
bounded = []
for a in actors:
    if isinstance(a, unreal.Brush) or a.is_hidden_ed():
        continue
    origin, extent = a.get_actor_bounds(False)
    if extent.size() < 0.01:
        continue
    a_min = unreal.Vector(origin.x - extent.x, origin.y - extent.y, origin.z - extent.z)
    a_max = unreal.Vector(origin.x + extent.x, origin.y + extent.y, origin.z + extent.z)
    scene_min = a_min if scene_min is None else unreal.Vector(min(scene_min.x, a_min.x), min(scene_min.y, a_min.y), min(scene_min.z, a_min.z))
    scene_max = a_max if scene_max is None else unreal.Vector(max(scene_max.x, a_max.x), max(scene_max.y, a_max.y), max(scene_max.z, a_max.z))
    smallest_extent = extent.size() if smallest_extent is None else min(smallest_extent, extent.size())
    largest_extent = extent.size() if largest_extent is None else max(largest_extent, extent.size())
    bounded.append({"actor": a, "location": a.get_actor_location(), "extent": extent})

if scene_min is None:
    print(json.dumps({"error": "No boundable actors found in the level"}))
    raise SystemExit()

scene_size = unreal.Vector(scene_max.x - scene_min.x, scene_max.y - scene_min.y, scene_max.z - scene_min.z)
scene_center = unreal.Vector((scene_min.x + scene_max.x) * 0.5, (scene_min.y + scene_max.y) * 0.5, (scene_min.z + scene_max.z) * 0.5)

has_center = {{has_center}}
center = unreal.Vector({{cx}}, {{cy}}, {{cz}}) if has_center else scene_center

def dist(v):
    return ((v.x - center.x) ** 2 + (v.y - center.y) ** 2 + (v.z - center.z) ** 2) ** 0.5

in_radius = [b for b in bounded if dist(b["location"]) <= radius]
in_radius.sort(key=lambda b: dist(b["location"]))

nearest = []
for b in in_radius[:10]:
    loc = b["location"]
    ext = b["extent"]
    nearest.append({
        "name": b["actor"].get_actor_label(),
        "class": b["actor"].get_class().get_name(),
        "distance": dist(loc),
        "position": {"x": loc.x, "y": loc.y, "z": loc.z},
        "bounds_size": {"x": ext.x * 2, "y": ext.y * 2, "z": ext.z * 2},
    })

quadrants = {"ne": 0, "nw": 0, "se": 0, "sw": 0}
for b in in_radius:
    loc = b["location"]
    east = loc.x >= center.x
    north = loc.y >= center.y
    if east and north:
        quadrants["ne"] += 1
    elif not east and north:
        quadrants["nw"] += 1
    elif east and not north:
        quadrants["se"] += 1
    else:
        quadrants["sw"] += 1
densest = max(quadrants, key=quadrants.get)
emptiest = min(quadrants, key=quadrants.get)

trace_offsets = [
    (0.0, 0.0),
    (radius * 0.5, 0.0),
    (-radius * 0.5, 0.0),
    (0.0, radius * 0.5),
    (0.0, -radius * 0.5),
]
ground_sum = 0.0
ground_hits = 0
for ox, oy in trace_offsets:
    start = unreal.Vector(center.x + ox, center.y + oy, scene_max.z + 1000.0)
    end = unreal.Vector(center.x + ox, center.y + oy, scene_min.z - 1000.0)
    hit = unreal.SystemLibrary.line_trace_single(
        world, start, end,
        unreal.TraceTypeQuery.TRACE_TYPE_QUERY1,
        False, [], unreal.DrawDebugTrace.NONE, False
    )
    if hit:
        ground_sum += hit.location.z
        ground_hits += 1

cell_size = radius * 0.5
empty_spaces = []
for gx in (-1, 0, 1):
    for gy in (-1, 0, 1):
        cell_center = unreal.Vector(center.x + gx * cell_size, center.y + gy * cell_size, center.z)
        occupied = False
        for b in bounded:
            loc = b["location"]
            if abs(loc.x - cell_center.x) <= cell_size * 0.5 and abs(loc.y - cell_center.y) <= cell_size * 0.5:
                occupied = True
                break
        if not occupied:
            empty_spaces.append({
                "center": {"x": cell_center.x, "y": cell_center.y, "z": cell_center.z},
                "approximate_size": {"x": cell_size, "y": cell_size},
            })

bounding_summary = {
    "smallest_actor_extent": smallest_extent,
    "largest_actor_extent": largest_extent,
}
if len(in_radius) >= 2:
    max_pairs = min(len(in_radius), 20)
    spacing_sum = 0.0
    spacing_count = 0
    for i in range(max_pairs):
        min_dist = None
        for j in range(len(in_radius)):
            if i == j:
                continue
            li = in_radius[i]["location"]
            lj = in_radius[j]["location"]
            d = ((li.x - lj.x) ** 2 + (li.y - lj.y) ** 2 + (li.z - lj.z) ** 2) ** 0.5
            if min_dist is None or d < min_dist:
                min_dist = d
        if min_dist is not None:
            spacing_sum += min_dist
            spacing_count += 1
    if spacing_count > 0:
        bounding_summary["average_nearest_spacing"] = spacing_sum / spacing_count

result = {
    "success": True,
    "scene_bounds": {
        "min": {"x": scene_min.x, "y": scene_min.y, "z": scene_min.z},
        "max": {"x": scene_max.x, "y": scene_max.y, "z": scene_max.z},
        "size": {"x": scene_size.x, "y": scene_size.y, "z": scene_size.z},
        "center": {"x": scene_center.x, "y": scene_center.y, "z": scene_center.z},
    },
    "total_actor_count": len(actors),
    "actors_in_radius": len(in_radius),
    "analysis_center": {"x": center.x, "y": center.y, "z": center.z},
    "analysis_radius": radius,
    "nearest_actors": nearest,
    "density_map": {"ne": quadrants["ne"], "nw": quadrants["nw"], "se": quadrants["se"], "sw": quadrants["sw"], "densest_quadrant": densest, "emptiest_quadrant": emptiest},
    "empty_spaces": empty_spaces,
    "bounding_summary": bounding_summary,
}
if ground_hits > 0:
    result["ground_level_z"] = ground_sum / ground_hits
print(json.dumps(result, indent=2))`,
				{
					has_center: center ? "True" : "False",
					cx: center?.x ?? 0,
					cy: center?.y ?? 0,
					cz: center?.z ?? 0,
					radius,
				},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);
}
