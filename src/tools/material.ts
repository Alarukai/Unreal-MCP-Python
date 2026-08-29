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
			await manager.requireEditor();
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
			await manager.requireEditor();
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
			await manager.requireEditor();
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
			await manager.requireEditor();
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
			await manager.requireEditor();
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
			await manager.requireEditor();
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
			await manager.requireEditor();
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
			await manager.requireEditor();
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
			await manager.requireEditor();
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
			await manager.requireEditor();
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
			await manager.requireEditor();
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
			await manager.requireEditor();
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
			await manager.requireEditor();
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

	server.tool(
		"find_material_functions",
		"Search a content directory for Material Function assets.",
		{
			directory: z.string().default("/Game").describe("Content directory path"),
			recursive: z.boolean().default(true).describe("Include subdirectories"),
		},
		{ readOnlyHint: true },
		async ({ directory, recursive }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
registry = unreal.AssetRegistryHelpers.get_asset_registry()
assets = registry.get_assets_by_path('{{directory}}', {{recursive}}) or []
results = []
for a in assets:
    cls = str(a.asset_class_path.asset_name) if hasattr(a, 'asset_class_path') else str(a.asset_class)
    if cls != 'MaterialFunction':
        continue
    results.append({
        "name": str(a.asset_name),
        "path": str(a.package_name) + '.' + str(a.asset_name),
        "package": str(a.package_name),
    })
print(json.dumps(results, indent=2))`,
				{ directory, recursive: recursive ? "True" : "False" },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"inspect_material_function",
		"Inspect a Material Function's graph: all expression nodes, plus a specifically-typed breakdown of its FunctionInput/FunctionOutput pins (name, type, default preview value).",
		{ function_path: z.string().describe("Material function asset path") },
		{ readOnlyHint: true },
		async ({ function_path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
mel = unreal.MaterialEditingLibrary
func = unreal.EditorAssetLibrary.load_asset('{{function_path}}')
if not func or not isinstance(func, unreal.MaterialFunction):
    print(json.dumps({"error": "MaterialFunction not found: {{function_path}}"}))
else:
    expressions = mel.get_material_expressions(func)
    all_expr = [{"name": e.get_name(), "class": e.get_class().get_name()} for e in expressions]
    inputs = []
    outputs = []
    for e in expressions:
        if isinstance(e, unreal.MaterialExpressionFunctionInput):
            entry = {"name": e.get_name()}
            try:
                entry["input_name"] = str(e.get_editor_property('InputName'))
            except Exception:
                entry["input_name"] = None
            try:
                entry["input_type"] = str(e.get_editor_property('InputType'))
            except Exception:
                entry["input_type"] = None
            try:
                pv = e.get_editor_property('PreviewValue')
                entry["preview_value"] = {"x": pv.x, "y": pv.y, "z": pv.z, "w": pv.w}
            except Exception:
                entry["preview_value"] = None
            inputs.append(entry)
        elif isinstance(e, unreal.MaterialExpressionFunctionOutput):
            entry = {"name": e.get_name()}
            try:
                entry["output_name"] = str(e.get_editor_property('OutputName'))
            except Exception:
                entry["output_name"] = None
            outputs.append(entry)
    print(json.dumps({
        "success": True,
        "name": func.get_name(),
        "expressions": all_expr,
        "inputs": inputs,
        "outputs": outputs,
    }, indent=2))`,
				{ function_path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"edit_material_function",
		"Edit a Material Function's graph: add a typed input pin, add an output pin, delete an expression, or connect two expressions. Reuses MaterialEditingLibrary (the same API used for regular materials), which also operates on MaterialFunction assets.",
		{
			function_path: z.string().describe("Material function asset path"),
			operation: z
				.enum(["add_input", "add_output", "delete_expression", "connect"])
				.describe("Which edit to perform"),
			name: z.string().optional().describe("Pin name — required for add_input/add_output"),
			input_type: z
				.enum([
					"Scalar",
					"Vector2",
					"Vector3",
					"Vector4",
					"Texture2D",
					"TextureCube",
					"StaticBool",
					"MaterialAttributes",
				])
				.optional()
				.describe("Input pin type — required for add_input"),
			preview_value: z
				.object({
					x: z.number().default(0),
					y: z.number().default(0),
					z: z.number().default(0),
					w: z.number().default(1),
				})
				.optional()
				.describe(
					"Default value for add_input on Scalar (uses x)/Vector2 (x,y)/Vector3 (x,y,z)/Vector4 (x,y,z,w) inputs. Ignored for Texture2D/TextureCube/MaterialAttributes.",
				),
			bool_value: z
				.boolean()
				.optional()
				.describe("Default value for add_input on a StaticBool input"),
			x: z.number().default(0).describe("X position in graph — for add_input/add_output"),
			y: z.number().default(0).describe("Y position in graph — for add_input/add_output"),
			expression_name: z
				.string()
				.optional()
				.describe("Expression name to delete — required for delete_expression"),
			from_expression_name: z
				.string()
				.optional()
				.describe("Source expression name — required for connect"),
			from_output_name: z
				.string()
				.default("")
				.describe("Source output pin name (empty for first/default output) — for connect"),
			to_expression_name: z
				.string()
				.optional()
				.describe("Target expression name — required for connect"),
			to_input_name: z
				.string()
				.default("")
				.describe("Target input pin name (empty for first/default input) — for connect"),
		},
		async ({
			function_path,
			operation,
			name,
			input_type,
			preview_value,
			bool_value,
			x,
			y,
			expression_name,
			from_expression_name,
			from_output_name,
			to_expression_name,
			to_input_name,
		}) => {
			await manager.requireEditor();

			// Typed input validation (per operation), enforced before touching the editor.
			if (operation === "add_input") {
				if (!name) {
					return {
						content: [
							{ type: "text", text: JSON.stringify({ error: "add_input requires 'name'" }) },
						],
					};
				}
				if (!input_type) {
					return {
						content: [
							{ type: "text", text: JSON.stringify({ error: "add_input requires 'input_type'" }) },
						],
					};
				}
				if (input_type === "StaticBool" && bool_value === undefined) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									error: "add_input with input_type=StaticBool requires 'bool_value'",
								}),
							},
						],
					};
				}
			}
			if (operation === "add_output" && !name) {
				return {
					content: [
						{ type: "text", text: JSON.stringify({ error: "add_output requires 'name'" }) },
					],
				};
			}
			if (operation === "delete_expression" && !expression_name) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({ error: "delete_expression requires 'expression_name'" }),
						},
					],
				};
			}
			if (operation === "connect" && (!from_expression_name || !to_expression_name)) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								error: "connect requires 'from_expression_name' and 'to_expression_name'",
							}),
						},
					],
				};
			}

			const usePreview =
				input_type &&
				input_type !== "Texture2D" &&
				input_type !== "TextureCube" &&
				input_type !== "MaterialAttributes";
			const pv =
				input_type === "StaticBool"
					? { x: bool_value ? 1 : 0, y: 0, z: 0, w: 1 }
					: (preview_value ?? { x: 0, y: 0, z: 0, w: 1 });

			const script = inlineScript(
				`import unreal
import json
mel = unreal.MaterialEditingLibrary
func = unreal.EditorAssetLibrary.load_asset('{{function_path}}')
if not func or not isinstance(func, unreal.MaterialFunction):
    print(json.dumps({"error": "MaterialFunction not found: {{function_path}}"}))
else:
    op = '{{operation}}'
    if op == 'add_input':
        expr = mel.create_material_expression(func, unreal.MaterialExpressionFunctionInput, {{x}}, {{y}})
        if not expr:
            print(json.dumps({"error": "Failed to create FunctionInput expression"}))
        else:
            warnings = []
            expr.set_editor_property('InputName', '{{name}}')
            input_type = getattr(unreal.FunctionInputType, 'FunctionInput_{{input_type}}', None)
            if input_type is not None:
                expr.set_editor_property('InputType', input_type)
            else:
                warnings.append('Unknown input_type: {{input_type}}')
            if {{use_preview}}:
                try:
                    expr.set_editor_property('PreviewValue', unreal.Vector4({{pv_x}}, {{pv_y}}, {{pv_z}}, {{pv_w}}))
                    expr.set_editor_property('bUsePreviewValueAsDefault', True)
                except Exception as e:
                    warnings.append('PreviewValue: ' + str(e))
            print(json.dumps({"success": True, "expression": expr.get_name(), "warnings": warnings}))
    elif op == 'add_output':
        expr = mel.create_material_expression(func, unreal.MaterialExpressionFunctionOutput, {{x}}, {{y}})
        if not expr:
            print(json.dumps({"error": "Failed to create FunctionOutput expression"}))
        else:
            expr.set_editor_property('OutputName', '{{name}}')
            print(json.dumps({"success": True, "expression": expr.get_name()}))
    elif op == 'delete_expression':
        expressions = mel.get_material_expressions(func)
        for e in expressions:
            if e.get_name() == '{{expression_name}}':
                mel.delete_material_expression(func, e)
                print(json.dumps({"success": True}))
                break
        else:
            print(json.dumps({"error": "Expression not found: {{expression_name}}"}))
    elif op == 'connect':
        expressions = mel.get_material_expressions(func)
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
        print(json.dumps({"error": "Unknown operation: " + op}))`,
				{
					function_path,
					operation,
					name: name || "",
					input_type: input_type || "",
					use_preview: usePreview ? "True" : "False",
					pv_x: pv.x,
					pv_y: pv.y,
					pv_z: pv.z,
					pv_w: pv.w,
					x,
					y,
					expression_name: expression_name || "",
					from_expression_name: from_expression_name || "",
					from_output_name,
					to_expression_name: to_expression_name || "",
					to_input_name,
				},
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"delete_material_function",
		"Delete a Material Function asset.",
		{ function_path: z.string().describe("Material function asset path") },
		{ destructiveHint: true },
		async ({ function_path }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
if not unreal.EditorAssetLibrary.does_asset_exist('{{function_path}}'):
    print(json.dumps({"error": "MaterialFunction not found: {{function_path}}"}))
else:
    success = unreal.EditorAssetLibrary.delete_asset('{{function_path}}')
    print(json.dumps({"success": success}))`,
				{ function_path },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);

	server.tool(
		"set_material_property",
		"Set a top-level property on a master Material (not an expression node) — e.g. BlendMode, ShadingModel, TwoSided, DitheredLODTransition.",
		{
			material_path: z.string().describe("Material asset path"),
			property_name: z
				.string()
				.describe("Property name, e.g. BlendMode, ShadingModel, TwoSided, bUsedWithSkeletalMesh"),
			property_value: z
				.string()
				.describe(
					"Property value — enum names (BLEND_Translucent, MSM_Unlit), True/False for bools, or plain strings",
				),
		},
		async ({ material_path, property_name, property_value }) => {
			await manager.requireEditor();
			const script = inlineScript(
				`import unreal
import json
mat = unreal.EditorAssetLibrary.load_asset('{{material_path}}')
if not mat or not isinstance(mat, unreal.Material):
    print(json.dumps({"error": "Material not found: {{material_path}}"}))
else:
    prop_name = '{{property_name}}'
    raw_value = '{{property_value}}'

    value = raw_value
    if raw_value in ('True', 'False'):
        value = raw_value == 'True'
    else:
        blend_enum = getattr(unreal.BlendMode, raw_value, None)
        shading_enum = getattr(unreal.MaterialShadingModel, raw_value, None)
        if blend_enum is not None:
            value = blend_enum
        elif shading_enum is not None:
            value = shading_enum
        else:
            try:
                value = float(raw_value) if '.' in raw_value else int(raw_value)
            except ValueError:
                value = raw_value

    try:
        mat.set_editor_property(prop_name, value)
        unreal.MaterialEditingLibrary.recompile_material(mat)
        unreal.EditorAssetLibrary.save_asset('{{material_path}}')
        print(json.dumps({"success": True, "property": prop_name}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))`,
				{ material_path, property_name, property_value },
			);
			const result = await manager.runPython(script);
			return { content: [{ type: "text", text: result }] };
		},
	);
}
