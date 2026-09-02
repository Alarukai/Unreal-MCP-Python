import { type Server, type Socket, createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { PluginBridgeClient } from "./plugin-bridge.js";

function frame(obj: unknown): Buffer {
	const body = Buffer.from(JSON.stringify(obj), "utf-8");
	const len = Buffer.alloc(4);
	len.writeUInt32LE(body.length, 0);
	return Buffer.concat([len, body]);
}

/**
 * A minimal fake plugin bridge: replies to an `authenticate` command via
 * `authOutcome`, and to anything else (get_capabilities included) with a
 * bare success. Uses the same length-prefixed JSON framing as the real
 * client, so PluginBridgeClient's actual wire code runs unmodified.
 */
function startFakeBridge(
	authOutcome: (secret: unknown) => { success: boolean; error?: string },
): Promise<{ server: Server; port: number }> {
	return new Promise((resolve) => {
		const server = createServer((socket: Socket) => {
			let buf = Buffer.alloc(0);
			socket.on("data", (data) => {
				buf = Buffer.concat([buf, data]);
				while (buf.length >= 4) {
					const len = buf.readUInt32LE(0);
					if (buf.length < 4 + len) break;
					const msg = JSON.parse(buf.subarray(4, 4 + len).toString("utf-8"));
					buf = buf.subarray(4 + len);
					if (msg.command === "authenticate") {
						const outcome = authOutcome(msg.params?.secret);
						socket.write(frame({ id: msg.id, success: outcome.success, error: outcome.error }));
					} else {
						socket.write(
							frame({
								id: msg.id,
								success: true,
								data: { version: "1", commands: [], features: [] },
							}),
						);
					}
				}
			});
		});
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			resolve({ server, port });
		});
	});
}

describe("PluginBridgeClient authentication", () => {
	let server: Server | undefined;

	afterEach(async () => {
		server?.close();
		server = undefined;
	});

	it("connects without ever sending authenticate when no secret is configured", async () => {
		let authCalled = false;
		const started = await startFakeBridge(() => {
			authCalled = true;
			return { success: true };
		});
		server = started.server;

		const client = new PluginBridgeClient({ host: "127.0.0.1", port: started.port, timeout: 2000 });
		expect(await client.isAvailable()).toBe(true);
		expect(authCalled).toBe(false);
		await client.disconnect();
	});

	it("connects when the configured secret is accepted", async () => {
		const started = await startFakeBridge((secret) => ({ success: secret === "correct-secret" }));
		server = started.server;

		const client = new PluginBridgeClient({
			host: "127.0.0.1",
			port: started.port,
			timeout: 2000,
			secret: "correct-secret",
		});
		expect(await client.isAvailable()).toBe(true);
		await client.disconnect();
	});

	it("fails closed — never reports available — when the configured secret is rejected", async () => {
		const started = await startFakeBridge(() => ({ success: false, error: "bad secret" }));
		server = started.server;

		const client = new PluginBridgeClient({
			host: "127.0.0.1",
			port: started.port,
			timeout: 2000,
			secret: "wrong-secret",
		});
		expect(await client.isAvailable()).toBe(false);
		await client.disconnect();
	});
});
