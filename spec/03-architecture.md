# 03 - Architecture

## High-Level Components

1. CLI Layer
   - argv parsing and usage rendering (`src/cli.ts`)
   - command dispatch (`src/commands/index.ts`)
   - output formatting (human/json)

2. Command Layer
   - one file per command in `src/commands/`
   - thin adapters that parse flags, resolve defaults, and call services

3. Application Services
   - `WorkspaceService`: init/spawn/status/diff/list/cleanup/repair-mounts
   - `MergeService`: merge/merge-many/preflight
   - `ReviewService`: review TUI + non-interactive review artifacts
   - `RevertService`: revert merge sessions
   - `BackendService`: host/backend capability diagnostics

4. Infrastructure
   - `GitService` + `git-command` wrapper (`src/infra/git/`)
   - `MetadataStore` + schemas + validator (`src/infra/metadata/`)
   - `LockService` (`src/infra/lock/`)

5. UI Layer
   - Review TUI in `src/ui/review/` (`app.tsx`, `keymap.ts`, `state.ts`, runner)

## Runtime and Packaging

- Runtime: Bun
- Language: TypeScript
- Dev: `bun run src/cli.ts`
- Release JS build: `bunx tsc -p tsconfig.build.json` to `dist/`
- CLI binary mapping: `package.json#bin.snapshot -> dist/cli.js`

## Source Layout (Current)

```txt
src/
  cli.ts
  commands/
    index.ts
    init.ts
    spawn.ts
    list.ts
    status.ts
    diff.ts
    review.ts
    merge.ts
    merge-many.ts
    revert.ts
    cleanup.ts
    unlock.ts
    backends.ts
    repair-mounts.ts
    doctor.ts
    config.ts
  core/
    services/
      workspace-service.ts
      merge-service.ts
      review-service.ts
      revert-service.ts
      backend-service.ts
    domain/
      common.ts
      workspace.ts
      merge.ts
      review.ts
      errors.ts
    ports/
      git-port.ts
      metadata-port.ts
      lock-port.ts
  infra/
    git/
      git-command.ts
      git-service.ts
    metadata/
      metadata-store.ts
      schemas.ts
      validator.ts
    lock/
      lock-service.ts
  ui/
    review/
      app.tsx
      keymap.ts
      state.ts
      run.tsx
```

## Workspace Backend Model

- `worktree`: git worktree branch materialization.
- `apfs-cow`: APFS copy-on-write directory clone.
- `overlay`: overlay mount attempt with strict/fallback policy handling.

Backend choice is controlled by:

- command flags (`--backend`, `--strict-backend`)
- config defaults (`workspace.backendDefault`, `workspace.fallbackPolicy`)

## Workspace Content Policy

Spawn applies ordered filters:

1. hard excludes (always enforced)
2. include globs
3. exclude globs
4. `apfs-cow` symlink globs (mode-aware)

Hard excludes include snapshot internals and discovered spawned workspace directories.

## Design Rules

1. Commands remain thin and delegate logic to services.
2. Metadata writes must be atomic.
3. Git operations are centralized in `GitService`.
4. Merge and revert operations are lock- and state-aware.
5. Spawns must never leak project-internal snapshot/spawn artifacts.
