import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";
import { inlineScript } from "../utils/template.js";

export function registerAudioTools(
	server: McpServer,
	manager: ConnectionManager,
	_config: UnrealMcpConfig,
): void {
	server.tool(
		"spawn_sound",
		"Spawn an AmbientSound actor with a sound asset at a world location.",
		{
			sound_path: z.string().describe("Sound asset path (USoundBase/USoundCue/USoundWave)"),
			location: z.object({ x: z.number(), y: z.number(), z: z.number() }).default({
				x: 0,
				y: 0,
				z: 0,
			}),
			label: z.string().optional().describe("Actor label"),
			volume: z.number().optional(),
			pitch: z.number().optional(),
		},
		async ({ sound_path, location, label, volume, pitch }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
sound = unreal.EditorAssetLibrary.load_asset('{{sound_path}}')
if not sound:
    print(json.dumps({"error": "Sound not found: {{sound_path}}"}))
else:
    loc = unreal.Vector({{x}}, {{y}}, {{z}})
    actor = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).spawn_actor_from_class(unreal.AmbientSound, loc)
    if not actor:
        print(json.dumps({"error": "Failed to spawn AmbientSound"}))
    else:
        label = '{{label}}'
        if label:
            actor.set_actor_label(label)
        audio_comp = actor.get_component_by_class(unreal.AudioComponent)
        warnings = []
        if audio_comp:
            audio_comp.set_sound(sound)
            volume = {{volume}}
            pitch = {{pitch}}
            if volume is not None:
                try:
                    audio_comp.set_volume_multiplier(volume)
                except Exception as e:
                    warnings.append('volume: ' + str(e))
            if pitch is not None:
                try:
                    audio_comp.set_pitch_multiplier(pitch)
                except Exception as e:
                    warnings.append('pitch: ' + str(e))
        else:
            warnings.append('AmbientSound actor has no AudioComponent')
        print(json.dumps({"success": True, "actor": actor.get_name(), "warnings": warnings}))`,
				{
					sound_path,
					x: location.x,
					y: location.y,
					z: location.z,
					label: label || "",
					volume: volume ?? "None",
					pitch: pitch ?? "None",
				},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"set_audio_properties",
		"Set volume, pitch, and auto-activate on an actor's audio component.",
		{
			actor: z.string().describe("Actor name or label with an AudioComponent"),
			volume: z.number().optional(),
			pitch: z.number().optional(),
			auto_activate: z.boolean().optional(),
		},
		async ({ actor, volume, pitch, auto_activate }) => {
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
    audio_comp = target.get_component_by_class(unreal.AudioComponent)
    if not audio_comp:
        print(json.dumps({"error": "Actor has no AudioComponent: {{actor}}"}))
    else:
        warnings = []
        volume = {{volume}}
        pitch = {{pitch}}
        auto_activate = {{auto_activate}}
        if volume is not None:
            try:
                audio_comp.set_volume_multiplier(volume)
            except Exception as e:
                warnings.append('volume: ' + str(e))
        if pitch is not None:
            try:
                audio_comp.set_pitch_multiplier(pitch)
            except Exception as e:
                warnings.append('pitch: ' + str(e))
        if auto_activate is not None:
            try:
                audio_comp.set_editor_property('bAutoActivate', auto_activate)
            except Exception as e:
                warnings.append('auto_activate: ' + str(e))
        print(json.dumps({"success": True, "warnings": warnings}))`,
				{
					actor,
					volume: volume ?? "None",
					pitch: pitch ?? "None",
					auto_activate: auto_activate === undefined ? "None" : auto_activate ? "True" : "False",
				},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"get_sound_info",
		"Get metadata for a sound asset: duration, and (for USoundWave) sample rate and channel count.",
		{ path: z.string().describe("Sound asset path") },
		{ readOnlyHint: true },
		async ({ path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
sound = unreal.EditorAssetLibrary.load_asset('{{path}}')
if not sound:
    print(json.dumps({"error": "Sound not found: {{path}}"}))
else:
    result = {"name": sound.get_name(), "class": sound.get_class().get_name()}
    try:
        result["duration"] = sound.get_duration()
    except Exception:
        result["duration"] = None
    try:
        result["sample_rate"] = sound.get_editor_property('SampleRate')
    except Exception:
        result["sample_rate"] = None
    try:
        result["num_channels"] = sound.get_editor_property('NumChannels')
    except Exception:
        result["num_channels"] = None
    print(json.dumps(result, indent=2))`,
				{ path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);
}
