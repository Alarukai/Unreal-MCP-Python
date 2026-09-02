import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ConnectionManager } from "../transports/connection-manager.js";
import { ALL_MODULES } from "../types.js";
import type { UnrealMcpConfig } from "../types.js";
import { registerAllTools } from "./index.js";

/**
 * Shared infrastructure for verifying the tool surface itself (registration
 * integrity, generated-Python syntax) rather than UE-side behavior. Used by
 * both `index.test.ts` (fast, part of `npm test`) and
 * `tool-verification.verify.ts` (`npm run verify-tools`, generates and
 * ast.parse-checks every tool's Python).
 *
 * This never calls ConnectionManager.initialize() — that probes real
 * sockets (Python Remote Execution's UDP discovery alone waits up to 5s per
 * attempt with no editor present). Instead every transport a tool might
 * touch is stubbed directly.
 */

export interface CapturedScript {
	tool: string;
	script: string;
}

export interface ToolHarness {
	server: McpServer;
	client: Client;
	manager: ConnectionManager;
	scripts: CapturedScript[];
	/** Set before invoking a tool's handler so manager.runPython() knows which
	 * tool a captured script belongs to. Single-threaded, sequential use only. */
	setCurrentTool(tool: string): void;
	close(): Promise<void>;
}

const FAKE_CONFIG: UnrealMcpConfig = {
	projectPath: "/tmp/unreal-mcp-verify/Fake.uproject",
	remoteControlPort: 30010,
	remoteControlWsPort: 30020,
	pythonExecPort: 6776,
	pluginBridgePort: 55557,
	multicastBindAddress: "127.0.0.1",
	platform: "Win64",
	configuration: "Development",
	enabledModules: [...ALL_MODULES],
	timeouts: { build: 600_000, cook: 1_200_000, remoteControl: 10_000, pythonExec: 30_000 },
};

/**
 * A stand-in for manager.rc / manager.subprocess: any method call resolves
 * to `defaultReturn` without touching a real socket or process. A handful of
 * tools call these directly instead of going through manager.runPython()
 * (actor.ts's manager.rc.setProperty, asset.ts/build.ts's
 * manager.subprocess.*) — they don't generate Python, so they're not what
 * this harness verifies, but stubbing them keeps those tools from being
 * skipped for an unrelated "no such method" error.
 */
function stubTransport<T extends object>(defaultReturn: unknown): T {
	return new Proxy(
		{},
		{
			get: () => async () => defaultReturn,
		},
	) as T;
}

/**
 * Builds a real McpServer with every module registered, connects a real
 * MCP Client to it over an in-memory transport pair (so tool invocation goes
 * through the actual JSON-RPC request/response path, not a hand-rolled
 * handler call), and stubs every transport a tool could touch.
 */
export async function buildToolHarness(): Promise<ToolHarness> {
	const server = new McpServer({ name: "unreal-mcp-verify", version: "0.0.0" });
	const manager = new ConnectionManager();

	const scripts: CapturedScript[] = [];
	const state = { currentTool: "" };

	manager.requireEditor = async () => {};
	manager.runPython = (async (script: string) => {
		scripts.push({ tool: state.currentTool, script });
		return "{}";
	}) as ConnectionManager["runPython"];
	manager.rc = stubTransport("{}");
	manager.subprocess = stubTransport({ exitCode: 0, stdout: "", stderr: "", duration: 0 });

	registerAllTools(server, manager, FAKE_CONFIG);

	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: "unreal-mcp-verify-client", version: "0.0.0" });
	await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

	return {
		server,
		client,
		manager,
		scripts,
		setCurrentTool(tool: string) {
			state.currentTool = tool;
		},
		async close() {
			await client.close();
		},
	};
}

/**
 * Reaches into the SDK's private tool registry to get each tool's raw Zod
 * shape (not just its serialized JSON schema) for argument synthesis, and
 * to enumerate every registered name. Pinned to
 * `@modelcontextprotocol/sdk ^1.12.1`'s `McpServer._registeredTools` shape;
 * re-check this if the SDK's internals move.
 */
export function extractRegisteredTools(
	server: McpServer,
): Record<string, { shape: z.ZodRawShape }> {
	const registry = (
		server as unknown as {
			_registeredTools: Record<string, { inputSchema?: z.ZodObject<z.ZodRawShape> }>;
		}
	)._registeredTools;

	const out: Record<string, { shape: z.ZodRawShape }> = {};
	for (const [name, tool] of Object.entries(registry)) {
		out[name] = { shape: tool.inputSchema?.shape ?? {} };
	}
	return out;
}

export interface SynthesizeOptions {
	/** Include optional/defaulted fields with a synthesized value instead of
	 * omitting them. Omitting them is also a valid, worthwhile case to test
	 * (it's exactly the shape that caught the historical JS-boolean-literal
	 * bug — a tool that only breaks when an optional field is left out). */
	includeOptionals: boolean;
}

const SKIP = Symbol("omit-optional-field");

/** Builds a plausible argument object for a tool's Zod shape. Not exhaustive —
 * one representative value per field, not every branch of a union or every
 * array length. Unrecognized Zod node types fall back to a placeholder
 * string and are recorded in `unsynthesizable` rather than thrown, so one
 * unusual schema doesn't abort the whole sweep. */
export function synthesizeArgs(
	shape: z.ZodRawShape,
	opts: SynthesizeOptions,
	unsynthesizable: Set<string>,
	toolName: string,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, schema] of Object.entries(shape)) {
		const value = synthesizeValue(schema, opts, unsynthesizable, toolName, key);
		if (value !== SKIP) {
			result[key] = value;
		}
	}
	return result;
}

function synthesizeValue(
	schema: z.ZodTypeAny,
	opts: SynthesizeOptions,
	unsynthesizable: Set<string>,
	toolName: string,
	path: string,
): unknown {
	if (schema instanceof z.ZodOptional) {
		if (!opts.includeOptionals) return SKIP;
		return synthesizeValue(schema.unwrap(), opts, unsynthesizable, toolName, path);
	}
	if (schema instanceof z.ZodDefault) {
		if (!opts.includeOptionals) return SKIP;
		return synthesizeValue(schema.removeDefault(), opts, unsynthesizable, toolName, path);
	}
	if (schema instanceof z.ZodNullable) {
		return synthesizeValue(schema.unwrap(), opts, unsynthesizable, toolName, path);
	}
	if (schema instanceof z.ZodEffects) {
		// .refine()/.transform() — best effort from the pre-effect inner schema.
		return synthesizeValue(schema.innerType(), opts, unsynthesizable, toolName, path);
	}
	if (schema instanceof z.ZodString) return "test";
	if (schema instanceof z.ZodNumber) return 1;
	if (schema instanceof z.ZodBoolean) return true;
	if (schema instanceof z.ZodLiteral) return schema.value;
	if (schema instanceof z.ZodEnum) return schema.options[0];
	if (schema instanceof z.ZodNativeEnum) {
		return Object.values(schema.enum)[0];
	}
	if (schema instanceof z.ZodArray) {
		const element = synthesizeValue(
			schema.element,
			{ includeOptionals: true },
			unsynthesizable,
			toolName,
			`${path}[]`,
		);
		return element === SKIP ? [] : [element];
	}
	if (schema instanceof z.ZodObject) {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(schema.shape)) {
			const val = synthesizeValue(
				v as z.ZodTypeAny,
				{ includeOptionals: true },
				unsynthesizable,
				toolName,
				`${path}.${k}`,
			);
			if (val !== SKIP) out[k] = val;
		}
		return out;
	}
	if (schema instanceof z.ZodRecord) {
		const val = synthesizeValue(
			schema.valueSchema,
			{ includeOptionals: true },
			unsynthesizable,
			toolName,
			`${path}{}`,
		);
		return { key: val === SKIP ? "test" : val };
	}
	if (schema instanceof z.ZodUnion) {
		return synthesizeValue(schema.options[0], opts, unsynthesizable, toolName, path);
	}
	if (schema instanceof z.ZodUnknown || schema instanceof z.ZodAny) {
		return {};
	}
	unsynthesizable.add(`${toolName}.${path} (${schema.constructor.name})`);
	return "test";
}
