import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export function makeTempDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix + '-'));
}

export interface Cleanup {
    track<T extends string | undefined>(p: T): T;
    run(): void;
}

/** Tracks paths and removes them (files or dirs) in reverse order on run(). */
export function createCleanup(): Cleanup {
    const paths: string[] = [];
    return {
        track(p) {
            if (p) {
                paths.push(p);
            }
            return p;
        },
        run() {
            for (let i = paths.length - 1; i >= 0; i--) {
                const p = paths[i];
                try { fs.unlinkSync(p); } catch { /* ignore */ }
                try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
            }
            paths.length = 0;
        },
    };
}
