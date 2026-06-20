import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

// A fake ffmpeg: writes a minimal MP3 to its last arg, optionally emits N MB of
// stderr, optionally delays, optionally hangs forever (to exercise the timeout
// kill path), and appends one byte to a counter file per call. Unix-only: it is
// a `#!/usr/bin/env node` shebang script spawned as the ffmpeg "binary".
//
// Honesty hooks (so the acceptance tests can't pass vacuously):
//   MDVA_FAKE_PID_FILE  - write our pid here at startup; the timeout test reads
//                         it to prove the child was actually reaped after kill.
//   MDVA_FAKE_STDERR_SENT - after draining the large-stderr load, write the byte
//                         count here so the test can assert a real >maxBuffer
//                         volume reached the parent (a bare write()+exit drops
//                         most of it). The stderr writer honors backpressure.
// When hanging, we still CREATE the `.part` output file first, so the parent's
// post-kill cleanup has a real partial file to remove (else "no leftovers" is
// trivially true even if cleanup were deleted).
const EXTRACT_FAKE_SRC = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const out = args[args.length - 1];
const counter = process.env.MDVA_FAKE_COUNTER;
if (counter) { try { fs.appendFileSync(counter, 'x'); } catch {} }
const pidFile = process.env.MDVA_FAKE_PID_FILE;
if (pidFile) { try { fs.writeFileSync(pidFile, String(process.pid)); } catch {} }

function hangOrFinish() {
  if (process.env.MDVA_FAKE_HANG === '1') {
    // Create the partial output the parent passed as the last arg, then never
    // exit: the parent must time out, kill us, and clean this .part file up.
    try { fs.writeFileSync(out, 'partial'); } catch {}
    setInterval(() => {}, 1 << 30);
  } else {
    const delay = parseInt(process.env.MDVA_FAKE_DELAY_MS || '0', 10);
    setTimeout(() => {
      // "ID3" tag header so it reads as an MP3.
      fs.writeFileSync(out, Buffer.from([0x49, 0x44, 0x33, 0x03, 0, 0, 0, 0, 0, 0]));
      process.exit(0);
    }, delay);
  }
}

const mb = parseInt(process.env.MDVA_FAKE_STDERR_MB || '0', 10);
if (mb > 0) {
  const chunk = 'E'.repeat(64 * 1024);
  const total = mb * 16;
  let i = 0;
  function pump() {
    while (i < total) {
      i++;
      if (!process.stderr.write(chunk)) { process.stderr.once('drain', pump); return; }
    }
    const sentFile = process.env.MDVA_FAKE_STDERR_SENT;
    if (sentFile) { try { fs.writeFileSync(sentFile, String(total * chunk.length)); } catch {} }
    hangOrFinish();
  }
  pump();
} else {
  hangOrFinish();
}
`;

export function writeExtractFake(dir: string): string {
    const bin = path.join(dir, 'fake-ffmpeg.js');
    fs.writeFileSync(bin, EXTRACT_FAKE_SRC, { mode: 0o755 });
    return bin;
}

export interface ProbeFake {
    bin: string;
    probeCount: () => number;
}

// A fake ffmpeg: a node shebang script that records each `-version` probe by
// appending a byte to a counter file, then exits with the given code (0 =
// "this binary works", non-zero = "probe fails"). Unix-only (shebang +x).
export function makeProbeFake(dir: string, name: string, exitCode: number): ProbeFake {
    const counter = path.join(dir, `${name}.count`);
    const bin = path.join(dir, name);
    const script =
        '#!/usr/bin/env node\n' +
        `require('fs').appendFileSync(${JSON.stringify(counter)}, 'x');\n` +
        `process.exit(${exitCode});\n`;
    fs.writeFileSync(bin, script, { mode: 0o755 });
    return {
        bin,
        probeCount: () => (fs.existsSync(counter) ? fs.readFileSync(counter, 'utf8').length : 0),
    };
}

export function uniqueInput(dir: string): string {
    // Unique content => unique (size+mtime+path) cache key => no cross-test cache hit.
    const p = path.join(dir, `in-${crypto.randomBytes(6).toString('hex')}.mp4`);
    fs.writeFileSync(p, crypto.randomBytes(64));
    return p;
}
