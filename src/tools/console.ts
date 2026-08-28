import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";
import { inlineScript } from "../utils/template.js";
import { assertSafeFilename } from "../utils/validate.js";

export function registerConsoleTools(
	server: McpServer,
	manager: ConnectionManager,
	_config: UnrealMcpConfig,
): void {
	server.tool(
		"execute_python",
		"Execute arbitrary Python code in the Unreal Editor's Python environment. Has access to the full `unreal` module.",
		{ code: z.string().describe("Python code to execute in the editor") },
		async ({ code }) => {
			await manager.requireEditor();
			const result = await manager.runPython(code);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"execute_console_command",
		"Run a console command in the Unreal Editor (e.g., 'stat fps', 'stat unit', 'r.SetRes 1920x1080').",
		{ command: z.string().describe("Console command to execute") },
		async ({ command }) => {
			await manager.requireEditor();
			// Execute console command via Python
			const script = inlineScript(
				`import unreal\nunreal.SystemLibrary.execute_console_command(None, '{{command}}')`,
				{ command },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result || `Executed: ${command}` }] };
		},
	);

	server.tool(
		"take_screenshot",
		"Capture a screenshot of the active editor viewport. Returns the file path of the saved image.",
		{
			filename: z
				.string()
				.optional()
				.describe("Output filename (default: screenshot_<timestamp>.png)"),
		},
		async ({ filename }) => {
			await manager.requireEditor();
			assertSafeFilename(filename);
			const fname = filename || `screenshot_${Date.now()}.png`;
			const script = inlineScript(
				`import unreal
import os
path = os.path.join(unreal.Paths.screen_shot_dir(), '{{filename}}')
unreal.AutomationLibrary.take_high_res_screenshot(640, 520, path)
print(path)`,
				{ filename: fname },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"get_viewport_camera",
		"Get the current editor viewport camera location and rotation.",
		{},
		async () => {
			await manager.requireEditor();
			const script = `import unreal
import json
try:
    subsys = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    vp = subsys.get_level_viewport_camera_info()
    if vp:
        # Handle both (bool, loc, rot) and (loc, rot) return types across UE versions
        if len(vp) == 3:
            success, loc, rot = vp
        elif len(vp) == 2:
            loc, rot = vp
        else:
            print(json.dumps({"error": "Unexpected return from get_level_viewport_camera_info"}))
            raise SystemExit()
        result = {
            "location": {"x": loc.x, "y": loc.y, "z": loc.z},
            "rotation": {"pitch": rot.pitch, "yaw": rot.yaw, "roll": rot.roll}
        }
        print(json.dumps(result))
    else:
        print(json.dumps({"error": "Could not get viewport camera"}))
except Exception as e:
    print(json.dumps({"error": str(e)}))`;
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"set_viewport_camera",
		"Set the editor viewport camera location and/or rotation.",
		{
			location: z
				.object({
					x: z.number(),
					y: z.number(),
					z: z.number(),
				})
				.optional()
				.describe("Camera location"),
			rotation: z
				.object({
					pitch: z.number(),
					yaw: z.number(),
					roll: z.number(),
				})
				.optional()
				.describe("Camera rotation"),
		},
		async ({ location, rotation }) => {
			await manager.requireEditor();
			const locStr = location
				? `unreal.Vector(${location.x}, ${location.y}, ${location.z})`
				: "None";
			const rotStr = rotation
				? `unreal.Rotator(${rotation.pitch}, ${rotation.yaw}, ${rotation.roll})`
				: "None";

			const script = `import unreal
loc = ${locStr}
rot = ${rotStr}
subsys = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
if loc is not None and rot is not None:
    subsys.set_level_viewport_camera_info(loc, rot)
    print("Camera updated")
else:
    print("Provide both location and rotation")`;
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"read_log",
		"Read the tail of the Unreal Editor's Output Log from disk, optionally filtered by severity and/or category (e.g. 'LogK2Compiler' for Blueprint compile errors, 'LogBlueprint' for graph errors). Call this after a compile, import, or any operation that might have logged C++-side diagnostics that don't surface as a Python exception — a tool call can report success while the editor logged real errors.",
		{
			lines: z
				.number()
				.int()
				.min(1)
				.max(1000)
				.default(100)
				.describe("Maximum number of matching lines to return, from the end of the log"),
			severity: z
				.string()
				.optional()
				.describe("Filter to lines containing this severity marker, e.g. 'Error' or 'Warning'"),
			category: z
				.string()
				.optional()
				.describe("Filter to lines containing this log category, e.g. 'LogK2Compiler'"),
		},
		{ readOnlyHint: true },
		async ({ lines, severity, category }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
import os

log_dir = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_log_dir())
try:
    candidates = [f for f in os.listdir(log_dir) if f.endswith('.log') and '-backup-' not in f]
except Exception as e:
    candidates = []
if not candidates:
    print(json.dumps({"error": "No log file found in " + log_dir}))
else:
    candidates.sort(key=lambda f: os.path.getmtime(os.path.join(log_dir, f)), reverse=True)
    log_path = os.path.join(log_dir, candidates[0])
    with open(log_path, 'r', encoding='utf-8', errors='replace') as f:
        all_lines = f.readlines()
    category = '{{category}}'
    severity = '{{severity}}'
    max_lines = {{max_lines}}
    filtered = []
    for line in all_lines:
        if category and category not in line:
            continue
        if severity and (severity + ':') not in line:
            continue
        filtered.append(line.rstrip('\\n'))
    tail = filtered[-max_lines:]
    print(json.dumps({"log_file": log_path, "lines": tail, "total_matched": len(filtered)}, indent=2))`,
				{
					category: category || "",
					severity: severity || "",
					max_lines: lines,
				},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"get_connection_status",
		"Check which Unreal Engine transports are currently connected (Remote Control, Python, Plugin Bridge).",
		{},
		async () => {
			const status = await manager.refreshStatus();
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(status, null, 2),
					},
				],
			};
		},
	);
}
