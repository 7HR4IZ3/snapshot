import { describe, expect, test } from "bun:test";
import { join } from "node:path";

function runSnapshot(args: string[]): { code: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync({
    cmd: [process.execPath, "run", join(process.cwd(), "src", "cli.ts"), ...args],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

describe("snapshot tui command", () => {
  test("advertises the OpenTUI dashboard in help", () => {
    const result = runSnapshot(["--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("snapshot tui [--project <path>]");
  });

  test("fails safely when no interactive terminal is available", () => {
    const result = runSnapshot(["tui", process.cwd()]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("ERR_TUI_TTY_REQUIRED");
  });

  test("uses the current directory by default and supports --project", () => {
    const inferred = runSnapshot(["backends"]);
    expect(inferred.code).toBe(0);
    expect(inferred.stdout).toContain(`Project: ${process.cwd()}`);

    const explicit = Bun.spawnSync({
      cmd: [process.execPath, "run", join(process.cwd(), "src", "cli.ts"), "backends", "--project", process.cwd()],
      cwd: "/tmp",
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(explicit.exitCode).toBe(0);
    expect(explicit.stdout.toString()).toContain(`Project: ${process.cwd()}`);
  });
});
