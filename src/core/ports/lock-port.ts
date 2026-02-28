export interface LockPort {
  acquire(lockPath: string, scope: string): () => void;
  withLock<T>(lockPath: string, scope: string, fn: () => T): T;
  forceUnlock(lockPath: string): { unlocked: boolean; previous: unknown };
}
