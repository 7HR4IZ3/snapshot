# 05 - Review UI (TUI)

## Purpose

Provide a fast terminal-native review flow for workspace changes before merge, with durable decision artifacts.

## Framework

- Ink (React for CLIs)
- Keyboard-driven interactions only in v1

## Views

1. File List Pane
   - changed files with status (A/M/D/R)
   - per-file decision badge (`unreviewed`, `approved`, `rejected`)

2. Diff Pane
   - patch hunks for selected file
   - hunk-level cursor

3. Footer / Keymap
   - hotkeys and session state

## Keybindings (Default)

- `j` / `k`: move file selection
- `n` / `p`: next/previous hunk
- `a`: approve file
- `r`: reject file
- `m`: add note on selected file/hunk
- `tab`: switch pane focus
- `s`: save review artifact
- `q`: quit (with unsaved warning)

## Review States

- `not_reviewed`
- `in_review`
- `approved`
- `rejected`

Workspace overall state is derived:

- `approved` if all changed files approved
- `rejected` if any file rejected
- `in_review` otherwise

## Artifact Output

Review session persists JSON artifact under `.snapshot/reviews/<review-id>.json`.

Fields:

- review id
- workspace id
- reviewer id
- startedAt / finishedAt
- file decisions
- optional hunk notes
- overall decision

Optional markdown export (`--export`) includes:

- workspace metadata
- concise file decision table
- reviewer notes

## UX Constraints

- Must handle large diffs gracefully (lazy load per-file hunks).
- Should maintain smooth navigation with low terminal redraw overhead.
- Must not mutate git state during review.

## Future Extensions (Post-v1)

- side-by-side diff mode
- comment threads
- rule-based approval checks
- web review dashboard consuming same review artifacts
