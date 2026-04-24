// ── Runtime probe: can this process create filesystem symlinks? ───────
//
// Windows denies symlink(2) for non-admin / non-Developer-Mode users
// (EPERM), and some CI sandboxes reject it as well. Tests that need a
// real symlink to exercise security boundaries should skip themselves
// rather than fail with an environment-level EPERM that masks the real
// signal.
//
// Usage:
//   import { canCreateSymlinkSync } from "../test-utils/can-symlink.js";
//   const SKIP_IF_NO_SYMLINK = !canCreateSymlinkSync();
//   it.skipIf(SKIP_IF_NO_SYMLINK)("rejects symlink escapes", () => { ... });

import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let cached: boolean | undefined;

/** Probes once per process whether `fs.symlink` works in the test tmp root. */
export function canCreateSymlinkSync(): boolean {
  if (cached !== undefined) {
    return cached;
  }
  let dir: string | undefined;
  try {
    dir = mkdtempSync(join(tmpdir(), "omni-symlink-probe-"));
    const target = join(dir, "target.txt");
    const link = join(dir, "link");
    // Use a non-existent target — symlinkSync succeeds even without it on
    // POSIX, and fails early on Windows-without-privilege.
    symlinkSync(target, link);
    cached = true;
  } catch {
    cached = false;
  } finally {
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }
  return cached;
}
