# 04 - Merge and Conflict Model

## Goals

1. Deterministic multi-workspace integration.
2. Default bias toward workspace (virtual) changes for text conflicts.
3. Explicit handling for conflict classes that should not be auto-resolved.

## Merge Baseline

Each workspace stores:

- `baseCommit`: spawn commit SHA
- `workspaceBranch`: `snapshot/<id>`
- `targetBranchAtSpawn`: optional (for reporting)

Single merge integrates `workspaceBranch` into the current target branch.

## Strategy Defaults

- Merge engine: git `ort` strategy.
- Default preference: workspace side on text conflicts.
- Auto-commit: controlled by config `merge.autoCommit` unless overridden by `--commit`/`--no-commit`.

## Conflict Classes

1. Text hunk conflict
   - Default auto-resolution: workspace-preferred
   - Mark as `auto_resolved_text_conflict` in report

2. Binary conflict
   - Never silently auto-resolve by default
   - Mark as `manual_required_binary`

3. Delete/modify conflict
   - Require manual decision unless explicit override policy present
   - Mark as `manual_required_delete_modify`

4. Rename/rename or rename/add complex conflict
   - Require manual review
   - Mark as `manual_required_rename_complex`

5. Submodule pointer conflict (if applicable)
   - Manual resolution in v1
   - Mark as `manual_required_submodule`

## Single Merge Flow

1. Acquire merge lock.
2. Validate target repo is clean.
3. Validate workspace branch exists.
4. Auto-checkpoint uncommitted workspace changes into workspace branch.
5. Resolve source ref for merge:
   - `worktree`: merge workspace branch directly.
   - non-worktree backends: import workspace branch into target repo and merge import ref.
6. Attempt merge with configured preference.
7. If unresolved conflicts remain:
   - capture `git status --porcelain` and conflict markers
   - write conflict report artifact
   - exit with code `3`
8. If merge succeeds:
   - create merge session artifact
   - return summary (files changed, conflicts auto-resolved count)
9. Release lock.

## Multi Merge Queue (`merge-many`)

### Ordering

Supported ordering:

- `created`: oldest workspace first
- `priority`: highest configured priority first, then creation timestamp
- `manual`: user-supplied order as given

### Execution

1. Resolve workspace refs to metadata records.
2. Validate all are merge-eligible (or mark skipped).
3. For each workspace in order:
   - run single merge flow against evolving target HEAD
   - record outcome
4. Default stop-on-first-unresolved-conflict.
5. If `--continue-on-conflict`, proceed and record failed/conflict entries.
6. If stop-on-conflict is active, remaining queued entries are recorded as `skipped`.

## Preflight Mode

`merge-many --preflight` validates refs and outputs eligibility and execution order without mutating target repo state.

## Determinism Requirements

- Same target HEAD + same ordered workspace list + same config must produce equivalent results.
- Merge report includes exact target base SHA to guarantee replayability.

## Merge Report Schema (Conceptual)

- session id
- startedAt, finishedAt
- target repo path, target branch, target start sha, target end sha
- order strategy
- entries:
  - workspace id
  - source branch
  - result (`merged`, `conflict`, `skipped`, `failed`)
  - auto-resolved conflict count
  - unresolved conflict list
  - merge commit sha (if created)

## Policy Knobs (Config)

- `merge.prefer`: `virtual|target`
- `merge.autoCommit`: boolean
- `merge.stopOnConflict`: boolean
- `merge.allowBinaryAutoResolve`: boolean (default false)
- `merge.defaultOrder`: `created|priority|manual`
