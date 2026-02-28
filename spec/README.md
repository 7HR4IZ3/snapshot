# Snapshot v1 Implementation Spec

This folder defines the implementation specification for `snapshot` v1.

Scope is intentionally constrained to:

- Git repositories only
- TypeScript + Bun prototype CLI
- Multi-agent isolated workspaces via pluggable backends (`worktree`, `apfs-cow`, `overlay`)
- Review and merge workflows with deterministic behavior
- Configurable workspace filtering (`include`/`exclude`) and `apfs-cow` symlink policies

## Documents

- `spec/01-product-overview.md`: product goals, non-goals, and assumptions
- `spec/02-cli-contract.md`: command surface and command behavior
- `spec/03-architecture.md`: module boundaries and execution model
- `spec/04-merge-conflict-model.md`: merge orchestration and conflict policy
- `spec/05-review-ui.md`: review TUI behavior and exported artifacts
- `spec/06-data-model.md`: on-disk metadata and JSON schemas
- `spec/07-milestones.md`: delivery phases and acceptance criteria
- `spec/08-operations-playbook.md`: practical runbooks and command recipes
- `spec/09-workspace-policy-spec.md`: include/exclude/symlink policy semantics
- `spec/10-backend-and-recovery-spec.md`: backend capability, strict/fallback, doctor/repair
- `spec/11-packaging-distribution-spec.md`: build, dist layout, global command installation
- `spec/12-feature-completeness-matrix.md`: implemented feature inventory and status

## Principles

1. Deterministic behavior over implicit magic
2. Safety-first merges with explicit conflict visibility
3. Portable metadata model to support a future Rust rewrite
4. Keep the first version small, reliable, and inspectable
5. Hard exclude project-internal snapshot/spawn artifacts from spawned workspaces
