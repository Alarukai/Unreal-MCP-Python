#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./index.js";

async function main() {
	const { server, config } = await createServer();

	const transport = new StdioServerTransport();
	await server.connect(transport);

	// Log startup info to stderr (stdout is reserved for MCP protocol)
	console.error(`[unreal-mcp] Server started`);
	console.error(`[unreal-mcp] Project: ${config.projectPath || "(not set)"}`);
	console.error(`[unreal-mcp] Engine: ${config.enginePath || "(not set)"}`);
	console.error(`[unreal-mcp] Modules: ${config.enabledModules.join(", ")}`);
}

main().catch((err) => {
	console.error("[unreal-mcp] Fatal error:", err);
	process.exit(1);
});
