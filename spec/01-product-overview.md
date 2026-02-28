# 01 - Product Overview

## Vision

`snapshot` enables multiple AI agents to work on the same codebase in parallel without directly colliding in a shared working directory. Each agent gets an isolated virtual workspace, makes changes independently, and submits its work for review and controlled merge.

The user experience should feel like a "virtual code branch folder" model, while v1 implementation combines proven git primitives with backend-specific workspace materialization for space and performance trade-offs.

## v1 Goals

1. Provide isolated workspaces with fast creation and cleanup.
2. Track and review changes per workspace and per agent.
3. Merge one or many workspaces into a target branch with deterministic ordering.
4. Prefer virtual workspace changes on text conflicts by default.
5. Emit explicit conflict reports for cases that cannot be safely auto-resolved.
6. Support backend selection (`worktree`, `apfs-cow`, `overlay`) and capability diagnostics.
7. Support workspace content policies (`include`, `exclude`, `symlink`) with hard safety excludes.

## v1 Non-Goals

1. Non-git project support.
2. Distributed scheduler/orchestrator for autonomous agent execution.
3. Web-based graphical UI.
4. Full semantic conflict resolution (AST-aware merges).
5. Long-term policy engine for enterprise governance.

## Primary Users

- Solo developers coordinating several AI agents.
- Small teams experimenting with AI-assisted branch workflows.
- Tooling developers wanting auditable agent-produced diffs.

## Core Concepts

- `Project`: canonical git repository directory.
- `Workspace`: isolated backend instance + branch associated with an agent.
- `Workspace backend`:
  - `worktree`: git worktree-based workspace.
  - `apfs-cow`: APFS copy-on-write clone workspace.
  - `overlay`: overlay mount workspace with fallback behavior depending on policy.
- `Base commit`: commit SHA from which workspace was spawned.
- `Review`: optional human approval metadata attached to workspace diff.
- `Merge session`: a single merge operation (single or multi-workspace).

## Product Constraints

- v1 must fail safely and preserve user data over maximizing automation.
- all merge outcomes must be reproducible using recorded metadata.
- command outputs should be script-friendly when possible.
- hard excludes (`.snapshot`, `.spawned`, existing spawned dirs, and related internals) must never leak into spawned workspaces regardless of user include/symlink policies.

## UX Principles

1. Easy path first: one command to spawn, one command to review, one command to merge.
2. Rich diagnostics on failure: actionable errors, no opaque stack traces by default.
3. Deterministic merge ordering for multi-workspace merges.
4. No hidden mutation in the canonical project beyond explicit merge commands.

## Success Criteria

- Spawning a workspace from a medium-size repo completes quickly and reliably.
- Workspace changes are always attributable to an agent/workspace id.
- Multi-workspace merge results are deterministic with the same inputs and order.
- Conflict report is precise enough for manual resolution without guessing.
