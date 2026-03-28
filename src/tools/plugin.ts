import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";
import { inlineScript } from "../utils/template.js";

export function registerPluginTools(
	server: McpServer,
	manager: ConnectionManager,
	_config: UnrealMcpConfig,
): void {
	server.tool("list_plugins", "List installed plugins and their enabled status.", {}, async () => {
		manager.requireEditor();
		const script = `import unreal
import json
import os

# Read .uproject to get plugin list
project_path = unreal.Paths.get_project_file_path()
with open(project_path, 'r') as f:
    project = json.load(f)

plugins = project.get('Plugins', [])
result = [{"name": p.get("Name"), "enabled": p.get("Enabled", True)} for p in plugins]
print(json.dumps(result, indent=2))`;
		const result = await manager.python.execute(script);
		return { content: [{ type: "text", text: result }] };
	});

	server.tool(
		"enable_plugin",
		"Enable a plugin in the .uproject file. Requires editor restart to take effect.",
		{
			plugin_name: z.string().describe("Plugin name to enable"),
		},
		async ({ plugin_name }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json

project_path = unreal.Paths.get_project_file_path()
with open(project_path, 'r') as f:
    project = json.load(f)

plugins = project.setdefault('Plugins', [])
found = False
for p in plugins:
    if p.get('Name') == '{{plugin_name}}':
        p['Enabled'] = True
        found = True
        break

if not found:
    plugins.append({"Name": "{{plugin_name}}", "Enabled": True})

with open(project_path, 'w') as f:
    json.dump(project, f, indent=2)

print(json.dumps({"success": True, "plugin": "{{plugin_name}}", "hint": "Restart the editor for the change to take effect"}))`,
				{ plugin_name },
			);
			const result = await manager.python.execute(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"disable_plugin",
		"Disable a plugin in the .uproject file. Requires editor restart to take effect.",
		{
			plugin_name: z.string().describe("Plugin name to disable"),
		},
		async ({ plugin_name }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json

project_path = unreal.Paths.get_project_file_path()
with open(project_path, 'r') as f:
    project = json.load(f)

plugins = project.setdefault('Plugins', [])
found = False
for p in plugins:
    if p.get('Name') == '{{plugin_name}}':
        p['Enabled'] = False
        found = True
        break

if not found:
    plugins.append({"Name": "{{plugin_name}}", "Enabled": False})

with open(project_path, 'w') as f:
    json.dump(project, f, indent=2)

print(json.dumps({"success": True, "plugin": "{{plugin_name}}", "hint": "Restart the editor for the change to take effect"}))`,
				{ plugin_name },
			);
			const result = await manager.python.execute(script);
			return { content: [{ type: "text", text: result }] };
		},
	);
}
