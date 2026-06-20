import { execFile, type ExecFileOptions } from 'node:child_process';

/**
 * Promisified execFile that rejects with the child's stderr (or the error
 * message) so test fixtures fail loudly. Used to drive a real ffmpeg when
 * generating sample clips.
 */
export function execFileAsync(
    bin: string,
    args: string[],
    opts: ExecFileOptions = { timeout: 60000 },
): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        execFile(bin, args, opts, (err, _stdout, stderr) => {
            if (err) {
                const detail = typeof stderr === 'string' ? stderr : stderr?.toString();
                reject(new Error(detail || err.message));
            } else {
                resolve();
            }
        });
    });
}
