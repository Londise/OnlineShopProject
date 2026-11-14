import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

// Only the test process we just spawned and its descendants. Killing the Node
// test coordinator alone can orphan its per-file workers on Windows.
export async function terminateTestTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    try {
      await promisify(execFile)(join(process.env.SystemRoot, 'System32', 'taskkill.exe'),
        ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 });
    } catch (error) {
      if (child.exitCode === null && child.signalCode === null) throw error;
    }
  } else {
    // The coordinator is spawned in its own process group on POSIX.
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}
