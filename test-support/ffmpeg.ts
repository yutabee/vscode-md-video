import * as fs from 'node:fs';
import * as path from 'node:path';

import { execFileAsync } from './exec';

// Probe candidates kept independent of the SUT's own FFMPEG_CANDIDATES on
// purpose: if findFfmpeg() regresses to return null, real tests must FAIL
// (loudly), not silently self-skip because the skip decision shares the bug.
const FFMPEG_PROBE_CANDIDATES = [
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
    '/snap/bin/ffmpeg',
    'ffmpeg',
];

/** Probe for a real ffmpeg without going through the code under test. null when absent. */
export async function discoverFfmpeg(): Promise<string | null> {
    for (const bin of FFMPEG_PROBE_CANDIDATES) {
        try {
            await execFileAsync(bin, ['-version'], { timeout: 5000 });
            return bin;
        } catch {
            /* try the next candidate */
        }
    }
    return null;
}

export async function makeAacMp4(ffmpeg: string, dir: string): Promise<string> {
    const sample = path.join(dir, 'sample.mp4');
    // Tiny H.264 + AAC clip: AAC is exactly the codec the webview can't decode,
    // so this is the real extraction path.
    await execFileAsync(ffmpeg, [
        '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=160x120:rate=15',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', sample,
    ]);
    return sample;
}

export async function makeVideoOnlyMp4(ffmpeg: string, dir: string): Promise<string> {
    const videoOnly = path.join(dir, 'video-only.mp4');
    await execFileAsync(ffmpeg, [
        '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=160x120:rate=15',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', videoOnly,
    ]);
    return videoOnly;
}

// A valid MP3 starts with an ID3 tag ("ID3") or an MPEG audio frame sync
// (0xFF 0xEx). A failed/empty extraction would not.
export function looksLikeMp3(file: string): boolean {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(3);
    fs.readSync(fd, buf, 0, 3, 0);
    fs.closeSync(fd);
    const isId3 = buf.toString('latin1', 0, 3) === 'ID3';
    const isFrameSync = buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0;
    return isId3 || isFrameSync;
}
