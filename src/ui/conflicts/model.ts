export type ChunkChoice = "unresolved" | "target" | "workspace" | "all";

export interface ConflictChunk {
  index: number;
  target: string;
  workspace: string;
}

export type ConflictSegment =
  | { type: "text"; text: string }
  | { type: "chunk"; index: number };

export interface ParsedConflictText {
  segments: ConflictSegment[];
  chunks: ConflictChunk[];
}

function tokenizeWithNewlines(input: string): string[] {
  return input.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

export function parseConflictText(input: string): ParsedConflictText {
  const lines = tokenizeWithNewlines(input);
  const segments: ConflictSegment[] = [];
  const chunks: ConflictChunk[] = [];

  const textBuffer: string[] = [];
  let i = 0;

  const flushText = () => {
    if (textBuffer.length === 0) {
      return;
    }
    segments.push({ type: "text", text: textBuffer.join("") });
    textBuffer.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (!line.startsWith("<<<<<<<")) {
      textBuffer.push(line);
      i += 1;
      continue;
    }

    const targetLines: string[] = [];
    const workspaceLines: string[] = [];
    const markerStart = line;

    i += 1;
    while (i < lines.length && (lines[i] ?? "").trimEnd() !== "=======") {
      targetLines.push(lines[i] ?? "");
      i += 1;
    }

    if (i >= lines.length) {
      textBuffer.push(markerStart);
      textBuffer.push(...targetLines);
      break;
    }

    i += 1;
    while (i < lines.length && !(lines[i] ?? "").startsWith(">>>>>>>")) {
      workspaceLines.push(lines[i] ?? "");
      i += 1;
    }

    if (i >= lines.length) {
      textBuffer.push(markerStart);
      textBuffer.push(...targetLines);
      textBuffer.push("=======\n");
      textBuffer.push(...workspaceLines);
      break;
    }

    const chunkIndex = chunks.length;
    flushText();

    chunks.push({
      index: chunkIndex,
      target: targetLines.join(""),
      workspace: workspaceLines.join(""),
    });
    segments.push({ type: "chunk", index: chunkIndex });

    i += 1;
  }

  flushText();

  return { segments, chunks };
}

export function renderMergedPreview(parsed: ParsedConflictText, choices: Record<number, ChunkChoice>): string {
  let out = "";

  for (const segment of parsed.segments) {
    if (segment.type === "text") {
      out += segment.text;
      continue;
    }

    const chunk = parsed.chunks[segment.index];
    if (!chunk) {
      continue;
    }

    const choice = choices[segment.index] ?? "unresolved";
    if (choice === "target") {
      out += chunk.target;
      continue;
    }
    if (choice === "workspace") {
      out += chunk.workspace;
      continue;
    }
    if (choice === "all") {
      out += chunk.target;
      out += chunk.workspace;
      continue;
    }

    out += "<<<<<<< TARGET\n";
    out += chunk.target;
    out += "=======\n";
    out += chunk.workspace;
    out += ">>>>>>> WORKSPACE\n";
  }

  return out;
}

export function countUnresolved(parsed: ParsedConflictText, choices: Record<number, ChunkChoice>): number {
  let unresolved = 0;
  for (const chunk of parsed.chunks) {
    const choice = choices[chunk.index] ?? "unresolved";
    if (choice === "unresolved") {
      unresolved += 1;
    }
  }
  return unresolved;
}
