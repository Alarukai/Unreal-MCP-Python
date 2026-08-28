const SAFE_FILENAME_PATTERN = /^[\w.-]+$/;

/**
 * Rejects a filename destined for a Python `os.path.join(base, filename)` call.
 * os.path.join() silently discards `base` when `filename` is absolute, so an
 * unvalidated filename (e.g. "/etc/passwd" or "C:\\Windows\\...") redirects the
 * write to an arbitrary path instead of the intended directory.
 */
export function assertSafeFilename(filename: string | undefined, fieldName = "filename"): void {
	if (filename && !SAFE_FILENAME_PATTERN.test(filename)) {
		throw new Error(
			`Invalid ${fieldName}: only letters, digits, '.', '_', and '-' are allowed (no path separators).`,
		);
	}
}
