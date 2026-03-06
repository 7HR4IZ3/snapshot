import { describe, expect, test } from "bun:test";
import { parseConflictText, renderMergedPreview } from "../src/ui/conflicts/model";

describe("conflict ui model", () => {
  test("parses conflict blocks and supports mixed decisions", () => {
    const conflicted = [
      "start",
      "<<<<<<< HEAD",
      "target one",
      "=======",
      "workspace one",
      ">>>>>>> workspace",
      "middle",
      "<<<<<<< HEAD",
      "target two",
      "=======",
      "workspace two",
      ">>>>>>> workspace",
      "end",
      "",
    ].join("\n");

    const parsed = parseConflictText(conflicted);
    expect(parsed.chunks.length).toBe(2);

    const merged = renderMergedPreview(parsed, {
      0: "target",
      1: "workspace",
    });

    expect(merged).toContain("target one");
    expect(merged).toContain("workspace two");
    expect(merged).not.toContain("<<<<<<< HEAD");
  });

  test("keeps unresolved markers for unresolved chunks", () => {
    const conflicted = [
      "before",
      "<<<<<<< HEAD",
      "left",
      "=======",
      "right",
      ">>>>>>> branch",
      "after",
    ].join("\n");

    const parsed = parseConflictText(conflicted);
    const merged = renderMergedPreview(parsed, {
      0: "unresolved",
    });

    expect(merged).toContain("<<<<<<< TARGET");
    expect(merged).toContain("=======");
    expect(merged).toContain(">>>>>>> WORKSPACE");
  });

  test("returns full text when no conflict markers exist", () => {
    const text = "line1\nline2\n";
    const parsed = parseConflictText(text);
    expect(parsed.chunks.length).toBe(0);
    expect(renderMergedPreview(parsed, {})).toBe(text);
  });
});
