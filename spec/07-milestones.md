# 07 - Milestones and Acceptance Criteria

## Milestone 1: Foundation

### Deliverables

- CLI scaffold + command dispatch layer
- project init/config management
- spawn/status/diff/list commands
- metadata store + schema validation

### Acceptance Criteria

- can initialize a git repo with `.snapshot/` metadata
- can spawn multiple independent workspaces from same project
- status and diff are accurate against stored base commit

## Milestone 2: Single Merge

### Deliverables

- single merge command with lock protection
- conflict detection + artifact persistence
- workspace auto-checkpoint for uncommitted changes
- merge session persistence

### Acceptance Criteria

- merge succeeds for non-conflicting workspace changes
- unresolved conflicts produce exit code `3` and conflict artifact
- uncommitted workspace changes are included via auto-checkpoint

## Milestone 3: Multi Merge Queue

### Deliverables

- `merge-many` command
- ordering strategies (`created`, `priority`, `manual`)
- stop/continue conflict behavior
- preflight mode and report export

### Acceptance Criteria

- deterministic results for same input/order
- stop-on-conflict records remaining workspaces as `skipped`
- continue-on-conflict proceeds and records failures

## Milestone 4: Review and Approval

### Deliverables

- Ink review TUI
- review artifact persistence + markdown export
- non-interactive review modes (`--readonly`, `--approve-all`)
- optional merge gate requiring approved review

### Acceptance Criteria

- reviewer can approve/reject and save artifacts
- automation can create approved artifacts without TTY
- merge gate blocks non-approved workspaces when enabled

## Milestone 5: Backend and Workspace Policies

### Deliverables

- backend support: `worktree`, `apfs-cow`, `overlay`
- backend diagnostics command (`backends`)
- backend health command (`doctor`)
- workspace content policy with glob support (`include`, `exclude`, `symlink`)
- hard internal excludes enforced regardless of policy

### Acceptance Criteria

- backend selection works via command and config defaults
- strict backend mode fails when requested backend unavailable
- `apfs-cow` symlink policy supports `shared-live` and `safety-restricted`
- spawned workspace never includes snapshot/spawn internals

## Milestone 6: Recovery and Maintenance

### Deliverables

- revert command (`--session`, `--last`, `--abort`)
- lock recovery command (`unlock --force`)
- overlay metadata repair (`repair-mounts`)
- cleanup lifecycle (`cleanup`, `cleanup --all-archived`)

### Acceptance Criteria

- merge sessions can be reverted deterministically
- stale lock can be force-unlocked
- overlay stale metadata can be repaired
- archived records can be purged safely

## Test Strategy

1. Integration tests with temporary git repositories for spawn/merge/revert/cleanup.
2. Command behavior tests for path inference and optional project path forms.
3. Backend and policy tests for fallback/strict behavior.
4. Config migration and schema validation tests.

## Risks and Mitigations

- Risk: backend divergence between host platforms.
  - Mitigation: explicit backend diagnostics + strict/fallback policy.
- Risk: unsafe symlink behavior in shared-live mode.
  - Mitigation: dedicated safety-restricted mode + explicit operator choice.
- Risk: spawned workspace leaking internal project artifacts.
  - Mitigation: unconditional hard excludes and spawned-dir discovery.
