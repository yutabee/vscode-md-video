/**
 * ffmpeg-based audio extraction, kept free of any `vscode` import so it can be
 * unit-tested directly against a real ffmpeg binary.
 *
 * M1: pure engine only — not yet wired into the transform/preview (that is M4).
 * The cache directory is injected by the caller (an absolute path) rather than
 * hardcoded, so it can later live alongside the source video inside the
 * preview's localResourceRoots, and so tests get a hermetic, disposable cache.
 *
 * NOTE (M1 stub): every body throws `not implemented`. The bodies are filled in
 * the implementation commit; the exported signatures below are the fixed public
 * contract that the acceptance tests pin. Do NOT change these signatures.
 */

const NOT_IMPLEMENTED = 'M1 stub: audio engine not implemented';

export interface ExtractOptions {
    /** Kill the ffmpeg child after this many ms. Defaults to 120_000. Injected for tests. */
    timeoutMs?: number;
}

/** For tests: forget the cached ffmpeg probe results (resolved + in-flight). */
export function resetFfmpegCache(): void {
    throw new Error(NOT_IMPLEMENTED);
}

/**
 * Locate a working ffmpeg binary. With no override, tries a fixed list of common
 * absolute paths and then a bare `ffmpeg` from PATH; the first that responds to
 * `-version` wins. A non-empty override is probed first and used verbatim when it
 * works, else it falls back to the default search. The result (including a `null`
 * "not found") is cached, and concurrent identical lookups dedupe to one probe.
 */
export function findFfmpeg(override?: string): Promise<string | null> {
    void override;
    throw new Error(NOT_IMPLEMENTED);
}

/**
 * Decide whether a user-provided ffmpeg override path may be used. Returns the
 * trimmed override only when it is a non-empty ABSOLUTE path that does NOT
 * resolve inside any of the given workspace roots (symlink / case / 8.3
 * canonicalized); otherwise undefined. Belt-and-suspenders on top of the
 * machine-scoped setting.
 */
export function resolveFfmpegOverride(override: string | undefined, workspaceRoots: string[]): string | undefined {
    void override;
    void workspaceRoots;
    throw new Error(NOT_IMPLEMENTED);
}

/**
 * Extract the audio track of `input` into an MP3 under `cacheDir`. The output
 * name is derived from the input path AND its size+mtime, so editing a file in
 * place re-extracts instead of replaying stale audio. ffmpeg writes to a temp
 * file renamed into place only on success, so a killed extraction can never
 * leave a partial file a later open would reuse. Concurrent extractions for the
 * same output path run ffmpeg once.
 */
export function extractAudio(ffmpeg: string, input: string, cacheDir: string, opts?: ExtractOptions): Promise<string> {
    void ffmpeg;
    void input;
    void cacheDir;
    void opts;
    throw new Error(NOT_IMPLEMENTED);
}

/**
 * Best-effort: delete cached extracted-audio files older than maxAgeMs from
 * `cacheDir`. Only touches files this module owns (`mdva-audio-*.mp3`). Never
 * throws (swallows all fs errors). Synchronous.
 */
export function pruneAudioCache(cacheDir: string, maxAgeMs = 7 * 24 * 60 * 60 * 1000): void {
    void cacheDir;
    void maxAgeMs;
    throw new Error(NOT_IMPLEMENTED);
}

/** True when ffmpeg stderr indicates the input simply has no audio stream. */
export function isNoAudioStderr(stderr: string): boolean {
    void stderr;
    throw new Error(NOT_IMPLEMENTED);
}
