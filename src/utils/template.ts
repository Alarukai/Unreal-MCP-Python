import { readFileSync } from "node:fs";
import { join } from "node:path";

const TEMPLATE_PATTERN = /\{\{(\w+)\}\}/g;

/**
 * Load a Python script template and substitute variables.
 * Templates use {{variable_name}} syntax for substitution.
 * Values are JSON-escaped to prevent injection.
 */
export function renderScript(
	scriptPath: string,
	vars: Record<string, string | number | boolean> = {},
): string {
	const fullPath = join(getScriptsDir(), scriptPath);
	const template = readFileSync(fullPath, "utf-8");
	return substituteVars(template, vars);
}

/**
 * Substitute {{variable}} placeholders in a template string.
 */
export function substituteVars(
	template: string,
	vars: Record<string, string | number | boolean>,
): string {
	return template.replace(TEMPLATE_PATTERN, (match, varName) => {
		if (varName in vars) {
			const value = vars[varName];
			if (typeof value === "string") {
				// Escape for safe embedding in Python string literals
				return escapePythonString(value);
			}
			return String(value);
		}
		return match; // Leave unmatched placeholders as-is
	});
}

/**
 * Escape a string for safe use inside Python single or double quotes.
 * Handles backslashes, quotes, common whitespace, null bytes, and control characters.
 */
export function escapePythonString(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/'/g, "\\'")
		.replace(/"/g, '\\"')
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r")
		.replace(/\t/g, "\\t")
		.replace(/\0/g, "\\x00")
		.replace(/[^ -~\t\n\r]/g, (c) => {
			const code = c.charCodeAt(0);
			if (code > 127) return c; // Pass through non-ASCII (Unicode) as-is
			return `\\x${code.toString(16).padStart(2, "0")}`;
		});
}

/**
 * Build a safe Python list literal from an array of strings.
 * Each value is escaped for safe embedding in Python single-quoted strings.
 * Returns e.g. "['val1', 'val2']"
 */
export function escapePythonArray(values: string[]): string {
	const escaped = values.map((v) => `'${escapePythonString(v)}'`).join(", ");
	return `[${escaped}]`;
}

/**
 * Build an inline Python script from code string and variables.
 * Useful for simple scripts that don't warrant a template file.
 */
export function inlineScript(
	code: string,
	vars: Record<string, string | number | boolean> = {},
): string {
	return substituteVars(code, vars);
}

function getScriptsDir(): string {
	// In development (tsx), scripts are in src/scripts/
	// In production (compiled), scripts are copied to dist/scripts/
	const srcScripts = join(import.meta.dirname, "scripts");
	return srcScripts;
}
