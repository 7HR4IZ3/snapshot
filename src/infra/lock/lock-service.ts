import { closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { SnapshotError } from "../../core/errors";

interface LockPayload {
  pid: number;
  hostname: string;
  startedAt: string;
  scope: string;
}

function parseLock(path: string): LockPayload | null {
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as LockPayload;
  } catch {
    return null;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class LockService {
  acquire(lockPath: string, scope: string): () => void {
    if (existsSync(lockPath)) {
      const existing = parseLock(lockPath);
      if (existing && isPidAlive(existing.pid)) {
        throw new SnapshotError("ERR_LOCK_HELD", "merge lock is currently held", {
          lockPath,
          holder: existing,
        });
      }
      rmSync(lockPath, { force: true });
    }

    const payload: LockPayload = {
      pid: process.pid,
      hostname: Bun.env.HOSTNAME || Bun.env.COMPUTERNAME || "unknown",
      startedAt: new Date().toISOString(),
      scope,
    };

    const fd = openSync(lockPath, "wx");
    try {
      writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    } finally {
      closeSync(fd);
    }

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      rmSync(lockPath, { force: true });
    };
  }

  withLock<T>(lockPath: string, scope: string, fn: () => T): T {
    const release = this.acquire(lockPath, scope);
    try {
      return fn();
    } finally {
      release();
    }
  }

  forceUnlock(lockPath: string): { unlocked: boolean; previous: LockPayload | null } {
    if (!existsSync(lockPath)) {
      return { unlocked: false, previous: null };
    }
    const previous = parseLock(lockPath);
    rmSync(lockPath, { force: true });
    return { unlocked: true, previous };
  }
}
