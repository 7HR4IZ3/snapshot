# 07 - Milestones and Acceptance Criteria

## Milestone 1: Foundation

### Deliverables

- CLI scaffold and command runner
- project init and config management
- spawn/status/diff commands
- metadata store and schema validation

### Acceptance Criteria

- can initialize a git repo with `.snapshot/` metadata
- can spawn multiple independent workspaces from same project
- status and diff are accurate against stored base commit

## Milestone 2: Single Merge

### Deliverables

- merge command with lock protection
- virtual-preferred text conflict handling
- unresolved conflict detection and reporting
- merge session record persistence

### Acceptance Criteria

- merge succeeds cleanly for non-conflicting workspace changes
- text conflicts are auto-resolved toward workspace by default
- unresolved conflicts produce exit code `3` and conflict artifact

## Milestone 3: Multi Merge Queue

### Deliverables

- merge-many command
- deterministic ordering strategies
- per-entry result reporting
- optional continue-on-conflict behavior

### Acceptance Criteria

- same inputs and order produce same merge outcomes
- stop-on-conflict and continue-on-conflict both behave as configured
- output report identifies merged, conflicted, skipped entries

## Milestone 4: Review TUI

### Deliverables

- Ink-based review interface
- file/hunk navigation and decision capture
- review artifact persistence
- optional markdown export

### Acceptance Criteria

- reviewer can approve/reject files and save decision state
- review artifact maps decisions to specific files (and notes)
- merge command can optionally enforce approval gate via config

## Milestone 5: Hardening and DX

### Deliverables

- improved diagnostics and verbose mode
- stale lock recovery flow
- cleanup command and archive lifecycle
- end-to-end docs and examples

### Acceptance Criteria

- common failure modes include actionable messages
- cleanup does not orphan metadata or worktrees
- command help text and docs are sufficient for first-time users

## Test Strategy

1. Unit tests for service logic and schema validation.
2. Integration tests with temp git repos for spawn/merge flows.
3. Golden tests for JSON output shape.
4. Smoke tests for review TUI key flows.

## Risks and Mitigations

- Risk: git edge-case complexity (renames, binaries, submodules).
  - Mitigation: explicit unsupported/conflict classes in v1.
- Risk: lockfiles stale after crashes.
  - Mitigation: pid-aware lock metadata and force unlock command path.
- Risk: user confusion between workspace path and workspace id.
  - Mitigation: accept both refs and print both in command output.
