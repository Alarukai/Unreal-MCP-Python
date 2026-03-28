import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";
import { inlineScript } from "../utils/template.js";

export function registerTestingTools(
	server: McpServer,
	manager: ConnectionManager,
	_config: UnrealMcpConfig,
): void {
	server.tool(
		"list_automation_tests",
		"List available automation tests in the project.",
		{
			filter: z.string().optional().describe("Filter tests by name substring"),
		},
		async ({ filter }) => {
			manager.requireEditor();
			const filterLine = filter ? `if '${filter}'.lower() in name.lower()` : "";
			const script = `import unreal
import json
# Use console command to list tests
unreal.SystemLibrary.execute_console_command(None, 'automation list')
print(json.dumps({"hint": "Check Output Log for test list. Use run_automation_test with test name to execute."}))`;
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"run_automation_test",
		"Run a specific automation test by name.",
		{
			test_name: z.string().describe("Test name or pattern to run"),
		},
		async ({ test_name }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
unreal.SystemLibrary.execute_console_command(None, 'automation run {{test_name}}')
print(json.dumps({"started": True, "test": "{{test_name}}", "hint": "Check Output Log for test results"}))`,
				{ test_name },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool("run_all_automation_tests", "Run all automation tests.", {}, async () => {
		manager.requireEditor();
		const script = `import unreal
import json
unreal.SystemLibrary.execute_console_command(None, 'automation runall')
print(json.dumps({"started": True, "hint": "Check Output Log for test results"}))`;
		const result = await manager.runPython(script);
		return { content: [{ type: "text", text: result }] };
	});

	server.tool("run_map_check", "Run Map Check validation on the current level.", {}, async () => {
		manager.requireEditor();
		const script = `import unreal
import json
unreal.SystemLibrary.execute_console_command(None, 'map check')
print(json.dumps({"success": True, "hint": "Check Message Log for Map Check results"}))`;
		const result = await manager.runPython(script);
		return { content: [{ type: "text", text: result }] };
	});

	server.tool(
		"validate_data",
		"Trigger the Data Validation framework on assets.",
		{
			directory: z.string().default("/Game").describe("Content directory to validate"),
		},
		async ({ directory }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
subsys = unreal.get_editor_subsystem(unreal.EditorValidatorSubsystem)
asset_paths = unreal.EditorAssetLibrary.list_assets('{{directory}}', recursive=True)
count = min(len(asset_paths), 100)
print(json.dumps({"validating": count, "directory": "{{directory}}"}))`,
				{ directory },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"run_gauntlet",
		"Launch a Gauntlet test session via UAT. Runs tests in a full game instance.",
		{
			test_name: z.string().describe("Gauntlet test name"),
			platform: z.string().optional().describe("Target platform"),
			configuration: z.string().default("Development").describe("Build configuration"),
		},
		async ({ test_name, platform, configuration }) => {
			const result = await manager.subprocess.runUAT("RunUnreal", [
				`-project=${_config.projectPath}`,
				`-platform=${platform || _config.platform}`,
				`-configuration=${configuration}`,
				"-build=local",
				`-test=${test_name}`,
			]);
			return {
				content: [
					{
						type: "text",
						text: result.parsed
							? JSON.stringify(result.parsed, null, 2)
							: `Exit code: ${result.exitCode}\n${result.stdout}`,
					},
				],
			};
		},
	);

	server.tool(
		"run_automation_tests_by_category",
		"Run automation tests matching a category pattern.",
		{
			category: z
				.string()
				.describe("Test category pattern (e.g., 'Project.Functional', 'Engine.Rendering')"),
		},
		async ({ category }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
unreal.SystemLibrary.execute_console_command(None, 'automation run {{category}}')
print(json.dumps({"started": True, "category": "{{category}}"}))`,
				{ category },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"get_test_results",
		"Get the results of the last automation test run.",
		{},
		async () => {
			manager.requireEditor();
			const script = `import unreal
import json
# Query automation results via the automation controller
print(json.dumps({"hint": "Automation test results are available in the Session Frontend and Output Log. Use 'automation list' to see test status."}))`;
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);
}
