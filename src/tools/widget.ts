import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";
import { inlineScript } from "../utils/template.js";

const FIND_WIDGET_HELPER = `def find_by_name(widget, target_name):
    if widget is None:
        return None
    if widget.get_name() == target_name:
        return widget
    if isinstance(widget, unreal.PanelWidget):
        for child in widget.get_all_children():
            found = find_by_name(child, target_name)
            if found:
                return found
    return None`;

export function registerWidgetTools(
	server: McpServer,
	manager: ConnectionManager,
	_config: UnrealMcpConfig,
): void {
	server.tool(
		"create_widget_blueprint",
		"Create a new Widget Blueprint (UMG) with a chosen root panel widget. Does not compile — call compile_blueprint once the tree is fully built.",
		{
			name: z.string().describe("Widget Blueprint asset name"),
			path: z.string().default("/Game/UI").describe("Content directory to create in"),
			root_widget_type: z
				.string()
				.default("CanvasPanel")
				.describe(
					"Root panel widget class, e.g. CanvasPanel, VerticalBox, HorizontalBox, Overlay, ScrollBox",
				),
		},
		async ({ name, path, root_widget_type }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
factory = unreal.WidgetBlueprintFactory()
asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
bp = asset_tools.create_asset('{{name}}', '{{path}}', unreal.WidgetBlueprint, factory)
if not bp:
    print(json.dumps({"error": "Failed to create WidgetBlueprint"}))
else:
    warnings = []
    root_type = '{{root_widget_type}}'
    root_class = getattr(unreal, root_type, None)
    if root_class is None:
        warnings.append('Unknown root widget type: ' + root_type + '; falling back to CanvasPanel')
        root_class = unreal.CanvasPanel
    tree = bp.widget_tree
    root_widget = tree.construct_widget(root_class, '{{name}}' + '_Root')
    tree.set_editor_property('RootWidget', root_widget)
    bp.modify()
    print(json.dumps({
        "success": True,
        "name": bp.get_name(),
        "path": bp.get_path_name(),
        "root_widget": root_widget.get_name(),
        "warnings": warnings,
    }))`,
				{ name, path, root_widget_type },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"read_widget_blueprint",
		"Read a Widget Blueprint's widget tree (names, classes, parent/child structure) back.",
		{ blueprint_path: z.string().describe("Widget Blueprint asset path") },
		{ readOnlyHint: true },
		async ({ blueprint_path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
bp = unreal.EditorAssetLibrary.load_asset('{{blueprint_path}}')
if not bp:
    print(json.dumps({"error": "WidgetBlueprint not found: {{blueprint_path}}"}))
elif not isinstance(bp, unreal.WidgetBlueprint):
    print(json.dumps({"error": "Asset is not a WidgetBlueprint: {{blueprint_path}}"}))
else:
    def describe(widget):
        if widget is None:
            return None
        node = {"name": widget.get_name(), "class": widget.get_class().get_name()}
        if isinstance(widget, unreal.PanelWidget):
            node["children"] = [describe(c) for c in widget.get_all_children()]
        return node
    tree = bp.widget_tree
    root = tree.root_widget if tree else None
    print(json.dumps({"success": True, "root": describe(root)}, indent=2))`,
				{ blueprint_path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"add_widget",
		"Add a child widget to a Widget Blueprint's tree, under an existing panel widget (or the root, if parent_name is omitted). Mutates the tree and marks the asset modified, but does not compile — call compile_blueprint once you're done adding widgets (compiling mid-tree-mutation can crash the editor).",
		{
			blueprint_path: z.string().describe("Widget Blueprint asset path"),
			widget_type: z
				.string()
				.describe("Widget class name, e.g. TextBlock, Button, Image, VerticalBox, Border"),
			widget_name: z.string().describe("Name for the new widget"),
			parent_name: z
				.string()
				.optional()
				.describe("Name of an existing panel widget to add as a child of (defaults to root)"),
		},
		async ({ blueprint_path, widget_type, widget_name, parent_name }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
bp = unreal.EditorAssetLibrary.load_asset('{{blueprint_path}}')
if not bp:
    print(json.dumps({"error": "WidgetBlueprint not found: {{blueprint_path}}"}))
elif not isinstance(bp, unreal.WidgetBlueprint):
    print(json.dumps({"error": "Asset is not a WidgetBlueprint: {{blueprint_path}}"}))
else:
    tree = bp.widget_tree
    widget_class = getattr(unreal, '{{widget_type}}', None)
    if widget_class is None:
        print(json.dumps({"error": "Unknown widget type: {{widget_type}}"}))
    else:
${FIND_WIDGET_HELPER.split("\n")
	.map((l) => `        ${l}`)
	.join("\n")}
        parent_name = '{{parent_name}}'
        parent = find_by_name(tree.root_widget, parent_name) if parent_name else tree.root_widget
        if parent is None:
            print(json.dumps({"error": "Parent widget not found: " + (parent_name or "(root)")}))
        elif not isinstance(parent, unreal.PanelWidget):
            print(json.dumps({"error": "Parent widget is not a PanelWidget (cannot have children): " + parent.get_name()}))
        else:
            new_widget = tree.construct_widget(widget_class, '{{widget_name}}')
            slot = parent.add_child(new_widget)
            bp.modify()
            print(json.dumps({
                "success": True,
                "widget": new_widget.get_name(),
                "parent": parent.get_name(),
                "slot_class": slot.get_class().get_name() if slot else None,
            }))`,
				{ blueprint_path, widget_type, widget_name, parent_name: parent_name || "" },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"set_widget_property",
		"Set a property on a widget within a Widget Blueprint's tree (found by name). For slot layout properties (e.g. Padding on a child of a VerticalBox), use the widget's Slot object via a dot path like 'Slot.Padding'. Mutates and marks the asset modified, but does not compile.",
		{
			blueprint_path: z.string().describe("Widget Blueprint asset path"),
			widget_name: z.string().describe("Name of the widget to modify"),
			property_name: z
				.string()
				.describe("Property name, or 'Slot.PropertyName' for slot layout properties"),
			property_value: z
				.string()
				.describe(
					"Property value — asset paths (/Game/...), Python expressions (True, 42.0), or plain strings",
				),
		},
		async ({ blueprint_path, widget_name, property_name, property_value }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
bp = unreal.EditorAssetLibrary.load_asset('{{blueprint_path}}')
if not bp:
    print(json.dumps({"error": "WidgetBlueprint not found: {{blueprint_path}}"}))
elif not isinstance(bp, unreal.WidgetBlueprint):
    print(json.dumps({"error": "Asset is not a WidgetBlueprint: {{blueprint_path}}"}))
else:
${FIND_WIDGET_HELPER.split("\n")
	.map((l) => `    ${l}`)
	.join("\n")}
    tree = bp.widget_tree
    widget = find_by_name(tree.root_widget, '{{widget_name}}')
    if widget is None:
        print(json.dumps({"error": "Widget not found: {{widget_name}}"}))
    else:
        prop_name = '{{property_name}}'
        raw_value = '{{property_value}}'

        value = raw_value
        if raw_value.startswith('/Game/') or raw_value.startswith('/Script/') or raw_value.startswith('/Engine/'):
            loaded = unreal.EditorAssetLibrary.load_asset(raw_value)
            if loaded:
                value = loaded
            else:
                print(json.dumps({"error": "Could not load asset: " + raw_value}))
                raise SystemExit()
        elif raw_value in ('True', 'False'):
            value = raw_value == 'True'
        elif raw_value == 'None':
            value = None
        else:
            try:
                value = float(raw_value) if '.' in raw_value else int(raw_value)
            except ValueError:
                value = raw_value

        target = widget
        final_prop = prop_name
        if '.' in prop_name:
            target_name, final_prop = prop_name.split('.', 1)
            if target_name == 'Slot':
                target = widget.slot
                if target is None:
                    print(json.dumps({"error": "Widget has no Slot (not yet added to a panel?): {{widget_name}}"}))
                    raise SystemExit()
            else:
                print(json.dumps({"error": "Unsupported property path prefix: " + target_name}))
                raise SystemExit()

        try:
            target.set_editor_property(final_prop, value)
            bp.modify()
            print(json.dumps({"success": True, "widget": '{{widget_name}}', "property": prop_name}))
        except Exception as e:
            print(json.dumps({"error": str(e)}))`,
				{ blueprint_path, widget_name, property_name, property_value },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);
}
