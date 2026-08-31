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

/**
 * Register a try_set(prop, value) Python helper that applies a property via
 * set_editor_property, recording successes/failures instead of aborting the
 * whole call on one bad property name — struct/property names vary across
 * engine versions and light/actor subtypes.
 */
const TRY_SET_HELPER = `applied = []
warnings = []
def try_set(target_obj, prop, value):
    try:
        target_obj.set_editor_property(prop, value)
        applied.append(prop)
    except Exception as e:
        warnings.append(prop + ': ' + str(e))`;

export function registerEnvironmentTools(
	server: McpServer,
	manager: ConnectionManager,
	_config: UnrealMcpConfig,
): void {
	// ── Lighting ──────────────────────────────────────────────────────
	server.tool(
		"set_light_properties",
		"Set properties on an actor's light component: intensity, color, temperature, shadows, radius, cone angles. Unset fields are left unchanged. Property names are set via reflection (set_editor_property) and vary slightly by light type (Point/Spot/Directional/Rect) — unsupported properties for a given light type are reported in `warnings`, not treated as a failure.",
		{
			actor: z.string().describe("Actor name or label with a light component"),
			intensity: z.number().optional(),
			color: z
				.object({ r: z.number(), g: z.number(), b: z.number() })
				.optional()
				.describe("0-255 per channel"),
			temperature_kelvin: z.number().optional().describe("Enables bUseTemperature"),
			cast_shadows: z.boolean().optional(),
			source_radius: z.number().optional(),
			attenuation_radius: z.number().optional(),
			inner_cone_angle: z.number().optional().describe("Spot lights only"),
			outer_cone_angle: z.number().optional().describe("Spot lights only"),
		},
		async ({
			actor,
			intensity,
			color,
			temperature_kelvin,
			cast_shadows,
			source_radius,
			attenuation_radius,
			inner_cone_angle,
			outer_cone_angle,
		}) => {
			await manager.requireEditor();
			const calls: string[] = [];
			const vars: Record<string, string | number | boolean> = { actor };
			if (intensity !== undefined) {
				calls.push("try_set(light_comp, 'Intensity', {{intensity}})");
				vars.intensity = intensity;
			}
			if (color) {
				calls.push(
					"try_set(light_comp, 'LightColor', unreal.Color({{color_r}}, {{color_g}}, {{color_b}}))",
				);
				vars.color_r = color.r;
				vars.color_g = color.g;
				vars.color_b = color.b;
			}
			if (temperature_kelvin !== undefined) {
				calls.push("try_set(light_comp, 'bUseTemperature', True)");
				calls.push("try_set(light_comp, 'Temperature', {{temperature_kelvin}})");
				vars.temperature_kelvin = temperature_kelvin;
			}
			if (cast_shadows !== undefined) {
				calls.push("try_set(light_comp, 'CastShadows', {{cast_shadows}})");
				vars.cast_shadows = cast_shadows ? "True" : "False";
			}
			if (source_radius !== undefined) {
				calls.push("try_set(light_comp, 'SourceRadius', {{source_radius}})");
				vars.source_radius = source_radius;
			}
			if (attenuation_radius !== undefined) {
				calls.push("try_set(light_comp, 'AttenuationRadius', {{attenuation_radius}})");
				vars.attenuation_radius = attenuation_radius;
			}
			if (inner_cone_angle !== undefined) {
				calls.push("try_set(light_comp, 'InnerConeAngle', {{inner_cone_angle}})");
				vars.inner_cone_angle = inner_cone_angle;
			}
			if (outer_cone_angle !== undefined) {
				calls.push("try_set(light_comp, 'OuterConeAngle', {{outer_cone_angle}})");
				vars.outer_cone_angle = outer_cone_angle;
			}
			const script = inlineScript(
				`import unreal
import json
${FIND_ACTOR}
if not target:
    print(json.dumps({"error": "Actor not found: {{actor}}"}))
else:
    light_comp = target.get_component_by_class(unreal.LightComponent)
    if not light_comp:
        print(json.dumps({"error": "Actor has no LightComponent: {{actor}}"}))
    else:
        ${TRY_SET_HELPER.split("\n").join("\n        ")}
${calls.map((c) => `        ${c}`).join("\n")}
        print(json.dumps({"success": True, "applied": applied, "warnings": warnings}, indent=2))`,
				vars,
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	// ── Fog ───────────────────────────────────────────────────────────
	server.tool(
		"set_fog",
		"Configure an ExponentialHeightFog actor's density, height falloff, start distance, and volumetric fog. If `actor` is omitted, the first ExponentialHeightFog found in the level is used.",
		{
			actor: z.string().optional().describe("Actor name/label; omit to use the first found"),
			density: z.number().optional(),
			height_falloff: z.number().optional(),
			start_distance: z.number().optional(),
			volumetric: z.boolean().optional(),
		},
		async ({ actor, density, height_falloff, start_distance, volumetric }) => {
			await manager.requireEditor();
			const calls: string[] = [];
			const vars: Record<string, string | number | boolean> = { actor: actor || "" };
			if (density !== undefined) {
				calls.push("try_set(fog_comp, 'FogDensity', {{density}})");
				vars.density = density;
			}
			if (height_falloff !== undefined) {
				calls.push("try_set(fog_comp, 'FogHeightFalloff', {{height_falloff}})");
				vars.height_falloff = height_falloff;
			}
			if (start_distance !== undefined) {
				calls.push("try_set(fog_comp, 'StartDistance', {{start_distance}})");
				vars.start_distance = start_distance;
			}
			if (volumetric !== undefined) {
				calls.push("try_set(fog_comp, 'bEnableVolumetricFog', {{volumetric}})");
				vars.volumetric = volumetric ? "True" : "False";
			}
			const script = inlineScript(
				`import unreal
import json
actor_filter = '{{actor}}'
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
target = None
if actor_filter:
    for a in actors:
        if a.get_name() == actor_filter or a.get_actor_label() == actor_filter:
            target = a
            break
else:
    for a in actors:
        if isinstance(a, unreal.ExponentialHeightFog):
            target = a
            break
if not target:
    print(json.dumps({"error": "ExponentialHeightFog actor not found" + (" : " + actor_filter if actor_filter else "")}))
else:
    fog_comp = target.get_component_by_class(unreal.ExponentialHeightFogComponent)
    if not fog_comp:
        print(json.dumps({"error": "Actor has no ExponentialHeightFogComponent"}))
    else:
        ${TRY_SET_HELPER.split("\n").join("\n        ")}
${calls.map((c) => `        ${c}`).join("\n")}
        print(json.dumps({"success": True, "actor": target.get_actor_label(), "applied": applied, "warnings": warnings}, indent=2))`,
				vars,
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	// ── Post Process ──────────────────────────────────────────────────
	server.tool(
		"set_post_process",
		"Configure a PostProcessVolume's settings: bloom, exposure, vignette, saturation, contrast, infinite extent. If `actor` is omitted, the first PostProcessVolume found in the level is used. saturation/contrast apply uniformly to R/G/B (the underlying FPostProcessSettings fields are per-channel vectors).",
		{
			actor: z.string().optional().describe("Actor name/label; omit to use the first found"),
			bloom_intensity: z.number().optional(),
			auto_exposure_min: z.number().optional(),
			auto_exposure_max: z.number().optional(),
			vignette_intensity: z.number().optional(),
			saturation: z.number().optional(),
			contrast: z.number().optional(),
			infinite_extent: z.boolean().optional(),
		},
		async ({
			actor,
			bloom_intensity,
			auto_exposure_min,
			auto_exposure_max,
			vignette_intensity,
			saturation,
			contrast,
			infinite_extent,
		}) => {
			await manager.requireEditor();
			const calls: string[] = [];
			const vars: Record<string, string | number | boolean> = { actor: actor || "" };
			if (bloom_intensity !== undefined) {
				calls.push("try_set(settings, 'BloomIntensity', {{bloom_intensity}})");
				vars.bloom_intensity = bloom_intensity;
			}
			if (auto_exposure_min !== undefined) {
				calls.push("try_set(settings, 'AutoExposureMinBrightness', {{auto_exposure_min}})");
				vars.auto_exposure_min = auto_exposure_min;
			}
			if (auto_exposure_max !== undefined) {
				calls.push("try_set(settings, 'AutoExposureMaxBrightness', {{auto_exposure_max}})");
				vars.auto_exposure_max = auto_exposure_max;
			}
			if (vignette_intensity !== undefined) {
				calls.push("try_set(settings, 'VignetteIntensity', {{vignette_intensity}})");
				vars.vignette_intensity = vignette_intensity;
			}
			if (saturation !== undefined) {
				calls.push(
					"try_set(settings, 'ColorSaturation', unreal.Vector4({{saturation}}, {{saturation}}, {{saturation}}, 1.0))",
				);
				vars.saturation = saturation;
			}
			if (contrast !== undefined) {
				calls.push(
					"try_set(settings, 'ColorContrast', unreal.Vector4({{contrast}}, {{contrast}}, {{contrast}}, 1.0))",
				);
				vars.contrast = contrast;
			}
			if (infinite_extent !== undefined) {
				calls.push("try_set(target, 'bUnbound', {{infinite_extent}})");
				vars.infinite_extent = infinite_extent ? "True" : "False";
			}
			const script = inlineScript(
				`import unreal
import json
actor_filter = '{{actor}}'
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
target = None
if actor_filter:
    for a in actors:
        if a.get_name() == actor_filter or a.get_actor_label() == actor_filter:
            target = a
            break
else:
    for a in actors:
        if isinstance(a, unreal.PostProcessVolume):
            target = a
            break
if not target:
    print(json.dumps({"error": "PostProcessVolume actor not found" + (" : " + actor_filter if actor_filter else "")}))
else:
    settings = target.get_editor_property('Settings')
    ${TRY_SET_HELPER.split("\n").join("\n    ")}
${calls.map((c) => `    ${c}`).join("\n")}
    target.set_editor_property('Settings', settings)
    print(json.dumps({"success": True, "actor": target.get_actor_label(), "applied": applied, "warnings": warnings}, indent=2))`,
				vars,
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	// ── Physics ───────────────────────────────────────────────────────
	server.tool(
		"set_physics_simulation",
		"Enable/configure physics simulation on an actor's primitive (root) component: simulate, gravity, mass, linear/angular damping.",
		{
			actor: z.string().describe("Actor name or label"),
			simulate: z.boolean().optional(),
			gravity: z.boolean().optional(),
			mass_kg: z.number().optional(),
			linear_damping: z.number().optional(),
			angular_damping: z.number().optional(),
		},
		async ({ actor, simulate, gravity, mass_kg, linear_damping, angular_damping }) => {
			await manager.requireEditor();
			const calls: string[] = [];
			const vars: Record<string, string | number | boolean> = { actor };
			if (simulate !== undefined) {
				calls.push("comp.set_simulate_physics({{simulate}})");
				vars.simulate = simulate ? "True" : "False";
			}
			if (gravity !== undefined) {
				calls.push("comp.set_enable_gravity({{gravity}})");
				vars.gravity = gravity ? "True" : "False";
			}
			if (mass_kg !== undefined) {
				calls.push("comp.set_mass_override_in_kg(unreal.Name(''), {{mass_kg}}, True)");
				vars.mass_kg = mass_kg;
			}
			if (linear_damping !== undefined) {
				calls.push("comp.set_linear_damping({{linear_damping}})");
				vars.linear_damping = linear_damping;
			}
			if (angular_damping !== undefined) {
				calls.push("comp.set_angular_damping({{angular_damping}})");
				vars.angular_damping = angular_damping;
			}
			const script = inlineScript(
				`import unreal
import json
${FIND_ACTOR}
if not target:
    print(json.dumps({"error": "Actor not found: {{actor}}"}))
else:
    comp = target.get_component_by_class(unreal.PrimitiveComponent)
    if not comp:
        print(json.dumps({"error": "Actor has no PrimitiveComponent: {{actor}}"}))
    else:
        errors = []
        try:
${calls.length > 0 ? calls.map((c) => `            ${c}`).join("\n") : "            pass"}
        except Exception as e:
            errors.append(str(e))
        if errors:
            print(json.dumps({"success": False, "errors": errors}))
        else:
            print(json.dumps({"success": True}))`,
				vars,
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"set_collision_profile",
		"Set the collision profile (e.g. 'BlockAll', 'OverlapAll', 'Pawn') on an actor's primitive component.",
		{
			actor: z.string().describe("Actor name or label"),
			profile: z.string().describe("Collision profile name"),
		},
		async ({ actor, profile }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
${FIND_ACTOR}
if not target:
    print(json.dumps({"error": "Actor not found: {{actor}}"}))
else:
    comp = target.get_component_by_class(unreal.PrimitiveComponent)
    if not comp:
        print(json.dumps({"error": "Actor has no PrimitiveComponent: {{actor}}"}))
    else:
        comp.set_collision_profile_name('{{profile}}')
        print(json.dumps({"success": True, "profile": '{{profile}}'}))`,
				{ actor, profile },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"add_physics_constraint",
		"Create a physics constraint between two actors' primitive components. type: Fixed (locks all motion), Hinge (free rotation around one axis), or BallSocket (free rotation, locked translation). Constraint-limit API names are version-sensitive — verify against your engine version if this errors.",
		{
			actor1: z.string().describe("First actor name or label"),
			actor2: z.string().describe("Second actor name or label"),
			type: z.enum(["Fixed", "Hinge", "BallSocket"]).default("Fixed"),
		},
		async ({ actor1, actor2, type }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
a1 = None
a2 = None
for a in actors:
    if a.get_name() == '{{actor1}}' or a.get_actor_label() == '{{actor1}}':
        a1 = a
    if a.get_name() == '{{actor2}}' or a.get_actor_label() == '{{actor2}}':
        a2 = a
if not a1 or not a2:
    print(json.dumps({"error": "Could not find both actors", "actor1_found": a1 is not None, "actor2_found": a2 is not None}))
else:
    comp1 = a1.get_component_by_class(unreal.PrimitiveComponent)
    comp2 = a2.get_component_by_class(unreal.PrimitiveComponent)
    if not comp1 or not comp2:
        print(json.dumps({"error": "One or both actors lack a PrimitiveComponent"}))
    else:
        loc = a1.get_actor_location()
        constraint_actor = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).spawn_actor_from_class(unreal.PhysicsConstraintActor, loc)
        constraint_comp = constraint_actor.get_component_by_class(unreal.PhysicsConstraintComponent)
        constraint_comp.set_constrained_components(comp1, unreal.Name(''), comp2, unreal.Name(''))
        ctype = '{{type}}'
        locked = unreal.AngularConstraintMotion.ACM_LOCKED
        free = unreal.AngularConstraintMotion.ACM_FREE
        lin_locked = unreal.LinearConstraintMotion.LCM_LOCKED
        constraint_comp.set_linear_x_limit(lin_locked, 0.0)
        constraint_comp.set_linear_y_limit(lin_locked, 0.0)
        constraint_comp.set_linear_z_limit(lin_locked, 0.0)
        if ctype == 'Fixed':
            constraint_comp.set_angular_swing1_limit(locked, 0.0)
            constraint_comp.set_angular_swing2_limit(locked, 0.0)
            constraint_comp.set_angular_twist_limit(locked, 0.0)
        elif ctype == 'Hinge':
            constraint_comp.set_angular_swing1_limit(locked, 0.0)
            constraint_comp.set_angular_swing2_limit(locked, 0.0)
            constraint_comp.set_angular_twist_limit(free, 0.0)
        else:
            constraint_comp.set_angular_swing1_limit(free, 0.0)
            constraint_comp.set_angular_swing2_limit(free, 0.0)
            constraint_comp.set_angular_twist_limit(free, 0.0)
        print(json.dumps({"success": True, "constraint_actor": constraint_actor.get_name(), "type": ctype}))`,
				{ actor1, actor2, type },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"get_physics_info",
		"Get an actor's physics state: simulation enabled, gravity, mass, damping, collision profile.",
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
    comp = target.get_component_by_class(unreal.PrimitiveComponent)
    if not comp:
        print(json.dumps({"error": "Actor has no PrimitiveComponent: {{actor}}"}))
    else:
        result = {}
        for name, fn in [
            ("simulating_physics", lambda: comp.is_simulating_physics()),
            ("mass_kg", lambda: comp.get_mass()),
            ("linear_damping", lambda: comp.get_linear_damping()),
            ("angular_damping", lambda: comp.get_angular_damping()),
        ]:
            try:
                result[name] = fn()
            except Exception as e:
                result[name] = None
        try:
            result["collision_profile"] = str(comp.get_editor_property('BodyInstance').get_editor_property('CollisionProfileName'))
        except Exception:
            result["collision_profile"] = None
        print(json.dumps(result, indent=2))`,
				{ actor },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	// ── Splines ───────────────────────────────────────────────────────
	server.tool(
		"create_spline_actor",
		"Spawn an actor with a SplineComponent, optionally seeded with initial points. Requires UE5's Actor.add_component_by_class editor scripting API.",
		{
			label: z.string().optional().describe("Actor label"),
			points: z
				.array(z.object({ x: z.number(), y: z.number(), z: z.number() }))
				.optional()
				.describe("Initial spline points (world space); defaults to a single point at origin"),
		},
		async ({ label, points }) => {
			await manager.requireEditor();
			const pointsJson = JSON.stringify(points || [{ x: 0, y: 0, z: 0 }]);
			const script = inlineScript(
				`import unreal
import json
points = json.loads('{{points_json}}')
subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
actor = subsys.spawn_actor_from_class(unreal.Actor, unreal.Vector(points[0]['x'], points[0]['y'], points[0]['z']))
label = '{{label}}'
if label:
    actor.set_actor_label(label)
spline_comp = actor.add_component_by_class(unreal.SplineComponent)
if not spline_comp:
    print(json.dumps({"error": "add_component_by_class(SplineComponent) failed — not supported on this engine version"}))
else:
    spline_comp.clear_spline_points()
    for p in points:
        spline_comp.add_spline_point(unreal.Vector(p['x'], p['y'], p['z']), unreal.ESplineCoordinateSpace.WORLD, True)
    print(json.dumps({"success": True, "actor": actor.get_name(), "point_count": len(points)}))`,
				{ points_json: pointsJson, label: label || "" },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"add_spline_point",
		"Add a point to an actor's spline, at world-space x/y/z.",
		{
			actor: z.string().describe("Actor name or label with a SplineComponent"),
			x: z.number(),
			y: z.number(),
			z: z.number(),
		},
		async ({ actor, x, y, z }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
${FIND_ACTOR}
if not target:
    print(json.dumps({"error": "Actor not found: {{actor}}"}))
else:
    spline_comp = target.get_component_by_class(unreal.SplineComponent)
    if not spline_comp:
        print(json.dumps({"error": "Actor has no SplineComponent: {{actor}}"}))
    else:
        spline_comp.add_spline_point(unreal.Vector({{x}}, {{y}}, {{z}}), unreal.ESplineCoordinateSpace.WORLD, True)
        print(json.dumps({"success": True, "point_count": spline_comp.get_number_of_spline_points()}))`,
				{ actor, x, y, z },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"set_spline_point",
		"Move a spline point at the given index to a new world-space location.",
		{
			actor: z.string().describe("Actor name or label with a SplineComponent"),
			index: z.number().int().min(0),
			x: z.number(),
			y: z.number(),
			z: z.number(),
		},
		async ({ actor, index, x, y, z }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
${FIND_ACTOR}
if not target:
    print(json.dumps({"error": "Actor not found: {{actor}}"}))
else:
    spline_comp = target.get_component_by_class(unreal.SplineComponent)
    if not spline_comp:
        print(json.dumps({"error": "Actor has no SplineComponent: {{actor}}"}))
    elif {{index}} >= spline_comp.get_number_of_spline_points():
        print(json.dumps({"error": "Index out of range", "point_count": spline_comp.get_number_of_spline_points()}))
    else:
        spline_comp.set_location_at_spline_point({{index}}, unreal.Vector({{x}}, {{y}}, {{z}}), unreal.ESplineCoordinateSpace.WORLD, True)
        print(json.dumps({"success": True}))`,
				{ actor, index, x, y, z },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"remove_spline_point",
		"Remove a spline point by index.",
		{
			actor: z.string().describe("Actor name or label with a SplineComponent"),
			index: z.number().int().min(0),
		},
		{ destructiveHint: true },
		async ({ actor, index }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
${FIND_ACTOR}
if not target:
    print(json.dumps({"error": "Actor not found: {{actor}}"}))
else:
    spline_comp = target.get_component_by_class(unreal.SplineComponent)
    if not spline_comp:
        print(json.dumps({"error": "Actor has no SplineComponent: {{actor}}"}))
    elif {{index}} >= spline_comp.get_number_of_spline_points():
        print(json.dumps({"error": "Index out of range", "point_count": spline_comp.get_number_of_spline_points()}))
    else:
        spline_comp.remove_spline_point({{index}}, True)
        print(json.dumps({"success": True, "point_count": spline_comp.get_number_of_spline_points()}))`,
				{ actor, index },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"get_spline_info",
		"Get an actor's spline details: point count, per-point world locations, total length, closed-loop state.",
		{ actor: z.string().describe("Actor name or label with a SplineComponent") },
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
    spline_comp = target.get_component_by_class(unreal.SplineComponent)
    if not spline_comp:
        print(json.dumps({"error": "Actor has no SplineComponent: {{actor}}"}))
    else:
        count = spline_comp.get_number_of_spline_points()
        points = []
        for i in range(count):
            loc = spline_comp.get_location_at_spline_point(i, unreal.ESplineCoordinateSpace.WORLD)
            points.append({"index": i, "x": loc.x, "y": loc.y, "z": loc.z})
        print(json.dumps({
            "point_count": count,
            "points": points,
            "length": spline_comp.get_spline_length(),
            "closed_loop": spline_comp.is_closed_loop(),
        }, indent=2))`,
				{ actor },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"set_spline_closed",
		"Toggle whether a spline forms a closed loop.",
		{
			actor: z.string().describe("Actor name or label with a SplineComponent"),
			closed: z.boolean(),
		},
		async ({ actor, closed }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
${FIND_ACTOR}
if not target:
    print(json.dumps({"error": "Actor not found: {{actor}}"}))
else:
    spline_comp = target.get_component_by_class(unreal.SplineComponent)
    if not spline_comp:
        print(json.dumps({"error": "Actor has no SplineComponent: {{actor}}"}))
    else:
        spline_comp.set_closed_loop({{closed}}, True)
        print(json.dumps({"success": True, "closed_loop": {{closed}}}))`,
				{ actor, closed: closed ? "True" : "False" },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"set_spline_point_type",
		"Set a spline point's interpolation type: Linear, Curve, Constant, or CurveClamped.",
		{
			actor: z.string().describe("Actor name or label with a SplineComponent"),
			index: z.number().int().min(0),
			type: z.enum(["Linear", "Curve", "Constant", "CurveClamped"]),
		},
		async ({ actor, index, type }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
${FIND_ACTOR}
if not target:
    print(json.dumps({"error": "Actor not found: {{actor}}"}))
else:
    spline_comp = target.get_component_by_class(unreal.SplineComponent)
    if not spline_comp:
        print(json.dumps({"error": "Actor has no SplineComponent: {{actor}}"}))
    elif {{index}} >= spline_comp.get_number_of_spline_points():
        print(json.dumps({"error": "Index out of range", "point_count": spline_comp.get_number_of_spline_points()}))
    else:
        type_map = {
            'Linear': unreal.SplinePointType.LINEAR,
            'Curve': unreal.SplinePointType.CURVE,
            'Constant': unreal.SplinePointType.CONSTANT,
            'CurveClamped': unreal.SplinePointType.CURVE_CLAMPED,
        }
        spline_comp.set_spline_point_type({{index}}, type_map['{{type}}'], True)
        print(json.dumps({"success": True}))`,
				{ actor, index, type },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);
}
