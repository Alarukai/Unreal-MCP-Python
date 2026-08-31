import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, parseCliArgs } from "./config.js";

describe("parseCliArgs", () => {
	it("parses each known flag", () => {
		const argv = [
			"--project-path",
			"/my/project",
			"--engine-path",
			"/my/engine",
			"--rc-port",
			"1234",
			"--python-port",
			"5678",
			"--plugin-port",
			"9999",
			"--multicast-bind",
			"0.0.0.0",
			"--multicast-iface",
			"192.168.1.50",
			"--platform",
			"Linux",
			"--configuration",
			"Shipping",
			"--modules",
			"asset, blueprint ,material",
		];
		expect(parseCliArgs(argv)).toEqual({
			projectPath: "/my/project",
			enginePath: "/my/engine",
			remoteControlPort: 1234,
			pythonExecPort: 5678,
			pluginBridgePort: 9999,
			multicastBindAddress: "0.0.0.0",
			multicastInterface: "192.168.1.50",
			platform: "Linux",
			configuration: "Shipping",
			enabledModules: ["asset", "blueprint", "material"],
		});
	});

	it("ignores unknown flags", () => {
		expect(parseCliArgs(["--not-a-real-flag", "value"])).toEqual({});
	});

	it("does not crash when a flag is the last argv element with no value", () => {
		expect(() => parseCliArgs(["--platform"])).not.toThrow();
	});

	it("returns an empty object for empty argv", () => {
		expect(parseCliArgs([])).toEqual({});
	});
});

describe("loadConfig", () => {
	const ENV_KEYS = [
		"UNREAL_MCP_PROJECT_PATH",
		"UNREAL_MCP_ENGINE_PATH",
		"UNREAL_MCP_RC_PORT",
		"UNREAL_MCP_PYTHON_PORT",
		"UNREAL_MCP_MULTICAST_BIND",
		"UNREAL_MCP_MULTICAST_IFACE",
		"UNREAL_MCP_PLATFORM",
		"UNREAL_MCP_CONFIGURATION",
		"UNREAL_MCP_MODULES",
	] as const;

	let originalCwd: string;
	let originalHome: string | undefined;
	let originalEnv: Record<string, string | undefined>;
	let tempDir: string;
	let tempHome: string;

	beforeEach(() => {
		originalCwd = process.cwd();
		originalHome = process.env.HOME;
		originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
		for (const k of ENV_KEYS) delete process.env[k];

		// Isolate from any real .unrealmcp.json on this machine: both the cwd
		// candidate and the HOME candidate must point at empty temp directories
		// unless a test deliberately writes a file into one of them.
		tempDir = mkdtempSync(join(tmpdir(), "unrealmcp-test-cwd-"));
		tempHome = mkdtempSync(join(tmpdir(), "unrealmcp-test-home-"));
		process.env.HOME = tempHome;
		process.chdir(tempDir);
	});

	afterEach(() => {
		process.chdir(originalCwd);
		if (originalHome === undefined) {
			// biome-ignore lint/performance/noDelete: restoring env to its exact prior state
			delete process.env.HOME;
		} else {
			process.env.HOME = originalHome;
		}
		for (const k of ENV_KEYS) {
			if (originalEnv[k] === undefined) {
				delete process.env[k];
			} else {
				process.env[k] = originalEnv[k];
			}
		}
		rmSync(tempDir, { recursive: true, force: true });
		rmSync(tempHome, { recursive: true, force: true });
	});

	it("falls back to documented defaults with no file, env, or CLI input", () => {
		const config = loadConfig([]);
		expect(config.remoteControlPort).toBe(30010);
		expect(config.pythonExecPort).toBe(6776);
		expect(config.multicastBindAddress).toBe("127.0.0.1");
		expect(config.platform).toBe("Win64");
		expect(config.configuration).toBe("Development");
		expect(config.timeouts).toEqual({
			build: 600_000,
			cook: 1_200_000,
			remoteControl: 10_000,
			pythonExec: 30_000,
		});
	});

	it("applies values from a .unrealmcp.json in the working directory", () => {
		writeFileSync(
			join(tempDir, ".unrealmcp.json"),
			JSON.stringify({ platform: "Linux", timeouts: { build: 111 } }),
		);
		const config = loadConfig([]);
		expect(config.platform).toBe("Linux");
		// Only the overridden timeout key changes — the rest keep their defaults.
		expect(config.timeouts.build).toBe(111);
		expect(config.timeouts.cook).toBe(1_200_000);
	});

	it("ignores a config file with invalid JSON instead of throwing", () => {
		writeFileSync(join(tempDir, ".unrealmcp.json"), "{ this is not valid json");
		expect(() => loadConfig([])).not.toThrow();
		expect(loadConfig([]).platform).toBe("Win64"); // falls through to defaults
	});

	it("lets an environment variable override the config file", () => {
		writeFileSync(join(tempDir, ".unrealmcp.json"), JSON.stringify({ platform: "Linux" }));
		process.env.UNREAL_MCP_PLATFORM = "Mac";
		expect(loadConfig([]).platform).toBe("Mac");
	});

	it("lets a CLI argument override both the environment variable and the config file", () => {
		writeFileSync(join(tempDir, ".unrealmcp.json"), JSON.stringify({ platform: "Linux" }));
		process.env.UNREAL_MCP_PLATFORM = "Mac";
		expect(loadConfig(["--platform", "IOS"]).platform).toBe("IOS");
	});

	it("splits and trims UNREAL_MCP_MODULES from the environment", () => {
		process.env.UNREAL_MCP_MODULES = "asset, blueprint ,material";
		expect(loadConfig([]).enabledModules).toEqual(["asset", "blueprint", "material"]);
	});

	it("leaves multicastInterface unset by default (auto-detected downstream)", () => {
		expect(loadConfig([]).multicastInterface).toBeUndefined();
	});

	it("applies UNREAL_MCP_MULTICAST_IFACE from the environment", () => {
		process.env.UNREAL_MCP_MULTICAST_IFACE = "10.0.0.5";
		expect(loadConfig([]).multicastInterface).toBe("10.0.0.5");
	});

	it("resolves a relative projectPath to an absolute path", () => {
		const config = loadConfig(["--project-path", "./MyProject"]);
		expect(config.projectPath.startsWith(tempDir) || config.projectPath.includes("MyProject")).toBe(
			true,
		);
		expect(config.projectPath.startsWith(".")).toBe(false);
	});
});
