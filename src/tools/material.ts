import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConnectionManager } from "../transports/connection-manager.js";
import type { UnrealMcpConfig } from "../types.js";
import { inlineScript } from "../utils/template.js";

export function registerMaterialTools(
	server: McpServer,
	manager: ConnectionManager,
	_config: UnrealMcpConfig,
): void {
	server.tool(
		"create_material",
		"Create a new material asset.",
		{
			name: z.string().describe("Material name"),
			path: z.string().default("/Game/Materials").describe("Content directory"),
		},
		async ({ name, path }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
factory = unreal.MaterialFactoryNew()
asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
material = asset_tools.create_asset('{{name}}', '{{path}}', unreal.Material, factory)
if material:
    print(json.dumps({"success": True, "name": material.get_name(), "path": material.get_path_name()}))
else:
    print(json.dumps({"error": "Failed to create material"}))`,
				{ name, path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"apply_material",
		"Apply a material to an actor's mesh component.",
		{
			actor_name: z.string().describe("Actor name or label"),
			material_path: z.string().describe("Material asset path"),
			slot_index: z.number().default(0).describe("Material slot index"),
		},
		async ({ actor_name, material_path, slot_index }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
material = unreal.EditorAssetLibrary.load_asset('{{material_path}}')
if not material:
    print(json.dumps({"error": "Material not found: {{material_path}}"}))
else:
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
    for a in actors:
        if a.get_name() == '{{actor_name}}' or a.get_actor_label() == '{{actor_name}}':
            comps = a.get_components_by_class(unreal.MeshComponent)
            if comps:
                comps[0].set_material({{slot_index}}, material)
                print(json.dumps({"success": True}))
            else:
                print(json.dumps({"error": "No mesh component found"}))
            break
    else:
        print(json.dumps({"error": "Actor not found: {{actor_name}}"}))`,
				{ actor_name, material_path, slot_index },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"create_material_expression",
		"Add an expression node to a material's graph (e.g., TextureSample, Multiply, Constant3Vector).",
		{
			material_path: z.string().describe("Material asset path"),
			expression_class: z
				.string()
				.describe(
					"Expression class (e.g., MaterialExpressionTextureSample, MaterialExpressionMultiply, MaterialExpressionConstant3Vector, MaterialExpressionVectorParameter)",
				),
			x: z.number().default(0).describe("X position in graph"),
			y: z.number().default(0).describe("Y position in graph"),
		},
		async ({ material_path, expression_class, x, y }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
mel = unreal.MaterialEditingLibrary
material = unreal.EditorAssetLibrary.load_asset('{{material_path}}')
if material:
    expr_class = getattr(unreal, '{{expression_class}}', None)
    if expr_class:
        expr = mel.create_material_expression(material, expr_class, {{x}}, {{y}})
        if expr:
            print(json.dumps({"success": True, "name": expr.get_name(), "class": "{{expression_class}}"}))
        else:
            print(json.dumps({"error": "Failed to create expression"}))
    else:
        print(json.dumps({"error": "Expression class not found: {{expression_class}}"}))
else:
    print(json.dumps({"error": "Material not found: {{material_path}}"}))`,
				{ material_path, expression_class, x, y },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"connect_material_expressions",
		"Wire two material expression nodes together.",
		{
			material_path: z.string().describe("Material asset path"),
			from_expression_name: z.string().describe("Source expression name"),
			from_output_name: z
				.string()
				.default("")
				.describe("Source output pin name (empty string for first/default output)"),
			to_expression_name: z.string().describe("Target expression name"),
			to_input_name: z
				.string()
				.default("")
				.describe("Target input pin name (empty string for first/default input)"),
		},
		async ({
			material_path,
			from_expression_name,
			from_output_name,
			to_expression_name,
			to_input_name,
		}) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
mel = unreal.MaterialEditingLibrary
material = unreal.EditorAssetLibrary.load_asset('{{material_path}}')
if material:
    expressions = mel.get_material_expressions(material)
    from_expr = None
    to_expr = None
    for e in expressions:
        if e.get_name() == '{{from_expression_name}}':
            from_expr = e
        if e.get_name() == '{{to_expression_name}}':
            to_expr = e
    if from_expr and to_expr:
        success = mel.connect_material_expressions(from_expr, '{{from_output_name}}', to_expr, '{{to_input_name}}')
        print(json.dumps({"success": success}))
    else:
        print(json.dumps({"error": "Expression(s) not found", "available": [e.get_name() for e in expressions]}))
else:
    print(json.dumps({"error": "Material not found"}))`,
				{
					material_path,
					from_expression_name,
					to_expression_name,
					from_output_name,
					to_input_name,
				},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"connect_material_property",
		"Connect an expression to a material output property (BaseColor, Normal, Metallic, Roughness, etc.).",
		{
			material_path: z.string().describe("Material asset path"),
			expression_name: z.string().describe("Expression name to connect"),
			output_name: z
				.string()
				.default("")
				.describe("Expression output pin name (empty string for first/default output)"),
			material_property: z
				.enum([
					"MP_BaseColor",
					"MP_Metallic",
					"MP_Specular",
					"MP_Roughness",
					"MP_Normal",
					"MP_EmissiveColor",
					"MP_Opacity",
					"MP_OpacityMask",
					"MP_AmbientOcclusion",
					"MP_WorldPositionOffset",
				])
				.describe("Material property to connect to"),
		},
		async ({ material_path, expression_name, output_name, material_property }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
mel = unreal.MaterialEditingLibrary
material = unreal.EditorAssetLibrary.load_asset('{{material_path}}')
if material:
    expressions = mel.get_material_expressions(material)
    expr = None
    for e in expressions:
        if e.get_name() == '{{expression_name}}':
            expr = e
            break
    if expr:
        prop = getattr(unreal.MaterialProperty, '{{material_property}}')
        success = mel.connect_material_property(expr, '{{output_name}}', prop)
        print(json.dumps({"success": success}))
    else:
        print(json.dumps({"error": "Expression not found: {{expression_name}}"}))
else:
    print(json.dumps({"error": "Material not found"}))`,
				{ material_path, expression_name, material_property, output_name },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"delete_material_expression",
		"Remove an expression node from a material graph.",
		{
			material_path: z.string().describe("Material asset path"),
			expression_name: z.string().describe("Expression name to delete"),
		},
		{ destructiveHint: true },
		async ({ material_path, expression_name }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
mel = unreal.MaterialEditingLibrary
material = unreal.EditorAssetLibrary.load_asset('{{material_path}}')
if material:
    expressions = mel.get_material_expressions(material)
    for e in expressions:
        if e.get_name() == '{{expression_name}}':
            mel.delete_material_expression(material, e)
            print(json.dumps({"success": True}))
            break
    else:
        print(json.dumps({"error": "Expression not found: {{expression_name}}"}))
else:
    print(json.dumps({"error": "Material not found"}))`,
				{ material_path, expression_name },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"list_material_expressions",
		"List all expression nodes in a material.",
		{
			material_path: z.string().describe("Material asset path"),
		},
		{ readOnlyHint: true },
		async ({ material_path }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
mel = unreal.MaterialEditingLibrary
material = unreal.EditorAssetLibrary.load_asset('{{material_path}}')
if material:
    expressions = mel.get_material_expressions(material)
    result = [{"name": e.get_name(), "class": e.get_class().get_name()} for e in expressions]
    print(json.dumps(result, indent=2))
else:
    print(json.dumps({"error": "Material not found"}))`,
				{ material_path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"create_material_instance",
		"Create a material instance from a parent material.",
		{
			name: z.string().describe("Material instance name"),
			parent_path: z.string().describe("Parent material asset path"),
			path: z.string().default("/Game/Materials").describe("Content directory"),
		},
		async ({ name, parent_path, path }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
parent = unreal.EditorAssetLibrary.load_asset('{{parent_path}}')
if parent:
    factory = unreal.MaterialInstanceConstantFactoryNew()
    factory.set_editor_property('InitialParent', parent)
    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    mi = asset_tools.create_asset('{{name}}', '{{path}}', unreal.MaterialInstanceConstant, factory)
    if mi:
        print(json.dumps({"success": True, "name": mi.get_name(), "path": mi.get_path_name()}))
    else:
        print(json.dumps({"error": "Failed to create material instance"}))
else:
    print(json.dumps({"error": "Parent material not found"}))`,
				{ name, parent_path, path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"set_material_instance_scalar",
		"Set a scalar parameter on a material instance.",
		{
			instance_path: z.string().describe("Material instance asset path"),
			parameter_name: z.string().describe("Scalar parameter name"),
			value: z.number().describe("Parameter value"),
		},
		async ({ instance_path, parameter_name, value }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
mel = unreal.MaterialEditingLibrary
mi = unreal.EditorAssetLibrary.load_asset('{{instance_path}}')
if mi:
    mel.set_material_instance_scalar_parameter_value(mi, '{{parameter_name}}', {{value}})
    print(json.dumps({"success": True}))
else:
    print(json.dumps({"error": "Material instance not found"}))`,
				{ instance_path, parameter_name, value },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"set_material_instance_vector",
		"Set a vector parameter on a material instance.",
		{
			instance_path: z.string().describe("Material instance asset path"),
			parameter_name: z.string().describe("Vector parameter name"),
			value: z
				.object({ r: z.number(), g: z.number(), b: z.number(), a: z.number().default(1) })
				.describe("RGBA values (0-1)"),
		},
		async ({ instance_path, parameter_name, value }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
mel = unreal.MaterialEditingLibrary
mi = unreal.EditorAssetLibrary.load_asset('{{instance_path}}')
if mi:
    color = unreal.LinearColor({{value_r}}, {{value_g}}, {{value_b}}, {{value_a}})
    mel.set_material_instance_vector_parameter_value(mi, '{{parameter_name}}', color)
    print(json.dumps({"success": True}))
else:
    print(json.dumps({"error": "Material instance not found"}))`,
				{
					instance_path,
					parameter_name,
					value_r: value.r,
					value_g: value.g,
					value_b: value.b,
					value_a: value.a,
				},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"set_material_instance_texture",
		"Set a texture parameter on a material instance.",
		{
			instance_path: z.string().describe("Material instance asset path"),
			parameter_name: z.string().describe("Texture parameter name"),
			texture_path: z.string().describe("Texture asset path"),
		},
		async ({ instance_path, parameter_name, texture_path }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
mel = unreal.MaterialEditingLibrary
mi = unreal.EditorAssetLibrary.load_asset('{{instance_path}}')
texture = unreal.EditorAssetLibrary.load_asset('{{texture_path}}')
if mi and texture:
    mel.set_material_instance_texture_parameter_value(mi, '{{parameter_name}}', texture)
    print(json.dumps({"success": True}))
else:
    print(json.dumps({"error": "Material instance or texture not found"}))`,
				{ instance_path, parameter_name, texture_path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"recompile_material",
		"Recompile a material after making changes to its graph.",
		{
			material_path: z.string().describe("Material asset path"),
		},
		async ({ material_path }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
mel = unreal.MaterialEditingLibrary
material = unreal.EditorAssetLibrary.load_asset('{{material_path}}')
if material:
    mel.recompile_material(material)
    unreal.EditorAssetLibrary.save_asset('{{material_path}}')
    print(json.dumps({"success": True}))
else:
    print(json.dumps({"error": "Material not found"}))`,
				{ material_path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"create_material_function",
		"Create a reusable material function.",
		{
			name: z.string().describe("Material function name"),
			path: z.string().default("/Game/Materials/Functions").describe("Content directory"),
		},
		async ({ name, path }) => {
			manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
factory = unreal.MaterialFunctionFactoryNew()
asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
func = asset_tools.create_asset('{{name}}', '{{path}}', unreal.MaterialFunction, factory)
if func:
    print(json.dumps({"success": True, "name": func.get_name(), "path": func.get_path_name()}))
else:
    print(json.dumps({"error": "Failed to create material function"}))`,
				{ name, path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);
}
