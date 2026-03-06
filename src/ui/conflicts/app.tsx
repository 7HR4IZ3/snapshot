import React, { useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import {
  countUnresolved,
  parseConflictText,
  renderMergedPreview,
  type ChunkChoice,
} from "./model.js";

type Mode = "review" | "edit";

export interface ConflictItem {
  path: string;
  className: string;
  guidance: string;
  targetText: string;
  workspaceText: string;
  conflictedText: string;
}

export type ConflictDecisionAction =
  | "keep-target"
  | "keep-workspace"
  | "manual-merge"
  | "skip";

export interface ConflictUiDecision {
  path: string;
  action: ConflictDecisionAction;
  mergedText?: string;
}

export interface ConflictUiResult {
  finalized: boolean;
  decisions: ConflictUiDecision[];
}

interface ConflictAppProps {
  items: ConflictItem[];
  onDone: (result: ConflictUiResult) => void;
}

function bar(percent: number): string {
  const width = 20;
  const filled = Math.round((percent / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function view(input: string, offset: number, height: number): string[] {
  const lines = input.split("\n");
  const start = Math.max(0, Math.min(offset, Math.max(0, lines.length - height)));
  const out = lines.slice(start, start + height);
  while (out.length < height) out.push("");
  return out;
}

function recommend(target: string, workspace: string): ChunkChoice {
  if (target.trim() === workspace.trim()) return "target";
  const ts = (target.includes("await") ? 2 : 0) + (target.includes("try") && target.includes("catch") ? 1 : 0);
  const ws = (workspace.includes("await") ? 2 : 0) + (workspace.includes("try") && workspace.includes("catch") ? 1 : 0);
  if (ts === ws) return "workspace";
  return ts > ws ? "target" : "workspace";
}

function mergedWithManual(
  conflictedText: string,
  parsed: ReturnType<typeof parseConflictText>,
  choices: Record<number, ChunkChoice>,
  manual: Record<number, string>,
): string {
  let out = renderMergedPreview(parsed, choices);
  for (const [rawIndex, manualText] of Object.entries(manual)) {
    const i = Number(rawIndex);
    const chunk = parsed.chunks[i];
    if (!chunk) continue;
    const marker =
      "<<<<<<< TARGET\n" +
      chunk.target +
      "=======\n" +
      chunk.workspace +
      ">>>>>>> WORKSPACE\n";
    const replacement = manualText.endsWith("\n") ? manualText : `${manualText}\n`;
    out = out.replace(marker, replacement);
  }
  return out.length > 0 ? out : conflictedText;
}

export function ConflictApp({ items, onDone }: ConflictAppProps): React.JSX.Element {
  const { exit } = useApp();

  const [fileIndex, setFileIndex] = useState(0);
  const [chunkIndex, setChunkIndex] = useState(0);
  const [diffOffset, setDiffOffset] = useState(0);
  const [previewOffset, setPreviewOffset] = useState(0);
  const [quitArmed, setQuitArmed] = useState(false);
  const [mode, setMode] = useState<Mode>("review");

  const [editLines, setEditLines] = useState<string[]>([""]);
  const [editRow, setEditRow] = useState(0);
  const [editCol, setEditCol] = useState(0);

  const parsedRows = useMemo(
    () => items.map((item) => ({ item, parsed: parseConflictText(item.conflictedText) })),
    [items],
  );

  const [choicesByPath, setChoicesByPath] = useState<Record<string, Record<number, ChunkChoice>>>(() => {
    const out: Record<string, Record<number, ChunkChoice>> = {};
    for (const row of parsedRows) {
      const m: Record<number, ChunkChoice> = {};
      for (const c of row.parsed.chunks) m[c.index] = "unresolved";
      out[row.item.path] = m;
    }
    return out;
  });

  const [manualByPath, setManualByPath] = useState<Record<string, Record<number, string>>>({});

  const current = parsedRows[fileIndex];
  const currentItem = current?.item;
  const parsed = current?.parsed;
  const chunks = parsed?.chunks ?? [];
  const safeChunk = Math.min(chunkIndex, Math.max(0, chunks.length - 1));
  const selected = chunks[safeChunk];
  const choices = (currentItem ? choicesByPath[currentItem.path] : undefined) ?? {};
  const manual = (currentItem ? manualByPath[currentItem.path] : undefined) ?? {};

  const unresolvedPerFile = useMemo(() => {
    return parsedRows.map((row) => {
      const unresolved = countUnresolved(row.parsed, choicesByPath[row.item.path] ?? {});
      const manualCount = Object.keys(manualByPath[row.item.path] ?? {}).length;
      return Math.max(0, unresolved - manualCount);
    });
  }, [parsedRows, choicesByPath, manualByPath]);

  const total = parsedRows.reduce((sum, row) => sum + row.parsed.chunks.length, 0);
  const unresolved = unresolvedPerFile.reduce((sum, c) => sum + c, 0);
  const resolved = total - unresolved;
  const percent = total > 0 ? Math.round((resolved / total) * 100) : 100;

  const mergedPreview = useMemo(() => {
    if (!currentItem || !parsed) return "";
    return mergedWithManual(currentItem.conflictedText, parsed, choices, manual);
  }, [currentItem, parsed, choices, manual]);

  const pick = (choice: ChunkChoice): void => {
    if (!currentItem || !selected) return;
    setChoicesByPath((prev) => ({
      ...prev,
      [currentItem.path]: {
        ...(prev[currentItem.path] ?? {}),
        [selected.index]: choice,
      },
    }));
    setManualByPath((prev) => {
      const fileManual = { ...(prev[currentItem.path] ?? {}) };
      delete fileManual[selected.index];
      return { ...prev, [currentItem.path]: fileManual };
    });
  };

  const startManual = (): void => {
    if (!currentItem || !selected) return;
    const existing = manual[selected.index];
    const seed = existing ?? (recommend(selected.target, selected.workspace) === "target" ? selected.target : selected.workspace);
    const lines = seed.split("\n");
    setEditLines(lines.length > 0 ? lines : [""]);
    setEditRow(0);
    setEditCol(0);
    setMode("edit");
  };

  const saveManual = (): void => {
    if (!currentItem || !selected) return;
    const txt = editLines.join("\n");
    setManualByPath((prev) => ({
      ...prev,
      [currentItem.path]: {
        ...(prev[currentItem.path] ?? {}),
        [selected.index]: txt,
      },
    }));
    setMode("review");
  };

  const openEditor = async (): Promise<void> => {
    const editor = process.env.EDITOR || "vi";
    const tmp = `/tmp/snapshot_main_conflict_${Date.now()}.txt`;
    const { writeFileSync, readFileSync, unlinkSync } = await import("node:fs");
    writeFileSync(tmp, editLines.join("\n"), "utf8");
    const proc = Bun.spawn([editor, tmp]);
    await proc.exited;
    try {
      const text = readFileSync(tmp, "utf8");
      const lines = text.split("\n");
      setEditLines(lines.length > 0 ? lines : [""]);
      setEditRow(0);
      setEditCol(0);
    } finally {
      try {
        unlinkSync(tmp);
      } catch {
      }
    }
  };

  useInput((input, key) => {
    if (mode === "edit") {
      if (key.escape) {
        setMode("review");
        return;
      }
      if (key.return) {
        saveManual();
        return;
      }
      if (input === "o") {
        void openEditor();
        return;
      }
      if (key.upArrow) {
        setEditRow((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setEditRow((prev) => Math.min(editLines.length - 1, prev + 1));
        return;
      }
      if (key.leftArrow) {
        setEditCol((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.rightArrow) {
        setEditCol((prev) => Math.min((editLines[editRow] ?? "").length, prev + 1));
        return;
      }
      if (key.backspace) {
        setEditLines((prev) => {
          const out = [...prev];
          const line = out[editRow] ?? "";
          if (editCol > 0) {
            out[editRow] = line.slice(0, editCol - 1) + line.slice(editCol);
            setEditCol((c) => Math.max(0, c - 1));
            return out;
          }
          if (editRow > 0) {
            const prevLine = out[editRow - 1] ?? "";
            out[editRow - 1] = prevLine + line;
            out.splice(editRow, 1);
            setEditRow((r) => Math.max(0, r - 1));
            setEditCol(prevLine.length);
          }
          return out;
        });
        return;
      }
      if (input.length === 1 && !key.ctrl && !key.meta) {
        setEditLines((prev) => {
          const out = [...prev];
          const line = out[editRow] ?? "";
          out[editRow] = line.slice(0, editCol) + input + line.slice(editCol);
          return out;
        });
        setEditCol((prev) => prev + 1);
      }
      return;
    }

    if (input === "q") {
      if (!quitArmed) {
        setQuitArmed(true);
        return;
      }
      onDone({ finalized: false, decisions: [] });
      exit();
      return;
    }
    setQuitArmed(false);

    if (input === "f") {
      const decisions: ConflictUiDecision[] = parsedRows.map((row) => {
        const c = choicesByPath[row.item.path] ?? {};
        const m = manualByPath[row.item.path] ?? {};
        const unresolvedCount = Math.max(0, countUnresolved(row.parsed, c) - Object.keys(m).length);

        if (row.parsed.chunks.length === 0 || unresolvedCount > 0) {
          return { path: row.item.path, action: "skip" };
        }

        const manualCount = Object.keys(m).length;
        if (manualCount === 0) {
          const picked = row.parsed.chunks.map((chunk) => c[chunk.index] ?? "unresolved");
          if (picked.every((x) => x === "target")) return { path: row.item.path, action: "keep-target" };
          if (picked.every((x) => x === "workspace")) return { path: row.item.path, action: "keep-workspace" };
        }

        return {
          path: row.item.path,
          action: "manual-merge",
          mergedText: mergedWithManual(row.item.conflictedText, row.parsed, c, m),
        };
      });

      onDone({ finalized: true, decisions });
      exit();
      return;
    }

    if (input === "1") return pick("target");
    if (input === "2") return pick("workspace");
    if (input === "3") return pick("all");
    if (input === "0") return pick("unresolved");
    if (input === "a" && selected) return pick(recommend(selected.target, selected.workspace));
    if (input === "m") return startManual();

    if (input === "n" || key.rightArrow) {
      setChunkIndex((prev) => Math.min(Math.max(0, chunks.length - 1), prev + 1));
      return;
    }
    if (input === "p" || key.leftArrow) {
      setChunkIndex((prev) => Math.max(0, prev - 1));
      return;
    }

    if (key.upArrow || input === "k") {
      setFileIndex((prev) => Math.max(0, prev - 1));
      setChunkIndex(0);
      setDiffOffset(0);
      setPreviewOffset(0);
      return;
    }
    if (key.downArrow || input === "j") {
      setFileIndex((prev) => Math.min(items.length - 1, prev + 1));
      setChunkIndex(0);
      setDiffOffset(0);
      setPreviewOffset(0);
      return;
    }
    if (input === "u") {
      setDiffOffset((prev) => Math.max(0, prev - 1));
      setPreviewOffset((prev) => Math.max(0, prev - 1));
      return;
    }
    if (input === "d") {
      setDiffOffset((prev) => prev + 1);
      setPreviewOffset((prev) => prev + 1);
    }
  });

  if (mode === "edit") {
    const start = Math.max(0, editRow - 5);
    const rows = editLines.slice(start, start + 12);
    return (
      <Box flexDirection="column" padding={1}>
        <Box borderStyle="bold" borderColor="yellow" paddingX={1}>
          <Text bold>MANUAL MERGE</Text>
        </Box>
        <Text color="gray">Simple cursor editor. Enter save, Esc cancel, o open $EDITOR</Text>
        <Box marginTop={1} borderStyle="round" borderColor="yellow" flexDirection="column">
          {rows.map((line, idx) => {
            const row = start + idx;
            const active = row === editRow;
            return (
              <Text key={idx} color={active ? "yellow" : "white"}>
                {active ? "▸" : " "} {line}
              </Text>
            );
          })}
        </Box>
      </Box>
    );
  }

  const fileSummary = items.slice(0, 3).map((it, i) => `${it.path}${i < Math.min(2, items.length - 1) ? " │ " : ""}`).join("");

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="bold" borderColor="cyan" paddingX={1} flexDirection="column">
        <Text bold>SNAPSHOT MULTI-TREE CONFLICT REVIEW</Text>
        <Text color="gray">Files: {fileSummary}</Text>
        <Text color="gray">Progress: {bar(percent)} {percent}% │ {resolved}/{total} conflicts resolved</Text>
      </Box>

      <Box marginTop={1}>
        <Text bold>CURRENT FILE: {currentItem?.path ?? "-"}</Text>
      </Box>

      <Box marginTop={1}>
        <Box flexGrow={1} borderStyle="round" borderColor="gray" flexDirection="column">
          <Box paddingX={1}>
            <Text>DIFF VIEW: [Unified] [Side-by-Side] [3-Way Merge]</Text>
          </Box>
          {selected ? (
            view(selected.target, diffOffset, 8).map((line, i) => {
              const rhs = view(selected.workspace, diffOffset, 8)[i] ?? "";
              return (
                <Text key={i}>
                  <Text color="gray">{String(i + 1).padStart(3, " ")} │ </Text>
                  <Text color={line === rhs ? "gray" : "green"}>{line === rhs ? `  ${line}` : `- ${line}`}</Text>
                  <Text color="gray"> │ </Text>
                  <Text color={line === rhs ? "gray" : "cyan"}>{line === rhs ? `  ${rhs}` : `+ ${rhs}`}</Text>
                </Text>
              );
            })
          ) : (
            <Text color="gray">No conflict chunk selected</Text>
          )}
        </Box>
        <Box width={28} marginLeft={1} borderStyle="round" borderColor="gray" flexDirection="column" paddingX={1}>
          <Text bold>TREE SELECTOR</Text>
          <Text>[✓] base</Text>
          <Text>[✓] workspace</Text>
          <Text> </Text>
          <Text bold>FILTERS</Text>
          <Text>[Show All]</Text>
          <Text>[Conflicts]</Text>
          <Text>[Differences]</Text>
        </Box>
      </Box>

      <Box marginTop={1} borderStyle="round" borderColor="gray" flexDirection="column" paddingX={1}>
        <Text color="yellow">LINE {safeChunk + 1}: CONFLICT DETECTED</Text>
        <Box gap={1} marginTop={1}>
          <Box flexGrow={1} borderStyle="round" borderColor="green" flexDirection="column" paddingX={1}>
            <Text color="green" bold>base</Text>
            {selected ? view(selected.target, diffOffset, 5).map((line, i) => <Text key={i} color="green">{line}</Text>) : <Text color="gray">-</Text>}
          </Box>
          <Box flexGrow={1} borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1}>
            <Text color="cyan" bold>workspace</Text>
            {selected ? view(selected.workspace, diffOffset, 5).map((line, i) => <Text key={i} color="cyan">{line}</Text>) : <Text color="gray">-</Text>}
          </Box>
        </Box>
        <Box gap={2} marginTop={1}>
          <Text><Text color="green" bold>[1]</Text> accept base</Text>
          <Text><Text color="cyan" bold>[2]</Text> accept workspace</Text>
          <Text><Text color="yellow" bold>[m]</Text> manual merge</Text>
          <Text><Text color="gray" bold>[a]</Text> recommend</Text>
        </Box>
      </Box>

      <Box marginTop={1} borderStyle="round" borderColor="gray" paddingX={1}>
        <Text color="gray">CONFLICT CHUNKS:</Text>
        {chunks.map((chunk, i: number) => {
          const manualChosen = manual[chunk.index] != null;
          const choice = manualChosen ? "manual" : (choices[chunk.index] ?? "unresolved");
          const active = i === safeChunk;
          const symbol = active ? "●" : choice === "unresolved" ? "○" : choice === "target" ? "①" : choice === "workspace" ? "②" : "③";
          const color = active ? "yellow" : choice === "unresolved" ? "gray" : choice === "target" ? "green" : choice === "workspace" ? "cyan" : "magenta";
          return <Text key={chunk.index} color={color}> {symbol}</Text>;
        })}
        <Text color="gray"> │ n/p: next/prev</Text>
      </Box>

      <Box marginTop={1} borderStyle="round" borderColor="gray" paddingX={1} justifyContent="space-between">
        <Text color="gray">Commands: [f] finalize [u/d] scroll [q] quit</Text>
        <Text color={unresolved > 0 ? "yellow" : "green"}>pending: {unresolved}</Text>
      </Box>

      <Box marginTop={1} borderStyle="round" borderColor="gray" flexDirection="column" paddingX={1}>
        <Text bold>Merged Preview</Text>
        {view(mergedPreview, previewOffset, 6).map((line, i) => <Text key={i}>{line}</Text>)}
      </Box>

      {currentItem && (
        <Box marginTop={1} borderStyle="round" borderColor="gray" paddingX={1}>
          <Text color="gray">Guidance: </Text>
          <Text>{currentItem.guidance}</Text>
        </Box>
      )}

      {quitArmed && (
        <Box marginTop={1} borderStyle="bold" borderColor="red" paddingX={1}>
          <Text color="red" bold>Press q again to quit without applying choices</Text>
        </Box>
      )}
    </Box>
  );
}
