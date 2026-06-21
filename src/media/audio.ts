/**
 * ffmpeg-based audio extraction, kept free of any `vscode` import so it can be
 * unit-tested directly against a real ffmpeg binary.
 *
 * M1: pure engine only — not yet wired into the transform/preview (that is M4).
 * The cache directory is injected by the caller (an absolute path) rather than
 * hardcoded, so it can later live alongside the source video inside the
 * preview's localResourceRoots, and so tests get a hermetic, disposable cache.
 *
 * The exported signatures below are the fixed public contract the acceptance
 * tests pin (test/{audio,ffmpegCache,audioFixes}.test.ts). Do NOT change them.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFile, spawn } from 'child_process';

const FFMPEG_CANDIDATES = [
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
    '/snap/bin/ffmpeg',
    'ffmpeg',
];
const STDERR_TAIL_LIMIT = 16 * 1024;
// After a timeout SIGTERM, wait this long before escalating to SIGKILL so a
// child that ignores SIGTERM cannot linger as an orphan.
const SIGKILL_GRACE_MS = 2000;

const probeResults = new Map<string, string | null>();
const probeInFlight = new Map<string, Promise<string | null>>();
const inFlightExtractions = new Map<string, Promise<string>>();

export interface ExtractOptions {
    /** Kill the ffmpeg child after this many ms. Defaults to 120_000. Injected for tests. */
    timeoutMs?: number;
}

/** For tests: forget the cached ffmpeg probe results (resolved + in-flight). */
export function resetFfmpegCache(): void {
    probeResults.clear();
    probeInFlight.clear();
}

/**
 * Locate a working ffmpeg binary. With no override, tries a fixed list of common
 * absolute paths and then a bare `ffmpeg` from PATH; the first that responds to
 * `-version` wins. A non-empty override is probed first and used verbatim when it
 * works, else it falls back to the default search. The result (including a `null`
 * "not found") is cached, and concurrent identical lookups dedupe to one probe.
 */
export function findFfmpeg(override?: string): Promise<string | null> {
    const overridePath = typeof override === 'string' ? override.trim() : '';
    if (overridePath === '') {
        return memoizedProbe('', probeDefaultFfmpeg);
    }

    return memoizedProbe(overridePath, async () => {
        if (await probeFfmpeg(overridePath)) {
            return overridePath;
        }
        return findFfmpeg();
    });
}

/**
 * Decide whether a user-provided ffmpeg override path may be used. Returns the
 * trimmed override only when it is a non-empty ABSOLUTE path that does NOT
 * resolve inside any of the given workspace roots (symlink / case / 8.3
 * canonicalized); otherwise undefined. Belt-and-suspenders on top of the
 * machine-scoped setting.
 */
export function resolveFfmpegOverride(override: string | undefined, workspaceRoots: string[]): string | undefined {
    const trimmed = typeof override === 'string' ? override.trim() : '';
    if (trimmed === '' || !path.isAbsolute(trimmed)) {
        return undefined;
    }

    const resolvedOverride = normalizeResolvedPath(trimmed);
    for (const root of workspaceRoots) {
        const trimmedRoot = root.trim();
        if (trimmedRoot === '') {
            continue;
        }
        const resolvedRoot = normalizeResolvedPath(trimmedRoot);
        if (resolvedOverride === resolvedRoot || resolvedOverride.startsWith(ensureTrailingSeparator(resolvedRoot))) {
            return undefined;
        }
    }

    return trimmed;
}

/**
 * Whether `candidate` resolves to a path inside one of `roots`, canonicalizing
 * symlinks / case / short-name aliases first (same hardening as
 * resolveFfmpegOverride). F4: the transform derives a video's absolute path from
 * the Markdown document's location; this confirms that path stays within the
 * document's allowed resource root — defense in depth on top of the
 * relative-path allowlist in transform.classifyVideoSrc, catching e.g. a
 * symlink inside the workspace that points outside it. Empty roots are ignored.
 */
export function isPathWithinRoots(candidate: string, roots: string[]): boolean {
    const resolved = normalizeResolvedPath(candidate);
    for (const root of roots) {
        const trimmedRoot = root.trim();
        if (trimmedRoot === '') {
            continue;
        }
        const resolvedRoot = normalizeResolvedPath(trimmedRoot);
        if (resolved === resolvedRoot || resolved.startsWith(ensureTrailingSeparator(resolvedRoot))) {
            return true;
        }
    }
    return false;
}

/**
 * Content-addressed cache key for `input`: md5 of the path + its size + mtime,
 * truncated to 16 hex chars. Editing a file in place changes size/mtime and so
 * the key, which is what makes a stale cache miss instead of replaying old
 * audio. Single source of truth shared by extractAudio and cachePathFor.
 */
function cacheKey(input: string): string {
    const stat = fs.statSync(input);
    return crypto
        .createHash('md5')
        .update(`${input}\0${stat.size}\0${stat.mtimeMs}`)
        .digest('hex')
        .slice(0, 16);
}

/**
 * The canonical cache path `extractAudio` writes for `input` under `cacheDir`.
 * Lets a synchronous caller (the render-time transform) name the <audio> src and
 * check `fs.existsSync` for a cache hit before any async extraction is kicked.
 * Throws if `input` cannot be stat'd, exactly as extractAudio does.
 */
export function cachePathFor(input: string, cacheDir: string): string {
    return path.join(cacheDir, `mdva-audio-${cacheKey(input)}.mp3`);
}

/**
 * Extract the audio track of `input` into an MP3 under `cacheDir`. The output
 * name is derived from the input path AND its size+mtime, so editing a file in
 * place re-extracts instead of replaying stale audio. ffmpeg writes to a temp
 * file renamed into place only on success, so a killed extraction can never
 * leave a partial file a later open would reuse. Concurrent extractions for the
 * same output path run ffmpeg once.
 */
export async function extractAudio(ffmpeg: string, input: string, cacheDir: string, opts?: ExtractOptions): Promise<string> {
    // `async` (not a hand-rolled Promise) so a statSync failure rejects the
    // returned promise instead of throwing synchronously past the caller's
    // `.catch`. There is no `await` before the in-flight check below, so the
    // existsSync/get/set dedup sequence still runs atomically within one tick.
    const key = cacheKey(input);
    const out = path.join(cacheDir, `mdva-audio-${key}.mp3`);

    // Reuse a previously-extracted (complete) file if present.
    if (fs.existsSync(out)) {
        return out;
    }

    const inFlight = inFlightExtractions.get(out);
    if (inFlight !== undefined) {
        return inFlight;
    }

    const timeoutMs = opts?.timeoutMs ?? 120000;
    const promise = extractAudioToCache(ffmpeg, input, cacheDir, key, out, timeoutMs).finally(() => {
        inFlightExtractions.delete(out);
    });
    inFlightExtractions.set(out, promise);
    return promise;
}

/**
 * Best-effort: delete cached extracted-audio files older than maxAgeMs from
 * `cacheDir`. Only touches files this module owns (`mdva-audio-*.mp3`). Never
 * throws (swallows all fs errors). Synchronous.
 */
export function pruneAudioCache(cacheDir: string, maxAgeMs = 7 * 24 * 60 * 60 * 1000): void {
    try {
        const cutoff = Date.now() - maxAgeMs;
        for (const entry of fs.readdirSync(cacheDir)) {
            if (!/^mdva-audio-.*\.mp3$/.test(entry)) {
                continue;
            }
            const file = path.join(cacheDir, entry);
            try {
                if (fs.statSync(file).mtimeMs < cutoff) {
                    fs.unlinkSync(file);
                }
            } catch {
                /* ignore */
            }
        }
    } catch {
        /* ignore */
    }
}

/** True when ffmpeg stderr indicates the input simply has no audio stream. */
export function isNoAudioStderr(stderr: string): boolean {
    return /does not contain any stream|matches no streams|output file is empty/i.test(stderr);
}

function normalizeResolvedPath(value: string): string {
    const resolved = path.resolve(value);
    try {
        // Canonicalize symlinks (and, on Windows, short/namespaced aliases like
        // 8.3 names or \\?\ prefixes) so the boundary check cannot be fooled by an
        // alias that names a workspace path without sharing its textual prefix.
        // realpathSync.native returns the filesystem's OWN canonical casing, so
        // two names for the same file compare equal on a case-insensitive volume
        // WITHOUT us folding case here — and on a case-SENSITIVE volume we must
        // not fold, or a path differing from the root only by case (e.g. a symlink
        // to /WS/secret.mp4 while the root is /ws) would wrongly pass containment.
        return fs.realpathSync.native(resolved);
    } catch {
        // The path may not exist yet (e.g. a cache file about to be written); fall
        // back to the lexically-normalized form. A case mismatch on the fallback
        // can only cause a benign false-negative (a legit path judged outside, so
        // we skip extraction), never a false-positive that escapes the boundary.
        return path.normalize(resolved);
    }
}

function ensureTrailingSeparator(value: string): string {
    return value.endsWith(path.sep) ? value : `${value}${path.sep}`;
}

function memoizedProbe(key: string, compute: () => Promise<string | null>): Promise<string | null> {
    if (probeResults.has(key)) {
        return Promise.resolve(probeResults.get(key) as string | null);
    }
    const pending = probeInFlight.get(key);
    if (pending !== undefined) {
        return pending;
    }
    const promise = compute()
        .then((result) => {
            if (probeInFlight.get(key) === promise) {
                probeResults.set(key, result);
            }
            return result;
        })
        .finally(() => {
            if (probeInFlight.get(key) === promise) {
                probeInFlight.delete(key);
            }
        });
    probeInFlight.set(key, promise);
    return promise;
}

async function probeDefaultFfmpeg(): Promise<string | null> {
    for (const bin of FFMPEG_CANDIDATES) {
        if (await probeFfmpeg(bin)) {
            return bin;
        }
    }
    return null;
}

function probeFfmpeg(bin: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        execFile(bin, ['-version'], { timeout: 5000 }, (err) => resolve(!err));
    });
}

async function extractAudioToCache(
    ffmpeg: string,
    input: string,
    cacheDir: string,
    key: string,
    out: string,
    timeoutMs: number,
): Promise<string> {
    fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });

    if (fs.existsSync(out)) {
        return out;
    }

    // The temp name keeps a .mp3 suffix AND we pass `-f mp3`, so ffmpeg's
    // extension-based muxer detection can never trip over the temp suffix.
    const tmpOut = path.join(cacheDir, `mdva-audio-${key}.${crypto.randomBytes(4).toString('hex')}.part.mp3`);
    try {
        await runFfmpeg(ffmpeg, [
            '-nostdin',
            '-i', input,
            '-vn',
            // Normalize the audio to the video timeline: reset the first sample
            // to PTS 0. MP4/MOV audio commonly carries a start-time offset
            // (edit-list priming / encoder delay), and without this the
            // extracted mp3 is shifted a constant amount from the video clock --
            // the offset source that drove the drift-correction feedback loop.
            '-af', 'aresample=async=1:first_pts=0',
            '-c:a', 'libmp3lame',
            '-b:a', '192k',
            '-f', 'mp3',
            '-y', tmpOut,
        ], timeoutMs);
        fs.chmodSync(tmpOut, 0o600);
        fs.renameSync(tmpOut, out);
    } catch (err) {
        // Best-effort cleanup of the partial file.
        try {
            fs.unlinkSync(tmpOut);
        } catch {
            /* ignore */
        }
        throw err;
    }

    return out;
}

function runFfmpeg(ffmpeg: string, args: string[], timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        let stderrTail = '';
        let settled = false;
        let timedOut = false;
        let killTimer: NodeJS.Timeout | undefined;

        // spawn with an arg array (no shell) avoids command injection from the file path.
        const child = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            // Backstop: a child that ignores SIGTERM is force-killed after a
            // grace period so it cannot outlive us as an orphan. unref'd so this
            // timer never keeps the event loop alive on its own; cleared by
            // 'close' if SIGTERM already worked.
            killTimer = setTimeout(() => child.kill('SIGKILL'), SIGKILL_GRACE_MS);
            killTimer.unref();
            finish(makeFfmpegError(`ffmpeg timed out after ${timeoutMs}ms`, stderrTail));
        }, timeoutMs);

        const finish = (err?: Error) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        };

        child.stderr.on('data', (chunk: Buffer) => {
            stderrTail += chunk.toString('utf8');
            if (stderrTail.length > STDERR_TAIL_LIMIT) {
                stderrTail = stderrTail.slice(-STDERR_TAIL_LIMIT);
            }
        });
        // Swallow stderr stream errors (e.g. EPIPE once the child is killed): the
        // 'error'/'close' handlers below decide the outcome from the exit status.
        child.stderr.on('error', () => {});

        child.on('error', (err) => {
            finish(err);
        });

        child.on('close', (code, signal) => {
            // The child has exited (and been reaped); cancel any pending SIGKILL.
            if (killTimer) {
                clearTimeout(killTimer);
                killTimer = undefined;
            }
            if (timedOut) {
                return;
            }
            if (code === 0) {
                finish();
            } else {
                const suffix = signal ? `signal ${signal}` : `exit code ${code}`;
                finish(makeFfmpegError(`ffmpeg failed with ${suffix}`, stderrTail));
            }
        });
    });
}

function makeFfmpegError(message: string, stderr: string): Error {
    const detail = stderr.trim();
    const err: Error & { noAudio?: boolean } = new Error(detail ? `${message}: ${detail}` : message);
    if (isNoAudioStderr(stderr)) {
        err.noAudio = true;
    }
    return err;
}
