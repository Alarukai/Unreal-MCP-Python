import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";

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
		async ({ build_log }) => {
			const { parseBuildOutput } = await import("../utils/output-parser.js");
			const parsed = parseBuildOutput(build_log);
			return {
				content: [{ type: "text", text: JSON.stringify(parsed, null, 2) }],
			};
		},
	);
}
