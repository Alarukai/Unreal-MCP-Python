import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";
import { inlineScript } from "../utils/template.js";

export function registerSequencerTools(
	server: McpServer,
	manager: ConnectionManager,
	_config: UnrealMcpConfig,
): void {
	server.tool(
		"create_level_sequence",
		"Create a new LevelSequence asset for cinematics.",
		{
			name: z.string().describe("Sequence name"),
			path: z.string().default("/Game/Cinematics").describe("Content directory"),
		},
		async ({ name, path }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
factory = unreal.LevelSequenceFactoryNew()
seq = asset_tools.create_asset('{{name}}', '{{path}}', unreal.LevelSequence, factory)
if seq:
    print(json.dumps({"success": True, "name": seq.get_name(), "path": seq.get_path_name()}))
else:
    print(json.dumps({"error": "Failed to create level sequence"}))`,
				{ name, path },
			);
			const result = await manager.python.execute(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"get_sequence_info",
		"Get full structure of a level sequence (bindings, tracks, sections).",
		{
			sequence_path: z.string().describe("LevelSequence asset path"),
		},
		async ({ sequence_path }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
seq = unreal.EditorAssetLibrary.load_asset('{{sequence_path}}')
if seq:
    movie_scene = seq.get_movie_scene()
    result = {
        "name": seq.get_name(),
        "path": seq.get_path_name(),
        "display_rate": str(movie_scene.get_display_rate()),
        "playback_start": movie_scene.get_playback_start(),
        "playback_end": movie_scene.get_playback_end(),
        "bindings": [],
        "master_tracks": []
    }
    for binding in seq.get_bindings():
        b = {"name": binding.get_name(), "id": str(binding.get_id()), "tracks": []}
        for track in binding.get_tracks():
            t = {"name": track.get_name(), "class": track.get_class().get_name()}
            b["tracks"].append(t)
        result["bindings"].append(b)
    for track in movie_scene.get_master_tracks():
        result["master_tracks"].append({"name": track.get_name(), "class": track.get_class().get_name()})
    print(json.dumps(result, indent=2))
else:
    print(json.dumps({"error": "Sequence not found: {{sequence_path}}"}))`,
				{ sequence_path },
			);
			const result = await manager.python.execute(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"add_actor_binding",
		"Bind an actor to a level sequence for animation.",
		{
			sequence_path: z.string().describe("LevelSequence asset path"),
			actor_name: z.string().describe("Actor name or label to bind"),
		},
		async ({ sequence_path, actor_name }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
seq = unreal.EditorAssetLibrary.load_asset('{{sequence_path}}')
if seq:
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
    target = None
    for a in actors:
        if a.get_name() == '{{actor_name}}' or a.get_actor_label() == '{{actor_name}}':
            target = a
            break
    if target:
        movie_scene = seq.get_movie_scene()
        binding = seq.add_possessable(target)
        print(json.dumps({"success": True, "binding_id": str(binding.get_id()), "actor": target.get_name()}))
    else:
        print(json.dumps({"error": "Actor not found: {{actor_name}}"}))
else:
    print(json.dumps({"error": "Sequence not found"}))`,
				{ sequence_path, actor_name },
			);
			const result = await manager.python.execute(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"add_track",
		"Add a track to an actor binding in a sequence.",
		{
			sequence_path: z.string().describe("LevelSequence asset path"),
			binding_id: z.string().describe("Binding ID (from add_actor_binding or get_sequence_info)"),
			track_type: z
				.enum([
					"MovieScene3DTransformTrack",
					"MovieSceneSkeletalAnimationTrack",
					"MovieSceneAudioTrack",
					"MovieSceneEventTrack",
					"MovieSceneFloatTrack",
					"MovieSceneBoolTrack",
					"MovieSceneVisibilityTrack",
					"MovieSceneParticleTrack",
				])
				.describe("Track class name"),
		},
		async ({ sequence_path, binding_id, track_type }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
seq = unreal.EditorAssetLibrary.load_asset('{{sequence_path}}')
if seq:
    movie_scene = seq.get_movie_scene()
    for binding in seq.get_bindings():
        if str(binding.get_id()) == '{{binding_id}}':
            track_class = getattr(unreal, '${track_type}')
            track = binding.add_track(track_class)
            if track:
                print(json.dumps({"success": True, "track": track.get_name(), "class": "${track_type}"}))
            else:
                print(json.dumps({"error": "Failed to add track"}))
            break
    else:
        print(json.dumps({"error": "Binding not found: {{binding_id}}"}))
else:
    print(json.dumps({"error": "Sequence not found"}))`,
				{ sequence_path, binding_id },
			);
			const result = await manager.python.execute(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"set_playback_range",
		"Set the playback start and end frames of a sequence.",
		{
			sequence_path: z.string().describe("LevelSequence asset path"),
			start_frame: z.number().describe("Start frame"),
			end_frame: z.number().describe("End frame"),
		},
		async ({ sequence_path, start_frame, end_frame }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
seq = unreal.EditorAssetLibrary.load_asset('{{sequence_path}}')
if seq:
    movie_scene = seq.get_movie_scene()
    movie_scene.set_playback_start(${start_frame})
    movie_scene.set_playback_end(${end_frame})
    unreal.EditorAssetLibrary.save_asset('{{sequence_path}}')
    print(json.dumps({"success": True, "start": ${start_frame}, "end": ${end_frame}}))
else:
    print(json.dumps({"error": "Sequence not found"}))`,
				{ sequence_path },
			);
			const result = await manager.python.execute(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"set_sequence_framerate",
		"Set the display frame rate of a sequence.",
		{
			sequence_path: z.string().describe("LevelSequence asset path"),
			fps: z.number().default(30).describe("Frames per second"),
		},
		async ({ sequence_path, fps }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
seq = unreal.EditorAssetLibrary.load_asset('{{sequence_path}}')
if seq:
    movie_scene = seq.get_movie_scene()
    rate = unreal.FrameRate(${fps}, 1)
    movie_scene.set_display_rate(rate)
    unreal.EditorAssetLibrary.save_asset('{{sequence_path}}')
    print(json.dumps({"success": True, "fps": ${fps}}))
else:
    print(json.dumps({"error": "Sequence not found"}))`,
				{ sequence_path },
			);
			const result = await manager.python.execute(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"export_sequence_fbx",
		"Export a level sequence to FBX.",
		{
			sequence_path: z.string().describe("LevelSequence asset path"),
			output_path: z.string().describe("Output FBX file path"),
		},
		async ({ sequence_path, output_path }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
seq = unreal.EditorAssetLibrary.load_asset('{{sequence_path}}')
if seq:
    world = unreal.EditorLevelLibrary.get_editor_world()
    bindings = []
    movie_scene = seq.get_movie_scene()
    for binding in seq.get_bindings():
        bindings.append(binding)
    if bindings:
        export_options = unreal.FbxExportOption()
        success = unreal.SequencerTools.export_level_sequence_fbx(
            world, seq, bindings, export_options, '{{output_path}}'
        )
        print(json.dumps({"success": success, "output": "{{output_path}}"}))
    else:
        print(json.dumps({"error": "No bindings to export"}))
else:
    print(json.dumps({"error": "Sequence not found"}))`,
				{ sequence_path, output_path },
			);
			const result = await manager.python.execute(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"render_sequence",
		"Queue a Movie Render Queue job for a sequence.",
		{
			sequence_path: z.string().describe("LevelSequence asset path"),
			output_directory: z.string().optional().describe("Output directory for rendered frames"),
		},
		async ({ sequence_path, output_directory }) => {
			manager.requireEditor();
			const outDir = output_directory || "{project}/Saved/MovieRenders";
			const script = inlineScript(
				`import unreal
import json
seq = unreal.EditorAssetLibrary.load_asset('{{sequence_path}}')
if seq:
    subsys = unreal.get_editor_subsystem(unreal.MoviePipelineQueueSubsystem)
    queue = subsys.get_queue()
    job = queue.allocate_new_job(unreal.MoviePipelineExecutorJob)
    job.sequence = unreal.SoftObjectPath('{{sequence_path}}')
    job.map = unreal.SoftObjectPath(unreal.EditorLevelLibrary.get_editor_world().get_path_name())
    print(json.dumps({"success": True, "job": job.get_name(), "hint": "Open Movie Render Queue to configure settings and render"}))
else:
    print(json.dumps({"error": "Sequence not found"}))`,
				{ sequence_path },
			);
			const result = await manager.python.execute(script);
			return { content: [{ type: "text", text: result }] };
		},
	);
}
