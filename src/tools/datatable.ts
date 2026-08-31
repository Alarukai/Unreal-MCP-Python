import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";
import { inlineScript } from "../utils/template.js";

export function registerDataTableTools(
	server: McpServer,
	manager: ConnectionManager,
	_config: UnrealMcpConfig,
): void {
	server.tool(
		"create_data_table",
		"Create a new DataTable asset bound to a row struct (a UserDefinedStruct asset, or a native struct like 'GameplayTagTableRow').",
		{
			name: z.string().describe("DataTable asset name"),
			struct_type: z
				.string()
				.describe("Row struct — an asset path (/Game/...) or a native struct type name"),
			path: z.string().default("/Game/Data").describe("Content directory to create in"),
		},
		async ({ name, struct_type, path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
row_struct = getattr(unreal, '{{struct_type}}', None)
if row_struct is None:
    row_struct = unreal.EditorAssetLibrary.load_asset('{{struct_type}}')
if not row_struct:
    print(json.dumps({"error": "Row struct not found: {{struct_type}}"}))
else:
    factory = unreal.DataTableFactory()
    factory.set_editor_property('Struct', row_struct)
    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    dt = asset_tools.create_asset('{{name}}', '{{path}}', unreal.DataTable, factory)
    if dt:
        print(json.dumps({"success": True, "name": dt.get_name(), "path": dt.get_path_name()}))
    else:
        print(json.dumps({"error": "Failed to create DataTable"}))`,
				{ name, struct_type, path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"read_data_table",
		"Read all rows from a DataTable as JSON.",
		{ path: z.string().describe("DataTable asset path") },
		{ readOnlyHint: true },
		async ({ path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
dt = unreal.EditorAssetLibrary.load_asset('{{path}}')
if not dt or not isinstance(dt, unreal.DataTable):
    print(json.dumps({"error": "DataTable not found: {{path}}"}))
else:
    rows_json = dt.get_table_as_json()
    rows = json.loads(rows_json) if rows_json else []
    print(json.dumps({"success": True, "name": dt.get_name(), "row_names": [str(n) for n in dt.get_row_names()], "rows": rows}, indent=2))`,
				{ path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"add_data_table_row",
		"Add or update a single row in an existing DataTable. Implemented as a read-modify-write over the table's JSON (fill_data_table_from_json_string) since stock Python has no single-row-add primitive — the whole table is re-filled with this row added/replaced.",
		{
			path: z.string().describe("DataTable asset path"),
			row_name: z.string().describe("Row name"),
			row_data: z
				.record(z.unknown())
				.describe("Row field values, matching the row struct's fields"),
		},
		async ({ path, row_name, row_data }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
dt = unreal.EditorAssetLibrary.load_asset('{{path}}')
if not dt or not isinstance(dt, unreal.DataTable):
    print(json.dumps({"error": "DataTable not found: {{path}}"}))
else:
    existing_json = dt.get_table_as_json()
    rows = json.loads(existing_json) if existing_json else []
    new_row = json.loads('{{row_data_json}}')
    new_row['Name'] = '{{row_name}}'
    rows = [r for r in rows if r.get('Name') != '{{row_name}}']
    rows.append(new_row)
    success = unreal.DataTableFunctionLibrary.fill_data_table_from_json_string(dt, json.dumps(rows))
    if success:
        unreal.EditorAssetLibrary.save_asset('{{path}}')
    print(json.dumps({"success": success, "row_name": "{{row_name}}", "total_rows": len(rows)}))`,
				{ path, row_name, row_data_json: JSON.stringify(row_data) },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"import_data_table_json",
		"Replace a DataTable's rows in bulk from a JSON array string (each element an object with a 'Name' field plus the row struct's other fields).",
		{
			path: z.string().describe("DataTable asset path"),
			json_rows: z.string().describe("JSON array of row objects, as a string"),
		},
		async ({ path, json_rows }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
dt = unreal.EditorAssetLibrary.load_asset('{{path}}')
if not dt or not isinstance(dt, unreal.DataTable):
    print(json.dumps({"error": "DataTable not found: {{path}}"}))
else:
    success = unreal.DataTableFunctionLibrary.fill_data_table_from_json_string(dt, '{{json_rows}}')
    if success:
        unreal.EditorAssetLibrary.save_asset('{{path}}')
    print(json.dumps({"success": success}))`,
				{ path, json_rows },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);
}
