export type DiffLineKind =
  | "added"
  | "removed"
  | "hunk"
  | "file"
  | "metadata"
  | "gap"
  | "context";

export interface DiffViewLine {
  text: string;
  kind: DiffLineKind;
}

export function isChangedLine(line: string): boolean {
  return (line.startsWith("+") && !line.startsWith("+++")) || (line.startsWith("-") && !line.startsWith("---"));
}

export function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return "added";
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return "removed";
  }
  if (line.startsWith("@@")) {
    return "hunk";
  }
  if (line.startsWith("diff --git ")) {
    return "file";
  }
  if (line.startsWith("... ") && line.endsWith(" unchanged lines ...")) {
    return "gap";
  }
  if (
    line.startsWith("index ") ||
    line.startsWith("---") ||
    line.startsWith("+++") ||
    line.startsWith("new file mode") ||
    line.startsWith("deleted file mode") ||
    line.startsWith("similarity index")
  ) {
    return "metadata";
  }
  return "context";
}

export function trimChangedRegions(lines: string[], contextLines = 2): string[] {
  if (lines.length === 0) {
    return [];
  }

  const changedIndices: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (isChangedLine(lines[i] ?? "")) {
      changedIndices.push(i);
    }
  }

  if (changedIndices.length === 0) {
    return lines;
  }

  const rawRanges: Array<{ start: number; end: number }> = changedIndices.map((index) => ({
    start: Math.max(0, index - contextLines),
    end: Math.min(lines.length - 1, index + contextLines),
  }));

  const mergedRanges: Array<{ start: number; end: number }> = [];
  for (const range of rawRanges) {
    const last = mergedRanges[mergedRanges.length - 1];
    if (!last || range.start > last.end + 1) {
      mergedRanges.push({ ...range });
    } else {
      last.end = Math.max(last.end, range.end);
    }
  }

  const output: string[] = [];
  for (let i = 0; i < mergedRanges.length; i += 1) {
    const range = mergedRanges[i]!;
    if (i > 0) {
      const prev = mergedRanges[i - 1]!;
      const hiddenCount = Math.max(0, range.start - prev.end - 1);
      if (hiddenCount > 0) {
        output.push(`... ${hiddenCount} unchanged lines ...`);
      }
    }
    output.push(...lines.slice(range.start, range.end + 1));
  }

  return output;
}

export function formatPatchForDiffView(patch: string, contextLines = 2, withEntrySpacing = true): string[] {
  const lines = patch.split("\n");
  const output: string[] = [];

  let currentHunkHeader: string | null = null;
  let currentHunkBody: string[] = [];

  const flushHunk = (): void => {
    if (!currentHunkHeader) {
      return;
    }
    output.push(currentHunkHeader);
    output.push(...trimChangedRegions(currentHunkBody, contextLines));
    currentHunkHeader = null;
    currentHunkBody = [];
  };

  for (const line of lines) {
    if (line.startsWith("@@ ")) {
      flushHunk();
      currentHunkHeader = line;
      currentHunkBody = [];
      continue;
    }

    if (line.startsWith("diff --git ")) {
      flushHunk();
      if (withEntrySpacing && output.length > 0 && output[output.length - 1] !== "") {
        output.push("");
      }
      output.push(line);
      continue;
    }

    if (currentHunkHeader) {
      currentHunkBody.push(line);
    } else {
      output.push(line);
    }
  }

  flushHunk();
  return output;
}
