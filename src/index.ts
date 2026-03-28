import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "./config.js";
import { registerAllTools } from "./tools/index.js";
import { ConnectionManager } from "./transports/connection-manager.js";
import type { UnrealMcpConfig } from "./types.js";

export async function createServer(
	argv?: string[],
): Promise<{ server: McpServer; config: UnrealMcpConfig }> {
	const config = loadConfig(argv);

	const server = new McpServer({
		name: "unreal-mcp",
		version: "0.1.0",
	});

	const manager = new ConnectionManager();
	await manager.initialize(config);

	// Register all enabled tool modules
	registerAllTools(server, manager, config);

	// Register resources for project info and connection status
	server.resource("project-info", "unreal://project", async () => ({
		contents: [
			{
				uri: "unreal://project",
				mimeType: "application/json",
				text: JSON.stringify(
					{
						projectPath: config.projectPath,
						enginePath: config.enginePath,
						platform: config.platform,
						configuration: config.configuration,
						enabledModules: config.enabledModules,
					},
					null,
					2,
				),
			},
		],
	}));

	server.resource("connection-status", "unreal://status", async () => {
		const status = await manager.refreshStatus();
		return {
			contents: [
				{
					uri: "unreal://status",
					mimeType: "application/json",
					text: JSON.stringify(
						{
							...status,
							pluginCapabilities: manager.pluginCapabilities,
						},
						null,
						2,
					),
				},
			],
		};
	});

	return { server, config };
}
