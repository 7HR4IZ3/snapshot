<h1 align="center">Snapshot</h1>

<p align="center">
  Git workspaces for agents that do not step on each other.<br>
  Spawn the work. Review the diff. Keep the merge.
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#the-workflow">Workflow</a> ·
  <a href="DOCS.md">Documentation</a> ·
  <a href="#contributing">Contributing</a>
</p>

Your agents can work in parallel. Your main checkout does not have to.

Snapshot gives each agent its own workspace and branch, records what that workspace started from, and lets you review the result before it reaches the project. It is a small local CLI around Git—not an agent runner, hosted service, or replacement for Git.

## Install

Snapshot currently builds from source. You need [Bun](https://bun.sh) and Git.

```sh
git clone https://github.com/7HR4IZ3/snapshot.git
cd snapshot
bun install
bun run build
bun link
```

Check that the command is available:

```sh
snapshot --help
```

## The workflow

Run Snapshot from the repository you want to coordinate:

```sh
cd /path/to/project
snapshot init
snapshot spawn ../project-agent-a --label agent-a
snapshot spawn ../project-agent-b --label agent-b
snapshot tui
```

Now let the agents work in their own directories. When they are ready:

```sh
snapshot list
snapshot status ../project-agent-a
snapshot diff ../project-agent-a --stat
snapshot review ../project-agent-a
snapshot merge ../project-agent-a
```

The usual shape is:

```text
one project → several workspaces → review → selected merges
```

## What Snapshot does

### Gives every agent a real workspace

`snapshot spawn` creates an isolated workspace and branch from the current project. Each record keeps the workspace path, branch, base commit, backend, policy, and lifecycle state together, so “which version did this agent start from?” has an answer.

The default `worktree` backend is the dependable choice. On hosts that support them, `apfs-cow` saves disk space with APFS copy-on-write clones and `overlay` uses an overlay-style mount. `auto` chooses the best available option.

### Lets you review before you merge

`snapshot status` and `snapshot diff` are useful from a shell. `snapshot review` opens the OpenTUI review screen in an interactive terminal, with file and hunk navigation, decisions, notes, and an approval record.

Nothing is merged just because a workspace exists. You decide what is ready.

### Makes merging deliberate

Merge one workspace or queue several of them:

```sh
snapshot merge ../project-agent-a
snapshot merge-many --from ../project-agent-a,../project-agent-b
```

A single merge can be committed or left for manual Git control. Multi-workspace merges need commits so each entry can be tracked and reverted safely. They are processed in a deterministic order and can write a report for what was merged, skipped, or left unresolved.

### Gives conflicts somewhere to go

When an interactive merge conflicts, Snapshot opens an OpenTUI resolver instead of leaving you with an unexplained failure. Choose the target version, the workspace version, or a manual edit for each conflict, then finalize when the result is complete.

If a merge needs attention later, the project also has:

```sh
snapshot doctor
snapshot unlock --force
snapshot revert --last
```

`unlock --force` is for a merge lock you have confirmed is stale. `revert` works from Snapshot’s recorded merge sessions, so recovery is part of the workflow rather than an emergency scavenger hunt.

### Handles the small jobs too

Not every task needs a complete workspace. For a generated file, prompt output, or one-file experiment:

```sh
snapshot spawn-file src/app.ts /tmp/app.agent.ts
# edit /tmp/app.agent.ts
snapshot pull-file /tmp/app.agent.ts
```

Snapshot keeps a base copy and attempts a three-way merge when both the project file and the copied file changed. Use `pull-all` when several file snapshots are ready.

## The dashboard

```sh
snapshot tui
```

The dashboard keeps the project’s moving parts in one place: workspace inventory, changed-file counts, merge sessions, conflicts, backend capabilities, and project health.

The other interactive screens use the same OpenTUI foundation:

- `snapshot review <workspace-ref>` for reviewing a workspace.
- The conflict resolver for interactive merge conflicts.

Use `1`–`4` to switch dashboard views, `j`/`k` or the arrow keys to move, `r` to refresh, `?` for help, and `q` to leave.

## Run it from anywhere

Project-scoped commands use the current directory by default:

```sh
snapshot list
snapshot doctor
snapshot config get
```

When the project is somewhere else, say so explicitly:

```sh
snapshot doctor --project /path/to/project
snapshot tui --project /path/to/project
```

If you run a command inside a spawned workspace, Snapshot follows its workspace marker back to the canonical project. The explicit `--project` form is preferred when scripting or working across several repositories.

## Keep automation boring

Snapshot has machine-readable output and non-interactive review modes for scripts and CI:

```sh
snapshot --json list
snapshot review ../project-agent-a --approve-all
snapshot review ../project-agent-a --readonly
```

Interactive screens need a TTY. Use JSON output, `--readonly`, `--approve-all`, or external conflict tooling when there is no terminal to draw on.

## Local by design

Snapshot works with the Git repository on your machine. Project metadata lives in `.snapshot/`, which Snapshot adds to Git’s excludes during initialization. The tool does not run your agents or require an account; it gives the work around them a safer shape.

## Documentation

[DOCS.md](DOCS.md) has the complete command reference, dashboard and conflict keys, workspace policy, backend behavior, configuration, recovery notes, troubleshooting, and contributor details.

## Contributing

```sh
bun install
bun run test
bunx tsc --noEmit
bun run build
```

Found a bug or have an idea? Open an issue or send a pull request.
