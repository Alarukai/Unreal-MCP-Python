import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";
import { inlineScript } from "../utils/template.js";

export function registerAssetTools(
	server: McpServer,
	manager: ConnectionManager,
	config: UnrealMcpConfig,
): void {
	server.tool(
		"list_assets",
		"List assets in a content directory with optional class filter.",
		{
			directory: z
				.string()
				.default("/Game")
				.describe("Content directory path (e.g., /Game, /Game/Meshes)"),
			class_filter: z
				.string()
				.optional()
				.describe("Filter by asset class (e.g., StaticMesh, Material, Blueprint)"),
			recursive: z.boolean().default(true).describe("Include subdirectories"),
		},
		{ readOnlyHint: true },
		async ({ directory, class_filter, recursive }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
registry = unreal.AssetRegistryHelpers.get_asset_registry()
path = '{{directory}}'
recursive = {{recursive}}
assets = registry.get_assets_by_path(path, recursive) or []
class_filter = '{{class_filter}}'
results = []
for a in assets:
    cls = str(a.asset_class_path.asset_name) if hasattr(a, 'asset_class_path') else str(a.asset_class)
    if class_filter and class_filter not in cls:
        continue
    results.append({
        "name": str(a.asset_name),
        "class": cls,
        "path": str(a.package_name) + '.' + str(a.asset_name),
        "package": str(a.package_name)
    })
print(json.dumps(results[:500], indent=2))`,
				{ directory, class_filter: class_filter || "", recursive: recursive ? "True" : "False" },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"search_assets",
		"Search for assets by name, class, or tag.",
		{
			query: z.string().describe("Search query (asset name substring)"),
			class_filter: z.string().optional().describe("Filter by asset class"),
		},
		{ readOnlyHint: true },
		async ({ query, class_filter }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
registry = unreal.AssetRegistryHelpers.get_asset_registry()
filt = unreal.ARFilter()
class_filter = '{{class_filter}}'
if class_filter:
    filt.class_paths = [unreal.TopLevelAssetPath('/Script/Engine', class_filter)]
assets = registry.get_assets(filt) or []
query = '{{query}}'.lower()
results = []
for a in assets:
    name = str(a.asset_name)
    if query in name.lower():
        cls = str(a.asset_class_path.asset_name) if hasattr(a, 'asset_class_path') else str(a.asset_class)
        results.append({"name": name, "class": cls, "path": str(a.package_name) + '.' + name})
        if len(results) >= 100:
            break
print(json.dumps(results, indent=2))`,
				{ query, class_filter: class_filter || "" },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"get_asset_info",
		"Get detailed metadata for an asset.",
		{
			asset_path: z.string().describe("Asset path (e.g., /Game/Meshes/MyMesh.MyMesh)"),
		},
		{ readOnlyHint: true },
		async ({ asset_path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
asset = unreal.EditorAssetLibrary.load_asset('{{asset_path}}')
if asset:
    result = {
        "name": asset.get_name(),
        "class": asset.get_class().get_name(),
        "path": asset.get_path_name(),
        "outer": asset.get_outer().get_name() if asset.get_outer() else None,
        "package": str(asset.get_outermost().get_name()),
    }
    print(json.dumps(result, indent=2))
else:
    print(json.dumps({"error": "Asset not found: {{asset_path}}"}))`,
				{ asset_path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"get_asset_references",
		"Get the dependency and referencer graph for an asset.",
		{
			asset_path: z.string().describe("Asset package path (e.g., /Game/Meshes/MyMesh)"),
			direction: z.enum(["dependencies", "referencers", "both"]).default("both"),
		},
		{ readOnlyHint: true },
		async ({ asset_path, direction }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
registry = unreal.AssetRegistryHelpers.get_asset_registry()
path = '{{asset_path}}'
result = {}
if '{{direction}}' in ('dependencies', 'both'):
    deps = registry.get_dependencies(path)
    result['dependencies'] = [str(d) for d in deps] if deps else []
if '{{direction}}' in ('referencers', 'both'):
    refs = registry.get_referencers(path)
    result['referencers'] = [str(r) for r in refs] if refs else []
print(json.dumps(result, indent=2))`,
				{ asset_path, direction },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"rename_asset",
		"Rename or move an asset.",
		{
			source_path: z.string().describe("Current asset path"),
			destination_path: z.string().describe("New asset path"),
		},
		{ destructiveHint: true },
		async ({ source_path, destination_path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
success = unreal.EditorAssetLibrary.rename_asset('{{source_path}}', '{{destination_path}}')
print(json.dumps({"success": success}))`,
				{ source_path, destination_path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"duplicate_asset",
		"Duplicate an asset to a new path.",
		{
			source_path: z.string().describe("Source asset path"),
			destination_path: z.string().describe("Destination asset path"),
		},
		async ({ source_path, destination_path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
result = unreal.EditorAssetLibrary.duplicate_asset('{{source_path}}', '{{destination_path}}')
print(json.dumps({"success": result is not None, "path": '{{destination_path}}' if result else None}))`,
				{ source_path, destination_path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"delete_asset",
		"Delete an asset. Checks for references first.",
		{
			asset_path: z.string().describe("Asset path to delete"),
			force: z.boolean().default(false).describe("Delete even if referenced by other assets"),
		},
		{ destructiveHint: true },
		async ({ asset_path, force }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
registry = unreal.AssetRegistryHelpers.get_asset_registry()
refs = registry.get_referencers('{{asset_path}}')
ref_list = [str(r) for r in refs] if refs else []
if ref_list and not {{force}}:
    print(json.dumps({"error": "Asset has referencers", "referencers": ref_list, "hint": "Use force=true to delete anyway"}))
else:
    success = unreal.EditorAssetLibrary.delete_asset('{{asset_path}}')
    print(json.dumps({"deleted": success}))`,
				{ asset_path, force: force ? "True" : "False" },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"import_asset",
		"Import an external file (FBX, PNG, WAV, etc.) into the project.",
		{
			source_file: z.string().describe("Path to the file on disk to import"),
			destination_path: z
				.string()
				.describe("Content directory to import into (e.g., /Game/Meshes)"),
		},
		async ({ source_file, destination_path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
tasks = [unreal.AssetImportTask()]
tasks[0].filename = '{{source_file}}'
tasks[0].destination_path = '{{destination_path}}'
tasks[0].automated = True
tasks[0].save = True
tasks[0].replace_existing = True
unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks(tasks)
if tasks[0].imported_object_paths:
    print(json.dumps({"success": True, "imported": [str(p) for p in tasks[0].imported_object_paths]}))
else:
    print(json.dumps({"success": False, "error": "Import failed"}))`,
				{ source_file, destination_path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"export_asset",
		"Export an asset to an external file format.",
		{
			asset_path: z.string().describe("Asset to export"),
			output_path: z.string().describe("Output file path on disk"),
		},
		async ({ asset_path, output_path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
task = unreal.AssetExportTask()
task.object = unreal.EditorAssetLibrary.load_asset('{{asset_path}}')
task.filename = '{{output_path}}'
task.automated = True
task.prompt = False
success = unreal.Exporter.run_asset_export_task(task)
print(json.dumps({"success": success, "output": '{{output_path}}'}))`,
				{ asset_path, output_path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"validate_assets",
		"Run data validation on assets in a directory.",
		{
			directory: z.string().default("/Game").describe("Content directory to validate"),
		},
		{ readOnlyHint: true },
		async ({ directory }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
subsys = unreal.get_editor_subsystem(unreal.EditorValidatorSubsystem)
registry = unreal.AssetRegistryHelpers.get_asset_registry()
assets = registry.get_assets_by_path('{{directory}}', True) or []
asset_list = [a for a in assets[:50]]
results = subsys.validate_assets_with_settings(
    asset_list,
    unreal.ValidateAssetsSettings(),
    unreal.ValidateAssetsResults()
)
print(json.dumps({"validated": True}))`,
				{ directory },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"save_asset",
		"Force save a specific asset.",
		{
			asset_path: z.string().describe("Asset path to save"),
		},
		async ({ asset_path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
success = unreal.EditorAssetLibrary.save_asset('{{asset_path}}')
print(json.dumps({"saved": success}))`,
				{ asset_path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool("save_all", "Save all dirty (modified) assets.", {}, async () => {
		await manager.requireEditor();
		const script = `import unreal
import json
unreal.EditorLoadingAndSavingUtils.save_dirty_packages(True, True)
print(json.dumps({"success": True}))`;
		const result = await manager.runPython(script);
		return { content: [{ type: "text", text: result }] };
	});

	server.tool(
		"fix_redirectors",
		"Clean up asset redirectors in the project (runs FixUpRedirects commandlet).",
		{},
		async () => {
			const result = await manager.subprocess.runCommandlet("FixupRedirects", ["-autocheckout"]);
			return {
				content: [
					{
						type: "text",
						text:
							result.exitCode === 0
								? "Redirectors fixed successfully."
								: `Failed (exit ${result.exitCode}):\n${result.stderr || result.stdout}`,
					},
				],
			};
		},
	);

	server.tool(
		"resave_packages",
		"Bulk resave all packages in the project (runs ResavePackages commandlet).",
		{
			directory: z.string().optional().describe("Limit to a specific content directory"),
		},
		async ({ directory }) => {
			const args: string[] = [];
			if (directory) args.push(`-packagefolder=${directory}`);
			const result = await manager.subprocess.runCommandlet("ResavePackages", args);
			return {
				content: [
					{
						type: "text",
						text:
							result.exitCode === 0
								? "Packages resaved successfully."
								: `Failed (exit ${result.exitCode}):\n${result.stderr || result.stdout}`,
					},
				],
			};
		},
	);

	server.tool(
		"content_audit",
		"Run content audit to find costly or problematic assets (runs ContentAudit commandlet).",
		{},
		{ readOnlyHint: true },
		async () => {
			const result = await manager.subprocess.runCommandlet("ContentAudit");
			return {
				content: [
					{
						type: "text",
						text:
							result.exitCode === 0
								? `Audit complete:\n${result.stdout}`
								: `Failed (exit ${result.exitCode}):\n${result.stderr || result.stdout}`,
					},
				],
			};
		},
	);

	server.tool(
		"consolidate_assets",
		"Consolidate duplicate assets — replace references from source assets to a target asset.",
		{
			target_path: z.string().describe("Target asset path to keep"),
			source_paths: z.array(z.string()).describe("Source asset paths to consolidate into target"),
		},
		{ destructiveHint: true },
		async ({ target_path, source_paths }) => {
			await manager.requireEditor();
			const sourcePathsJson = JSON.stringify(source_paths);
			const script = inlineScript(
				`import unreal
import json
target = unreal.EditorAssetLibrary.load_asset('{{target_path}}')
source_paths = json.loads('{{source_paths_json}}')
sources = [unreal.EditorAssetLibrary.load_asset(p) for p in source_paths]
sources = [s for s in sources if s is not None]
if target and sources:
    unreal.get_editor_subsystem(unreal.EditorAssetSubsystem).consolidate_assets(target, sources)
    print(json.dumps({"success": True, "consolidated": len(sources)}))
else:
    print(json.dumps({"error": "Could not load target or source assets"}))`,
				{ target_path, source_paths_json: sourcePathsJson },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"find_orphan_assets",
		"Find assets in a directory that have zero referencers (nothing in the project uses them) — candidates for cleanup.",
		{
			directory: z.string().default("/Game").describe("Content directory to scan"),
			max_scan: z
				.number()
				.int()
				.min(1)
				.max(2000)
				.default(500)
				.describe("Maximum number of assets to scan (registry lookups are per-asset)"),
		},
		{ readOnlyHint: true },
		async ({ directory, max_scan }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
registry = unreal.AssetRegistryHelpers.get_asset_registry()
assets = registry.get_assets_by_path('{{directory}}', True) or []
orphans = []
scanned = 0
for a in assets[:{{max_scan}}]:
    scanned += 1
    package = str(a.package_name)
    refs = registry.get_referencers(package)
    if not refs:
        cls = str(a.asset_class_path.asset_name) if hasattr(a, 'asset_class_path') else str(a.asset_class)
        orphans.append({"name": str(a.asset_name), "path": package, "class": cls})
print(json.dumps({"orphans": orphans, "orphan_count": len(orphans), "scanned": scanned, "total_in_directory": len(assets)}, indent=2))`,
				{ directory, max_scan },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"find_circular_dependencies",
		"Find dependency cycles that lead back to the given asset (A depends on B depends on ... depends on A).",
		{
			asset_path: z.string().describe("Asset package path to check (e.g., /Game/Meshes/MyMesh)"),
			max_depth: z
				.number()
				.int()
				.min(1)
				.max(30)
				.default(10)
				.describe("Maximum dependency chain depth to search"),
		},
		{ readOnlyHint: true },
		async ({ asset_path, max_depth }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
registry = unreal.AssetRegistryHelpers.get_asset_registry()
start = '{{asset_path}}'
max_depth = {{max_depth}}
cycles = []

# Prune only on the current recursion path (chain), NOT a global visited set:
# a node first reached via a branch that doesn't loop back to start would be
# marked globally visited and then skipped on a later branch that DOES loop
# back, silently missing that cycle. The depth cap and 20-cycle result cap
# bound the cost instead.
def dfs(path, chain, depth):
    if depth > max_depth or len(cycles) >= 20:
        return
    deps = registry.get_dependencies(path) or []
    for d in deps:
        d_str = str(d)
        if d_str == start:
            cycles.append(chain + [d_str])
            continue
        if d_str in chain:
            continue
        dfs(d_str, chain + [d_str], depth + 1)

dfs(start, [start], 1)
print(json.dumps({"start": start, "cycles": cycles, "cycle_count": len(cycles), "max_depth_searched": max_depth}, indent=2))`,
				{ asset_path, max_depth },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"get_dependency_tree",
		"Get an asset's dependency graph as a recursive tree, several levels deep.",
		{
			asset_path: z.string().describe("Asset package path (e.g., /Game/Meshes/MyMesh)"),
			depth: z.number().int().min(1).max(5).default(2).describe("How many levels deep to recurse"),
			max_children: z
				.number()
				.int()
				.min(1)
				.max(100)
				.default(20)
				.describe("Maximum children to expand per node, to keep the tree bounded"),
		},
		{ readOnlyHint: true },
		async ({ asset_path, depth, max_children }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
registry = unreal.AssetRegistryHelpers.get_asset_registry()
max_children = {{max_children}}

def build_tree(path, remaining_depth, seen):
    if path in seen:
        return {"path": path, "cycle": True}
    if remaining_depth <= 0:
        return {"path": path, "truncated": True}
    seen = seen | {path}
    deps = registry.get_dependencies(path) or []
    dep_list = [str(d) for d in deps]
    children = [build_tree(d, remaining_depth - 1, seen) for d in dep_list[:max_children]]
    node = {"path": path, "children": children}
    if len(dep_list) > max_children:
        node["children_omitted"] = len(dep_list) - max_children
    return node

tree = build_tree('{{asset_path}}', {{depth}}, set())
print(json.dumps(tree, indent=2))`,
				{ asset_path, depth, max_children },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);
}
