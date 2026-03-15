import type { BuildDiagnostic, ParsedBuildOutput } from "../types.js";

// UBT/MSVC error format: file(line): error CODE: message
const MSVC_ERROR_RE = /^(.+?)\((\d+)(?:,(\d+))?\)\s*:\s*error\s+(\w+)\s*:\s*(.+)$/;
const MSVC_WARNING_RE = /^(.+?)\((\d+)(?:,(\d+))?\)\s*:\s*warning\s+(\w+)\s*:\s*(.+)$/;

// Clang error format: file:line:col: error: message
const CLANG_ERROR_RE = /^(.+?):(\d+):(\d+):\s*error:\s*(.+)$/;
const CLANG_WARNING_RE = /^(.+?):(\d+):(\d+):\s*warning:\s*(.+)$/;

// UBT progress: [1/42] Compile SomeFile.cpp
const PROGRESS_RE = /^\[(\d+)\/(\d+)\]/;

// Summary lines
const SUCCESS_RE = /Build succeeded|BUILD SUCCESSFUL|Automation\.ParseCommandLine/i;
const FAILURE_RE = /Build failed|BUILD FAILED|Error_Unknown/i;

/**
 * Parse UBT/UAT build output into structured diagnostics.
 */
export function parseBuildOutput(output: string): ParsedBuildOutput {
	const lines = output.split("\n");
	const errors: BuildDiagnostic[] = [];
	const warnings: BuildDiagnostic[] = [];
	let maxProgress = 0;
	let maxTotal = 0;
	let succeeded = false;

	for (const line of lines) {
		const trimmed = line.trim();

		// Check MSVC errors
		let match = MSVC_ERROR_RE.exec(trimmed);
		if (match) {
			errors.push({
				file: match[1],
				line: Number.parseInt(match[2], 10),
				column: match[3] ? Number.parseInt(match[3], 10) : 0,
				severity: "error",
				code: match[4],
				message: match[5],
			});
			continue;
		}

		// Check MSVC warnings
		match = MSVC_WARNING_RE.exec(trimmed);
		if (match) {
			warnings.push({
				file: match[1],
				line: Number.parseInt(match[2], 10),
				column: match[3] ? Number.parseInt(match[3], 10) : 0,
				severity: "warning",
				code: match[4],
				message: match[5],
			});
			continue;
		}

		// Check Clang errors
		match = CLANG_ERROR_RE.exec(trimmed);
		if (match) {
			errors.push({
				file: match[1],
				line: Number.parseInt(match[2], 10),
				column: Number.parseInt(match[3], 10),
				severity: "error",
				code: "",
				message: match[4],
			});
			continue;
		}

		// Check Clang warnings
		match = CLANG_WARNING_RE.exec(trimmed);
		if (match) {
			warnings.push({
				file: match[1],
				line: Number.parseInt(match[2], 10),
				column: Number.parseInt(match[3], 10),
				severity: "warning",
				code: "",
				message: match[4],
			});
			continue;
		}

		// Check progress
		const progressMatch = PROGRESS_RE.exec(trimmed);
		if (progressMatch) {
			const current = Number.parseInt(progressMatch[1], 10);
			const total = Number.parseInt(progressMatch[2], 10);
			if (current > maxProgress) maxProgress = current;
			if (total > maxTotal) maxTotal = total;
			continue;
		}

		// Check success/failure
		if (SUCCESS_RE.test(trimmed)) succeeded = true;
		if (FAILURE_RE.test(trimmed)) succeeded = false;
	}

	// If no explicit success/failure line, infer from error count
	if (!SUCCESS_RE.test(output) && !FAILURE_RE.test(output)) {
		succeeded = errors.length === 0;
	}

	const progress = maxTotal > 0 ? Math.round((maxProgress / maxTotal) * 100) : succeeded ? 100 : 0;

	const summary = succeeded
		? `Build succeeded. ${errors.length} error(s), ${warnings.length} warning(s).`
		: `Build failed. ${errors.length} error(s), ${warnings.length} warning(s).`;

	return { errors, warnings, progress, succeeded, summary };
}
