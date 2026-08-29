import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";
import { inlineScript } from "../utils/template.js";

export function registerBuildTools(
	server: McpServer,
	manager: ConnectionManager,
	config: UnrealMcpConfig,
): void {
	server.tool(
		"build_target",
		"Build a C++ target using UnrealBuildTool. Compiles the project's C++ code.",
		{
			target: z.string().default("Editor").describe("Build target: Editor, Game, Client, Server"),
			platform: z
				.string()
				.optional()
				.describe("Target platform (default from config, e.g., Win64)"),
			configuration: z
				.string()
				.optional()
				.describe("Build config: Debug, DebugGame, Development, Shipping, Test"),
			clean: z.boolean().default(false).describe("Clean build"),
		},
		async ({ target, platform, configuration, clean }) => {
			const args = [
				`${target}`,
				platform || config.platform,
				configuration || config.configuration,
				`-project=${config.projectPath}`,
			];
			if (clean) args.push("-clean");

			const result = await manager.subprocess.runUBT(args);
			const output = result.parsed
				? JSON.stringify(result.parsed, null, 2)
				: `Exit code: ${result.exitCode}\n${result.stdout}\n${result.stderr}`;

			return { content: [{ type: "text", text: output }] };
		},
	);

	server.tool(
		"build_cook_run",
		"Full BuildCookRun pipeline — build, cook, stage, package, and optionally deploy/run. This is the primary command for packaging a project.",
		{
			build: z.boolean().default(true).describe("Compile C++ code"),
			cook: z.boolean().default(true).describe("Cook content for target platform"),
			stage: z.boolean().default(false).describe("Stage files for packaging"),
			package: z.boolean().default(false).describe("Create distributable package"),
			archive: z.boolean().default(false).describe("Archive the build"),
			deploy: z.boolean().default(false).describe("Deploy to device"),
			run: z.boolean().default(false).describe("Run after packaging"),
			iterate: z.boolean().default(false).describe("Iterative cook (faster rebuilds)"),
			compressed: z.boolean().default(false).describe("Compress pak files"),
			platform: z.string().optional().describe("Target platform"),
			configuration: z.string().optional().describe("Build configuration"),
			additional_args: z.array(z.string()).optional().describe("Additional UAT arguments"),
		},
		async (opts) => {
			const result = await manager.subprocess.buildCookRun({
				build: opts.build,
				cook: opts.cook,
				stage: opts.stage,
				package: opts.package,
				archive: opts.archive,
				deploy: opts.deploy,
				run: opts.run,
				iterate: opts.iterate,
				compressed: opts.compressed,
				platform: opts.platform,
				configuration: opts.configuration,
				additionalArgs: opts.additional_args,
			});

			const output = result.parsed
				? JSON.stringify(result.parsed, null, 2)
				: `Exit code: ${result.exitCode}\n${result.stdout}\n${result.stderr}`;

			return { content: [{ type: "text", text: output }] };
		},
	);

	server.tool(
		"cook_content",
		"Cook content only (no C++ build). Converts assets to platform-specific format.",
		{
			platform: z.string().optional().describe("Target platform"),
			iterate: z.boolean().default(true).describe("Iterative cook"),
			maps: z.array(z.string()).optional().describe("Specific maps to cook (empty = all)"),
		},
		async ({ platform, iterate, maps }) => {
			const args: string[] = [];
			if (maps && maps.length > 0) {
				args.push(`-map=${maps.join("+")}`);
			}

			const result = await manager.subprocess.buildCookRun({
				build: false,
				cook: true,
				iterate,
				platform,
				additionalArgs: args,
			});

			const output = result.parsed
				? JSON.stringify(result.parsed, null, 2)
				: `Exit code: ${result.exitCode}\n${result.stdout}`;

			return { content: [{ type: "text", text: output }] };
		},
	);

	server.tool(
		"package_project",
		"Package the project for distribution. Runs build + cook + stage + package.",
		{
			platform: z.string().optional().describe("Target platform"),
			configuration: z
				.string()
				.default("Shipping")
				.describe("Build configuration (typically Shipping for distribution)"),
			compressed: z.boolean().default(true).describe("Compress pak files"),
		},
		async ({ platform, configuration, compressed }) => {
			const result = await manager.subprocess.buildCookRun({
				build: true,
				cook: true,
				stage: true,
				package: true,
				compressed,
				platform,
				configuration,
			});

			const output = result.parsed
				? JSON.stringify(result.parsed, null, 2)
				: `Exit code: ${result.exitCode}\n${result.stdout}`;

			return { content: [{ type: "text", text: output }] };
		},
	);

	server.tool(
		"build_plugin",
		"Build a plugin standalone.",
		{
			plugin_path: z.string().describe("Path to the .uplugin file"),
			output_path: z.string().describe("Output directory for the built plugin"),
			platform: z.string().optional().describe("Target platform"),
		},
		async ({ plugin_path, output_path, platform }) => {
			const result = await manager.subprocess.runUAT("BuildPlugin", [
				`-plugin=${plugin_path}`,
				`-package=${output_path}`,
				`-targetplatforms=${platform || config.platform}`,
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
		"generate_project_files",
		"Regenerate IDE project files (Visual Studio, Xcode, Rider).",
		{},
		async () => {
			const result = await manager.subprocess.generateProjectFiles();
			return {
				content: [
					{
						type: "text",
						text:
							result.exitCode === 0
								? "Project files generated successfully."
								: `Failed (exit ${result.exitCode}):\n${result.stderr || result.stdout}`,
					},
				],
			};
		},
	);

	server.tool(
		"build_graph",
		"Execute a BuildGraph XML script for CI/CD automation.",
		{
			script_path: z.string().describe("Path to the BuildGraph XML script"),
			target: z.string().describe("BuildGraph target to execute"),
			additional_args: z.array(z.string()).optional().describe("Additional arguments"),
		},
		async ({ script_path, target, additional_args }) => {
			const args = [`-script=${script_path}`, `-target=${target}`, ...(additional_args || [])];
			const result = await manager.subprocess.runUAT("BuildGraph", args);
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
		"clean_project",
		"Clean build artifacts for the project.",
		{
			platform: z.string().optional().describe("Target platform"),
		},
		{ destructiveHint: true },
		async ({ platform }) => {
			const result = await manager.subprocess.runUBT([
				config.projectPath,
				platform || config.platform,
				config.configuration,
				"-clean",
			]);
			return {
				content: [
					{
						type: "text",
						text:
							result.exitCode === 0
								? "Clean completed successfully."
								: `Clean failed (exit ${result.exitCode}):\n${result.stderr || result.stdout}`,
					},
				],
			};
		},
	);

	server.tool(
		"get_build_status",
		"Parse the last build output and return structured errors, warnings, and progress.",
		{
			build_log: z.string().describe("Raw build log output to parse for errors and warnings"),
		},
		{ readOnlyHint: true },
		async ({ build_log }) => {
			const { parseBuildOutput } = await import("../utils/output-parser.js");
			const parsed = parseBuildOutput(build_log);
			return {
				content: [{ type: "text", text: JSON.stringify(parsed, null, 2) }],
			};
		},
	);

	server.tool(
		"get_project_info",
		"Get basic project info: project name, engine version, project and content directory paths.",
		{},
		{ readOnlyHint: true },
		async () => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
result = {
    "success": True,
    "engine_version": unreal.SystemLibrary.get_engine_version(),
    "project_dir": unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir()),
    "content_dir": unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_content_dir()),
}
try:
    project_file = unreal.Paths.get_project_file_path()
    result["project_name"] = unreal.Paths.get_base_filename(project_file)
except Exception:
    result["project_name"] = None
print(json.dumps(result, indent=2))`,
				{},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"get_build_configuration",
		"Report the platform/configuration this MCP server session is targeting (as configured via CLI args/env/config file — not introspected from the running editor's own compile flags, which aren't exposed to Python).",
		{},
		{ readOnlyHint: true },
		async () => {
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								success: true,
								platform: config.platform,
								configuration: config.configuration,
							},
							null,
							2,
						),
					},
				],
			};
		},
	);

	server.tool(
		"get_map_check_errors",
		"Run the editor's Map Check validation and return recently-logged Map Check output lines. This scrapes free-text log output (via the 'MAP CHECK' console command + read_log-style capture), not a structured issue list — treat it as a diagnostic hint, not a queryable error object.",
		{},
		{ readOnlyHint: true },
		async () => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
import os

world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
unreal.SystemLibrary.execute_console_command(world, 'MAP CHECK')

log_dir = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_log_dir())
try:
    candidates = [f for f in os.listdir(log_dir) if f.endswith('.log') and '-backup-' not in f]
except Exception:
    candidates = []
if not candidates:
    print(json.dumps({"error": "No log file found in " + log_dir}))
else:
    candidates.sort(key=lambda f: os.path.getmtime(os.path.join(log_dir, f)), reverse=True)
    log_path = os.path.join(log_dir, candidates[0])
    with open(log_path, 'r', encoding='utf-8', errors='replace') as f:
        all_lines = f.readlines()
    filtered = [line.rstrip('\\n') for line in all_lines if 'MapCheck' in line or 'Map Check' in line]
    tail = filtered[-100:]
    print(json.dumps({"success": True, "log_file": log_path, "lines": tail, "note": "Free-text log lines matching MapCheck/Map Check, most recent 100. Empty means no issues were logged (or the check produced no textual output on this engine version)."}, indent=2))`,
				{},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);
}
