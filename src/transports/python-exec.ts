import type { Socket } from "node:dgram";
import { networkInterfaces } from "node:os";
import { RemoteExecution, RemoteExecutionConfig } from "unreal-remote-execution";
import { PythonExecutionError, TimeoutError, UnrealMcpError } from "../utils/errors.js";

export interface PythonExecConfig {
	host: string;
	port: number;
	timeout: number;
	/** Bind address for the UDP multicast discovery socket. Defaults to 127.0.0.1. */
	multicastBindAddress?: string;
	/**
	 * Outbound interface for multicast discovery pings, as an IPv4 address.
	 * Only used when multicastBindAddress has been widened past loopback — see
	 * resolveMulticastInterface() for why. Auto-detected if unset.
	 */
	multicastInterface?: string;
}

/** True for 127.0.0.0/8 and ::1 — the addresses our own loopback-only default binds to. */
export function isLoopbackAddress(addr: string): boolean {
	return addr === "::1" || addr.startsWith("127.");
}

/**
 * Pick the outbound interface for multicast discovery pings.
 *
 * `unreal-remote-execution` feeds a single "multicast bind address" value to
 * three different roles: the socket bind address, the multicast group
 * membership interface, AND `setMulticastInterface()` (which selects which
 * adapter outgoing multicast actually leaves on). Binding to a specific
 * address is required to receive multicast at all on some platforms, but as
 * an *outbound* interface selector that same value leaves the OS to guess —
 * and on machines with extra adapters (Bluetooth PAN, Wi-Fi Direct, an
 * unplugged NIC, WSL, Hyper-V, VPNs) Windows routinely picks a link-local
 * 169.254.* adapter. The ping then leaves on an interface the editor is not
 * listening on and discovery fails with "Could not find a node within the
 * given time" — even though the editor is right there and answering pings
 * sent on the correct adapter.
 *
 * Only called when the configured bind address is non-loopback (0.0.0.0 or a
 * specific host/LAN address) — i.e. only once the user has already opted
 * into widening multicast beyond this project's loopback-only default, which
 * is exactly the scenario this multi-adapter problem shows up in.
 *
 * Returns an explicit override if configured, otherwise the first real
 * external IPv4, skipping APIPA addresses.
 */
export function resolveMulticastInterface(explicitOverride?: string): string | undefined {
	if (explicitOverride) return explicitOverride;

	for (const addresses of Object.values(networkInterfaces())) {
		for (const addr of addresses ?? []) {
			if (addr.family === "IPv4" && !addr.internal && !addr.address.startsWith("169.254.")) {
				return addr.address;
			}
		}
	}
	return undefined;
}

/**
 * Client for Unreal Engine's built-in Python Remote Execution protocol.
 * Uses the `unreal-remote-execution` package which implements the full protocol:
 * - UDP multicast discovery on 239.0.0.1:6766
 * - Inverted TCP model (we are the server, UE connects to us)
 * - Proper message framing with magic "ue_py" and UUIDs
 *
 * Requires "Python Editor Script Plugin" enabled in UE with
 * "Enable Remote Execution" checked in its settings.
 */
export class PythonExecClient {
	private remote: RemoteExecution;
	private timeout: number;
	private bindAddress: string;
	private explicitInterface?: string;
	private _started = false;
	private _commandReady = false;
	private _discoveryFailed = false;
	private _lastDiscoveryAttempt = 0;

	constructor(config: PythonExecConfig) {
		this.bindAddress = config.multicastBindAddress || "127.0.0.1";
		this.explicitInterface = config.multicastInterface;
		const remoteConfig = new RemoteExecutionConfig(
			0, // multicastTTL: local host only
			["239.0.0.1", 6766], // multicastGroupEndpoint (UE default)
			this.bindAddress, // multicastBindAddress — loopback-only by default; only widen if UE and this process are split across network namespaces on the same host
			[config.host, config.port], // commandEndpoint
		);
		this.remote = new RemoteExecution(remoteConfig);
		this.timeout = config.timeout;
	}

	async isAvailable(): Promise<boolean> {
		try {
			// If discovery failed recently, skip the slow 5s wait and return false
			// Retry every 30 seconds in case the user enables Remote Execution
			if (this._discoveryFailed && Date.now() - this._lastDiscoveryAttempt < 30_000) {
				return false;
			}
			if (!this._started) {
				await this.ensureStarted();
			}
			const found = this.remote.remoteNodes.length > 0;
			if (!found) {
				this._discoveryFailed = true;
				this._lastDiscoveryAttempt = Date.now();
			} else {
				this._discoveryFailed = false;
			}
			return found;
		} catch {
			this._discoveryFailed = true;
			this._lastDiscoveryAttempt = Date.now();
			return false;
		}
	}

	private async ensureStarted(): Promise<void> {
		if (this._started) return;

		try {
			await this.remote.start();
			this._started = true;

			// Only force the outbound interface once the user has already widened
			// the bind past loopback — see resolveMulticastInterface()'s docstring
			// for why this must not run against our loopback-only default.
			if (!isLoopbackAddress(this.bindAddress)) {
				this.applyMulticastInterface();
			}

			// `start()` only opens the broadcast socket — it does not emit any
			// pings. The library registers discovered nodes exclusively while it
			// is actively searching (its updateRemoteNode() only adds a new entry
			// `else if (this.isSearchingForNodes())`), so without this call
			// remoteNodes stays empty forever and every discovery attempt times
			// out, regardless of network configuration.
			//
			// Left running for the client's whole lifetime (~1 ping/sec) rather
			// than stopped once a node is found: stopSearchingForNodes() clears
			// the library's internal node list as a side effect, which would
			// immediately empty remoteNodes again and break ensureCommandConnection().
			this.remote.startSearchingForNodes();

			// Wait for UE node discovery via UDP multicast
			await new Promise<void>((resolve) => {
				const maxWait = 5000;
				const interval = 500;
				let elapsed = 0;

				const check = () => {
					if (this.remote.remoteNodes.length > 0 || elapsed >= maxWait) {
						resolve();
						return;
					}
					elapsed += interval;
					setTimeout(check, interval);
				};
				check();
			});
		} catch (err) {
			this._started = false;
			throw new UnrealMcpError(
				`Failed to start Python Remote Execution: ${err}`,
				"PYTHON_CONNECTION_FAILED",
			);
		}
	}

	/**
	 * Point outbound multicast at a real interface once the broadcast socket is
	 * up. Only called when the configured bind address is non-loopback (see
	 * ensureStarted()) — never touches our safe default.
	 *
	 * The library exposes no option for this, so the socket is reached through
	 * its private field. Best-effort: discovery may still work without this on
	 * single-adapter hosts, so this must never throw. Only the *outbound*
	 * interface is changed — bind address and group membership stay as
	 * configured, since moving group membership off 0.0.0.0 has been observed
	 * to break the receive path entirely (the reply is lost even though the
	 * ping goes out correctly).
	 */
	private applyMulticastInterface(): void {
		const iface = resolveMulticastInterface(this.explicitInterface);
		if (!iface) return;

		const socket = (
			this.remote as unknown as {
				broadcastConnection?: { broadcastSocket?: Socket };
			}
		).broadcastConnection?.broadcastSocket;

		try {
			socket?.setMulticastInterface(iface);
		} catch (error) {
			console.error(
				`[unreal-mcp] Could not set multicast interface to ${iface}: ${error}. Discovery may fail if this host has multiple network adapters.`,
			);
		}
	}

	private async ensureCommandConnection(): Promise<void> {
		if (this._commandReady && this.remote.hasCommandConnection()) return;

		await this.ensureStarted();

		const nodes = this.remote.remoteNodes;
		if (nodes.length === 0) {
			throw new UnrealMcpError(
				"No Unreal Editor nodes found. Make sure the editor is running with Python Remote Execution enabled.",
				"NO_UE_NODES",
			);
		}

		await this.remote.openCommandConnection(nodes[0]);
		this._commandReady = true;
	}

	/**
	 * Execute Python code in the Unreal Editor's Python environment.
	 * Returns the captured stdout output.
	 */
	async execute(pythonCode: string): Promise<string> {
		await this.ensureCommandConnection();

		try {
			const result = await Promise.race([
				this.remote.runCommand(pythonCode, true),
				new Promise<never>((_, reject) =>
					setTimeout(
						() => reject(new TimeoutError("Python execution", this.timeout)),
						this.timeout,
					),
				),
			]);

			if (!result.success) {
				const errorOutput = result.output
					.filter((o: { type: string }) => o.type === "Error")
					.map((o: { output: string }) => o.output)
					.join("\n");
				const errorMsg = errorOutput || result.result || "Unknown Python execution error";
				throw new PythonExecutionError(errorMsg, JSON.stringify(result));
			}

			// Collect stdout (Info-type output)
			const stdout = result.output
				.filter((o: { type: string }) => o.type === "Info")
				.map((o: { output: string }) => o.output)
				.join("")
				.trim();

			return stdout || result.result || "";
		} catch (error) {
			if (error instanceof UnrealMcpError) throw error;
			// Connection may have dropped — reset and let next call reconnect
			this._commandReady = false;
			throw new PythonExecutionError(`Python execution failed: ${error}`, String(error));
		}
	}

	/**
	 * Execute a Python script (already rendered via template engine).
	 */
	async executeScript(renderedScript: string): Promise<string> {
		return this.execute(renderedScript);
	}

	async disconnect(): Promise<void> {
		if (this._commandReady) {
			try {
				this.remote.closeCommandConnection();
			} catch {
				// Ignore
			}
			this._commandReady = false;
		}
		if (this._started) {
			try {
				await this.remote.stop();
			} catch {
				// Ignore shutdown errors
			}
			this._started = false;
		}
	}
}
