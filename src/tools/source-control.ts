import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";
import { inlineScript } from "../utils/template.js";

export function registerSourceControlTools(
	server: McpServer,
	manager: ConnectionManager,
	_config: UnrealMcpConfig,
): void {
	server.tool(
		"sc_status",
		"Query source control status of file(s).",
		{
			paths: z
				.array(z.string())
				.describe("File paths to query (content paths like /Game/... or absolute paths)"),
		},
		async ({ paths }) => {
			manager.requireEditor();
			const pathsJson = JSON.stringify(paths);
			const script = inlineScript(
				`import unreal
import json
results = []
for path in json.loads('{{paths_json}}'):
    state = unreal.SourceControl.query_file_state(path, True)
    results.append({
        "path": path,
        "is_source_controlled": state.is_source_controlled,
        "is_checked_out": state.is_checked_out,
        "is_checked_out_other": state.is_checked_out_other,
        "is_current": state.is_current,
        "is_added": state.is_added,
        "is_deleted": state.is_deleted,
        "is_modified": state.is_modified,
        "can_check_out": state.can_check_out,
        "can_check_in": state.can_check_in,
        "is_conflicted": state.is_conflicted,
    })
print(json.dumps(results, indent=2))`,
				{ paths_json: pathsJson },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"sc_checkout",
		"Check out file(s) from source control.",
		{
			paths: z.array(z.string()).describe("File paths to check out"),
		},
		async ({ paths }) => {
			manager.requireEditor();
			const pathsJson = JSON.stringify(paths);
			const script = inlineScript(
				`import unreal
import json
results = []
for path in json.loads('{{paths_json}}'):
    success = unreal.SourceControl.check_out_file(path)
    results.append({"path": path, "checked_out": success})
print(json.dumps(results, indent=2))`,
				{ paths_json: pathsJson },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"sc_checkin",
		"Check in file(s) to source control with a description.",
		{
			paths: z.array(z.string()).describe("File paths to check in"),
			description: z.string().describe("Check-in description / commit message"),
		},
		async ({ paths, description }) => {
			manager.requireEditor();
			const pathsJson = JSON.stringify(paths);
			const script = inlineScript(
				`import unreal
import json
results = []
for path in json.loads('{{paths_json}}'):
    success = unreal.SourceControl.check_in_files([path], '{{description}}')
    results.append({"path": path, "checked_in": success})
print(json.dumps(results, indent=2))`,
				{ paths_json: pathsJson, description },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"sc_revert",
		"Revert file(s) in source control.",
		{
			paths: z.array(z.string()).describe("File paths to revert"),
		},
		async ({ paths }) => {
			manager.requireEditor();
			const pathsJson = JSON.stringify(paths);
			const script = inlineScript(
				`import unreal
import json
results = []
for path in json.loads('{{paths_json}}'):
    success = unreal.SourceControl.revert_file(path)
    results.append({"path": path, "reverted": success})
print(json.dumps(results, indent=2))`,
				{ paths_json: pathsJson },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"sc_mark_for_add",
		"Mark new file(s) for add in source control.",
		{
			paths: z.array(z.string()).describe("File paths to mark for add"),
		},
		async ({ paths }) => {
			manager.requireEditor();
			const pathsJson = JSON.stringify(paths);
			const script = inlineScript(
				`import unreal
import json
results = []
for path in json.loads('{{paths_json}}'):
    success = unreal.SourceControl.check_out_or_add_file(path)
    results.append({"path": path, "marked": success})
print(json.dumps(results, indent=2))`,
				{ paths_json: pathsJson },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"sc_diff",
		"Get the diff for a modified file in source control.",
		{
			path: z.string().describe("File path to diff"),
		},
		async ({ path }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
state = unreal.SourceControl.query_file_state('{{path}}')
if state.is_modified:
    print(json.dumps({"path": "{{path}}", "status": "modified", "hint": "Use UE Diff tool for visual comparison"}))
else:
    print(json.dumps({"path": "{{path}}", "status": "unmodified"}))`,
				{ path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);
}
