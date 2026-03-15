import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";
import { inlineScript } from "../utils/template.js";

export function registerProfilingTools(
	server: McpServer,
	manager: ConnectionManager,
	_config: UnrealMcpConfig,
): void {
	server.tool(
		"start_trace",
		"Start an Unreal Insights trace session with selected channels.",
		{
			channels: z.array(z.string()).default(["cpu", "frame", "bookmark"]).describe("Trace channels: cpu, gpu, frame, memory, counters, bookmark, file, net, loadtime"),
		},
		async ({ channels }) => {
			manager.requireEditor();
			const channelStr = channels.join(",");
			const script = inlineScript(
				`import unreal
import json
unreal.SystemLibrary.execute_console_command(unreal.EditorLevelLibrary.get_editor_world(), 'trace.start {{channels}}')
print(json.dumps({"started": True, "channels": "{{channels}}"}))`,
				{ channels: channelStr },
			);
			const result = await manager.python.execute(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"stop_trace",
		"Stop the active Unreal Insights trace session.",
		{},
		async () => {
			manager.requireEditor();
			const script = `import unreal
import json
unreal.SystemLibrary.execute_console_command(unreal.EditorLevelLibrary.get_editor_world(), 'trace.stop')
print(json.dumps({"stopped": True}))`;
			const result = await manager.python.execute(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"run_stat_command",
		"Execute a stat console command (e.g., stat fps, stat unit, stat memory).",
		{
			stat: z.string().describe("Stat command (e.g., 'fps', 'unit', 'memory', 'scenerendering', 'game', 'slow')"),
		},
		async ({ stat }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
unreal.SystemLibrary.execute_console_command(unreal.EditorLevelLibrary.get_editor_world(), 'stat {{stat}}')
print(json.dumps({"executed": "stat {{stat}}"}))`,
				{ stat },
			);
			const result = await manager.python.execute(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"start_csv_profiling",
		"Start CSV profiling capture for performance regression analysis.",
		{
			filename: z.string().optional().describe("Output CSV filename (default: auto-generated)"),
		},
		async ({ filename }) => {
			manager.requireEditor();
			const cmd = filename ? `csvprofile start ${filename}` : "csvprofile start";
			const script = inlineScript(
				`import unreal
import json
unreal.SystemLibrary.execute_console_command(unreal.EditorLevelLibrary.get_editor_world(), '{{cmd}}')
print(json.dumps({"started": True}))`,
				{ cmd },
			);
			const result = await manager.python.execute(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"stop_csv_profiling",
		"Stop CSV profiling capture and save results.",
		{},
		async () => {
			manager.requireEditor();
			const script = `import unreal
import json
unreal.SystemLibrary.execute_console_command(unreal.EditorLevelLibrary.get_editor_world(), 'csvprofile stop')
print(json.dumps({"stopped": True, "hint": "CSV output saved to Saved/Profiling/CSV/"}))`;
			const result = await manager.python.execute(script);
			return { content: [{ type: "text", text: result }] };
		},
	);
}
