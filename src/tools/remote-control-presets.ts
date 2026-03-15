import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";

export function registerRemoteControlPresetsTools(
	server: McpServer,
	manager: ConnectionManager,
	_config: UnrealMcpConfig,
): void {
	server.tool(
		"list_presets",
		"List all Remote Control Presets in the project.",
		{},
		async () => {
			const presets = await manager.rc.listPresets();
			return { content: [{ type: "text", text: JSON.stringify(presets, null, 2) }] };
		},
	);

	server.tool(
		"get_preset_info",
		"Get details of a Remote Control Preset (exposed properties and functions).",
		{
			preset_name: z.string().describe("Preset name"),
		},
		async ({ preset_name }) => {
			const presets = await manager.rc.listPresets();
			const preset = (presets as Array<{ Name?: string }>).find(
				(p) => p.Name === preset_name,
			);
			if (preset) {
				return { content: [{ type: "text", text: JSON.stringify(preset, null, 2) }] };
			}
			return {
				content: [{ type: "text", text: JSON.stringify({ error: `Preset not found: ${preset_name}` }) }],
			};
		},
	);

	server.tool(
		"get_preset_property",
		"Get a property value exposed via a Remote Control Preset.",
		{
			preset_name: z.string().describe("Preset name"),
			property_name: z.string().describe("Exposed property name"),
		},
		async ({ preset_name, property_name }) => {
			const result = await manager.rc.getPresetProperty(preset_name, property_name);
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"set_preset_property",
		"Set a property value exposed via a Remote Control Preset.",
		{
			preset_name: z.string().describe("Preset name"),
			property_name: z.string().describe("Exposed property name"),
			value: z.unknown().describe("Property value to set"),
		},
		async ({ preset_name, property_name, value }) => {
			await manager.rc.setPresetProperty(preset_name, property_name, value);
			return { content: [{ type: "text", text: JSON.stringify({ success: true }) }] };
		},
	);

	server.tool(
		"call_preset_function",
		"Call a function exposed via a Remote Control Preset.",
		{
			preset_name: z.string().describe("Preset name"),
			function_name: z.string().describe("Exposed function name"),
			parameters: z.record(z.unknown()).optional().describe("Function parameters"),
		},
		async ({ preset_name, function_name, parameters }) => {
			const result = await manager.rc.callPresetFunction(
				preset_name,
				function_name,
				parameters as Record<string, unknown>,
			);
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);
}
