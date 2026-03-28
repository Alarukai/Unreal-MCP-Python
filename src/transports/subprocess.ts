import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SubprocessResult } from "../types.js";
import { BuildError, TimeoutError, UnrealMcpError } from "../utils/errors.js";
import { parseBuildOutput } from "../utils/output-parser.js";

export interface SubprocessConfig {
	enginePath?: string;
	projectPath: string;
	platform: string;
	configuration: string;
	timeouts: {
		build: number;
		cook: number;
	};
}

/**
 * Runs UAT, UBT, and commandlets as child processes.
 * These don't require the editor to be running.
 */
export class SubprocessRunner {
	private config: SubprocessConfig;

	constructor(config: SubprocessConfig) {
		this.config = config;
	}

	/**
	 * Run UAT (Unreal Automation Tool) with the given command and args.
	 */
	async runUAT(command: string, args: string[] = [], timeout?: number): Promise<SubprocessResult> {
		const uatPath = this.getUATPath();
		if (!uatPath) {
			throw new UnrealMcpError(
				"Cannot find RunUAT. Set enginePath in config or UNREAL_MCP_ENGINE_PATH env var.",
				"UAT_NOT_FOUND",
			);
		}

		const fullArgs = [command, ...args];
		return this.spawn(uatPath, fullArgs, timeout || this.config.timeouts.build);
	}

	/**
	 * Run BuildCookRun — the main build pipeline command.
	 */
	async buildCookRun(options: {
		build?: boolean;
		cook?: boolean;
		stage?: boolean;
		package?: boolean;
		archive?: boolean;
		deploy?: boolean;
		run?: boolean;
		iterate?: boolean;
		compressed?: boolean;
		platform?: string;
		configuration?: string;
		additionalArgs?: string[];
	}): Promise<SubprocessResult> {
		const args: string[] = [];

		args.push(`-project=${this.config.projectPath}`);
		args.push(`-platform=${options.platform || this.config.platform}`);
		args.push(`-clientconfig=${options.configuration || this.config.configuration}`);

		if (options.build) args.push("-build");
		if (options.cook) args.push("-cook");
		if (options.stage) args.push("-stage");
		if (options.package) args.push("-package");
		if (options.archive) args.push("-archive");
		if (options.deploy) args.push("-deploy");
		if (options.run) args.push("-run");
		if (options.iterate) args.push("-iterate");
		if (options.compressed) args.push("-compressed");

		if (options.additionalArgs) {
			args.push(...options.additionalArgs);
		}

		return this.runUAT("BuildCookRun", args, this.config.timeouts.cook);
	}

	/**
	 * Run UBT (UnrealBuildTool) to compile C++ code.
	 */
	async runUBT(args: string[], timeout?: number): Promise<SubprocessResult> {
		const ubtPath = this.getUBTPath();
		if (!ubtPath) {
			throw new UnrealMcpError(
				"Cannot find UnrealBuildTool. Set enginePath in config or UNREAL_MCP_ENGINE_PATH env var.",
				"UBT_NOT_FOUND",
			);
		}

		return this.spawn(ubtPath, args, timeout || this.config.timeouts.build);
	}

	/**
	 * Run a UE commandlet (headless batch operation).
	 */
	async runCommandlet(
		commandletName: string,
		args: string[] = [],
		timeout?: number,
	): Promise<SubprocessResult> {
		const editorPath = this.getEditorPath();
		if (!editorPath) {
			throw new UnrealMcpError(
				"Cannot find UnrealEditor. Set enginePath in config.",
				"EDITOR_NOT_FOUND",
			);
		}

		const fullArgs = [this.config.projectPath, `-run=${commandletName}`, ...args];
		return this.spawn(editorPath, fullArgs, timeout || this.config.timeouts.build);
	}

	/**
	 * Generate project files (VS/Xcode/Rider).
	 */
	async generateProjectFiles(): Promise<SubprocessResult> {
		return this.runUAT("GenerateProjectFiles", [`-project=${this.config.projectPath}`]);
	}

	private getUATPath(): string | null {
		if (!this.config.enginePath) return null;

		const candidates = [
			join(this.config.enginePath, "Engine", "Build", "BatchFiles", "RunUAT.bat"),
			join(this.config.enginePath, "Engine", "Build", "BatchFiles", "RunUAT.sh"),
		];

		for (const candidate of candidates) {
			if (existsSync(candidate)) return candidate;
		}
		return null;
	}

	private getUBTPath(): string | null {
		if (!this.config.enginePath) return null;

		const candidates = [
			join(
				this.config.enginePath,
				"Engine",
				"Binaries",
				"DotNET",
				"UnrealBuildTool",
				"UnrealBuildTool.exe",
			),
			join(
				this.config.enginePath,
				"Engine",
				"Binaries",
				"DotNET",
				"UnrealBuildTool",
				"UnrealBuildTool",
			),
		];

		for (const candidate of candidates) {
			if (existsSync(candidate)) return candidate;
		}
		return null;
	}

	private getEditorPath(): string | null {
		if (!this.config.enginePath) return null;

		const candidates = [
			join(this.config.enginePath, "Engine", "Binaries", "Win64", "UnrealEditor.exe"),
			join(this.config.enginePath, "Engine", "Binaries", "Win64", "UnrealEditor-Cmd.exe"),
			join(this.config.enginePath, "Engine", "Binaries", "Linux", "UnrealEditor"),
			join(this.config.enginePath, "Engine", "Binaries", "Mac", "UnrealEditor"),
		];

		for (const candidate of candidates) {
			if (existsSync(candidate)) return candidate;
		}
		return null;
	}

	private async spawn(command: string, args: string[], timeout: number): Promise<SubprocessResult> {
		return new Promise<SubprocessResult>((resolve, reject) => {
			const startTime = Date.now();
			const stdoutChunks: string[] = [];
			const stderrChunks: string[] = [];

			const child = spawn(command, args, {
				shell: true,
				stdio: ["pipe", "pipe", "pipe"],
			});

			const timer = setTimeout(() => {
				child.kill("SIGTERM");
				reject(new TimeoutError(`${command} ${args[0] || ""}`, timeout));
			}, timeout);

			child.stdout?.on("data", (data: Buffer) => {
				stdoutChunks.push(data.toString());
			});

			child.stderr?.on("data", (data: Buffer) => {
				stderrChunks.push(data.toString());
			});

			child.on("close", (exitCode) => {
				clearTimeout(timer);
				const stdout = stdoutChunks.join("");
				const stderr = stderrChunks.join("");
				const duration = Date.now() - startTime;
				const parsed = parseBuildOutput(`${stdout}\n${stderr}`);

				resolve({
					exitCode: exitCode ?? 1,
					stdout,
					stderr,
					duration,
					parsed,
				});
			});

			child.on("error", (err) => {
				clearTimeout(timer);
				reject(
					new UnrealMcpError(`Failed to spawn process: ${err.message}`, "SPAWN_FAILED", {
						command,
						args,
					}),
				);
			});
		});
	}
}
