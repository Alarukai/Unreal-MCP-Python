import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";
import { inlineScript } from "../utils/template.js";

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
			manager.requireEditor();
			const result = await manager.python.execute(code);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"execute_console_command",
		"Run a console command in the Unreal Editor (e.g., 'stat fps', 'stat unit', 'r.SetRes 1920x1080').",
		{ command: z.string().describe("Console command to execute") },
		async ({ command }) => {
			manager.requireEditor();
			// Execute console command via Python
			const script = inlineScript(
				`import unreal\nunreal.SystemLibrary.execute_console_command(None, '{{command}}')`,
				{ command },
			);
			const result = await manager.python.execute(script);
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
			manager.requireEditor();
			const fname =
				filename || `screenshot_${Date.now()}.png`;
			const script = inlineScript(
				`import unreal
import os
path = os.path.join(unreal.Paths.screen_shot_dir(), '{{filename}}')
unreal.AutomationLibrary.take_high_res_screenshot(640, 520, path)
print(path)`,
				{ filename: fname },
			);
			const result = await manager.python.execute(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"get_viewport_camera",
		"Get the current editor viewport camera location and rotation.",
		{},
		async () => {
			manager.requireEditor();
			const script = `import unreal
import json
vp = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_level_viewport_camera_info()
if vp:
    loc, rot = vp
    result = {
        "location": {"x": loc.x, "y": loc.y, "z": loc.z},
        "rotation": {"pitch": rot.pitch, "yaw": rot.yaw, "roll": rot.roll}
    }
    print(json.dumps(result))
else:
    print(json.dumps({"error": "Could not get viewport camera"}))`;
			const result = await manager.python.execute(script);
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
			manager.requireEditor();
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
			const result = await manager.python.execute(script);
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
