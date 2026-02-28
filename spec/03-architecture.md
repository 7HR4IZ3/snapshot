# 03 - Architecture

## High-Level Components

1. CLI Layer
   - argv parsing
   - command dispatch
   - output formatting (human/json)

2. Application Services
   - `WorkspaceService` (spawn/status/diff/cleanup)
   - `ReviewService` (review sessions + artifacts)
   - `MergeService` (single and queue merges)
   - `ConfigService` (load/validate defaults)

3. Infrastructure
   - `GitService` (git process wrapper)
   - `MetadataStore` (`.snapshot/` read/write with schema validation)
   - `LockService` (merge lock files)
   - `Clock`/`IdGenerator` abstractions for deterministic tests

4. UI Layer
   - `ReviewTUI` (Ink-based interactive interface)

## Runtime and Packaging

- Runtime: Bun
- Language: TypeScript
- Build target:
  - dev: `bun run src/cli.ts`
  - release prototype: `bun build --compile`

## Suggested Source Layout

```txt
src/
  cli.ts
  commands/
    init.ts
    spawn.ts
    status.ts
    diff.ts
    review.ts
    merge.ts
    merge-many.ts
    cleanup.ts
  core/
    services/
      workspace-service.ts
      review-service.ts
      merge-service.ts
    domain/
      workspace.ts
      review.ts
      merge.ts
      errors.ts
    ports/
      git-port.ts
      metadata-port.ts
      lock-port.ts
  infra/
    git/
      git-service.ts
      git-command.ts
    metadata/
      metadata-store.ts
      schemas.ts
    lock/
      lock-service.ts
  ui/
    review/
      app.tsx
      keymap.ts
      state.ts
```

## Design Rules

1. Commands must be thin and delegate all logic to services.
2. Services should be deterministic with explicit inputs and outputs.
3. Git interaction must be centralized in `GitService`.
4. Metadata writes must be atomic (write temp + rename).
5. Avoid hidden side effects outside project and workspace paths.

## GitService Contract

`GitService` should expose typed methods rather than raw string commands at callsites.

Minimum methods:

- `isRepo(path): boolean`
- `currentBranch(path): string`
- `headSha(path): string`
- `worktreeAdd(projectPath, workspacePath, branch, fromRef): void`
- `worktreeRemove(projectPath, workspacePath, force): void`
- `diffNameStatus(path, baseRef, headRef?): FileChange[]`
- `diffPatch(path, baseRef, headRef?): string`
- `merge(targetPath, sourceRef, options): MergeResult`
- `hasUncommittedChanges(path): boolean`

## Concurrency and Locking

- Only one merge operation can run per project at a time.
- Lock file path: `.snapshot/locks/merge.lock`.
- Lock content includes pid, hostname, workspace ids, start timestamp.
- stale lock recovery allowed if process no longer exists and `--force-unlock` passed.

## Error Handling

Domain errors map to stable error codes and friendly messages.

Examples:

- `ERR_NOT_GIT_REPO`
- `ERR_WORKSPACE_NOT_FOUND`
- `ERR_WORKSPACE_PATH_EXISTS`
- `ERR_TARGET_DIRTY`
- `ERR_MERGE_CONFLICT`
- `ERR_LOCK_HELD`

## Logging and Diagnostics

- Human mode: concise user messages.
- Verbose mode: include executed git commands, timings, and resolved refs.
- Debug logs should never print secrets (none expected in v1, but enforce anyway).
