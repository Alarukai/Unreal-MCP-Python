import { describe, expect, it } from "vitest";
import { isLoopbackAddress, resolveMulticastInterface } from "./python-exec.js";

describe("isLoopbackAddress", () => {
	it("recognizes the IPv4 loopback default", () => {
		expect(isLoopbackAddress("127.0.0.1")).toBe(true);
	});

	it("recognizes the whole 127.0.0.0/8 range, not just 127.0.0.1", () => {
		expect(isLoopbackAddress("127.5.5.5")).toBe(true);
		expect(isLoopbackAddress("127.255.255.255")).toBe(true);
	});

	it("recognizes the IPv6 loopback", () => {
		expect(isLoopbackAddress("::1")).toBe(true);
	});

	it("does not treat 0.0.0.0 (widened bind) as loopback", () => {
		expect(isLoopbackAddress("0.0.0.0")).toBe(false);
	});

	it("does not treat a LAN address as loopback", () => {
		expect(isLoopbackAddress("192.168.1.50")).toBe(false);
	});

	it("does not false-positive on an address that merely starts similarly to 127", () => {
		// A naive substring check (rather than a prefix check) could be fooled
		// by an address containing "127" elsewhere.
		expect(isLoopbackAddress("10.0.0.127")).toBe(false);
	});
});

describe("resolveMulticastInterface", () => {
	it("returns the explicit override unconditionally, without touching the OS interface list", () => {
		expect(resolveMulticastInterface("203.0.113.5")).toBe("203.0.113.5");
	});

	it("falls back to OS interface auto-detection when no override is given", () => {
		// Environment-dependent (real os.networkInterfaces()) — just assert it
		// returns either undefined or a syntactically plausible IPv4 string,
		// and never an APIPA (169.254.*) address per its own contract.
		const result = resolveMulticastInterface(undefined);
		if (result !== undefined) {
			expect(result).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
			expect(result.startsWith("169.254.")).toBe(false);
		}
	});
});
