import React, { useMemo, useState, type JSX } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { classifyDiffLine, trimChangedRegions, type DiffLineKind } from "../../core/domain/diff-view.js";
import type { ReviewDecision } from "../../core/domain/review.js";
import { REVIEW_KEYMAP } from "./keymap.js";

export interface ReviewTuiFile {
  path: string;
  status: string;
  hunks: string[];
}

export interface ReviewTuiWorkspace {
  workspaceId: string;
  workspaceLabel: string;
  files: ReviewTuiFile[];
}

export interface ReviewTuiResult {
  save: boolean;
  decisions: Array<{ workspaceId: string; path: string; decision: ReviewDecision; note: string | null }>;
}

interface ReviewAppProps {
  workspaces: ReviewTuiWorkspace[];
  onDone: (result: ReviewTuiResult) => void;
}

type FilterType = "all" | "approved" | "rejected" | "unreviewed";

const STATUS_ICONS: Record<string, string> = {
  A: "+",
  D: "-",
  M: "~",
  R: "R",
  C: "C",
};

const STATUS_LABELS: Record<string, string> = {
  A: "ADDED",
  D: "DELETED",
  M: "MODIFIED",
  R: "RENAMED",
  C: "COPIED",
};

function decisionIcon(decision: ReviewDecision): string {
  switch (decision) {
    case "approved":
      return "✓";
    case "rejected":
      return "✗";
    default:
      return "○";
  }
}

function decisionBadge(decision: ReviewDecision): string {
  switch (decision) {
    case "approved":
      return "APPROVED";
    case "rejected":
      return "REJECTED";
    default:
      return "PENDING";
  }
}

function decisionColor(decision: ReviewDecision): "green" | "red" | "yellow" {
  switch (decision) {
    case "approved":
      return "green";
    case "rejected":
      return "red";
    default:
      return "yellow";
  }
}

function fileStatusColor(status: string): "green" | "red" | "yellow" | "cyan" | "blue" | "gray" {
  if (status.startsWith("A")) return "green";
  if (status.startsWith("D")) return "red";
  if (status.startsWith("M")) return "yellow";
  if (status.startsWith("R")) return "cyan";
  if (status.startsWith("C")) return "blue";
  return "gray";
}

function parseHunkStats(hunk: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  const lines = hunk.split("\n");
  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  }
  return { additions, deletions };
}

function diffColorFromKind(kind: DiffLineKind): "green" | "red" | "magenta" | "cyan" | "gray" | "white" {
  switch (kind) {
    case "added":
      return "green";
    case "removed":
      return "red";
    case "hunk":
      return "magenta";
    case "file":
      return "cyan";
    case "metadata":
    case "gap":
      return "gray";
    default:
      return "white";
  }
}

export function ReviewApp({ workspaces, onDone }: ReviewAppProps): React.JSX.Element {
  const { exit } = useApp();
  const [selectedTab, setSelectedTab] = useState(0);
  const [selectedFile, setSelectedFile] = useState(0);
  const [selectedHunk, setSelectedHunk] = useState(0);
  const [filter, setFilter] = useState<FilterType>("all");
  const [noteMode, setNoteMode] = useState(false);
  const [noteInput, setNoteInput] = useState("");
  const [quitArmed, setQuitArmed] = useState(false);

  const currentWorkspace = workspaces[selectedTab];
  const workspaceKey = currentWorkspace?.workspaceId ?? "";
  const files = currentWorkspace?.files ?? [];
  
  const [state, setState] = useState<Record<string, { decision: ReviewDecision; note: string | null }>>(() => {
    const initial: Record<string, { decision: ReviewDecision; note: string | null }> = {};
    for (const ws of workspaces) {
      for (const file of ws.files) {
        initial[`${ws.workspaceId}:${file.path}`] = { decision: "unreviewed", note: null };
      }
    }
    return initial;
  });

  const filteredFiles = useMemo(() => {
    if (filter === "all") return files;
    return files.filter((file) => {
      const key = `${workspaceKey}:${file.path}`;
      const decision = state[key]?.decision ?? "unreviewed";
      if (filter === "approved") return decision === "approved";
      if (filter === "rejected") return decision === "rejected";
      if (filter === "unreviewed") return decision === "unreviewed";
      return true;
    });
  }, [files, filter, state, workspaceKey]);
  
  const current = filteredFiles[selectedFile];
  const hunks = current?.hunks ?? [];
  const currentHunk = hunks[selectedHunk] ?? "";

  const defaultEntry = { decision: "unreviewed" as ReviewDecision, note: null as string | null };
  const fileKey = current ? `${workspaceKey}:${current.path}` : "";

  const diffLines = useMemo(() => {
    if (!currentHunk) return [];
    return currentHunk.split("\n");
  }, [currentHunk]);

  const diffWindowLines = useMemo(() => trimChangedRegions(diffLines, 2), [diffLines]);

  const globalStats = useMemo(() => {
    const values = Object.values(state);
    const approved = values.filter((v) => v.decision === "approved").length;
    const rejected = values.filter((v) => v.decision === "rejected").length;
    const unreviewed = values.length - approved - rejected;
    return { approved, rejected, unreviewed, total: values.length };
  }, [state]);

  const workspaceStats = useMemo(() => {
    const wsFiles = files;
    let additions = 0;
    let deletions = 0;
    for (const file of wsFiles) {
      for (const hunk of file.hunks) {
        const stats = parseHunkStats(hunk);
        additions += stats.additions;
        deletions += stats.deletions;
      }
    }
    return { additions, deletions };
  }, [files]);

  const progress = useMemo(() => {
    if (globalStats.total === 0) return 0;
    return Math.round(((globalStats.approved + globalStats.rejected) / globalStats.total) * 100);
  }, [globalStats]);

  const filterCounts = useMemo(() => {
    return {
      all: files.length,
      approved: files.filter((f) => state[`${workspaceKey}:${f.path}`]?.decision === "approved").length,
      rejected: files.filter((f) => state[`${workspaceKey}:${f.path}`]?.decision === "rejected").length,
      unreviewed: files.filter((f) => state[`${workspaceKey}:${f.path}`]?.decision === "unreviewed").length,
    };
  }, [files, state, workspaceKey]);

  useInput((input, key) => {
    if (noteMode) {
      if (key.return) {
        if (current && workspaceKey) {
          setState((prev) => ({
            ...prev,
            [fileKey]: {
              ...(prev[fileKey] ?? defaultEntry),
              note: noteInput.trim() || null,
            },
          }));
        }
        setNoteInput("");
        setNoteMode(false);
        return;
      }
      if (key.escape) {
        setNoteInput("");
        setNoteMode(false);
        return;
      }
      if (key.backspace || key.delete) {
        setNoteInput((prev) => prev.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setNoteInput((prev) => prev + input);
      }
      return;
    }

    if (input === REVIEW_KEYMAP.filter) {
      const filters: FilterType[] = ["all", "approved", "rejected", "unreviewed"];
      const currentIndex = filters.indexOf(filter);
      const nextIndex = (currentIndex + 1) % filters.length;
      setFilter(filters[nextIndex] ?? "all");
      setSelectedFile(0);
      return;
    }

    if (input === REVIEW_KEYMAP.approveAll) {
      for (const file of files) {
        const key = `${workspaceKey}:${file.path}`;
        setState((prev) => ({
          ...prev,
          [key]: { ...(prev[key] ?? defaultEntry), decision: "approved" },
        }));
      }
      return;
    }

    if (input === REVIEW_KEYMAP.rejectAll) {
      for (const file of files) {
        const key = `${workspaceKey}:${file.path}`;
        setState((prev) => ({
          ...prev,
          [key]: { ...(prev[key] ?? defaultEntry), decision: "rejected" },
        }));
      }
      return;
    }

    if (key.leftArrow || input === REVIEW_KEYMAP.prevTab) {
      if (workspaces.length > 1) {
        setSelectedTab((prev) => Math.max(0, prev - 1));
        setSelectedFile(0);
        setSelectedHunk(0);
        setFilter("all");
      }
      return;
    }

    if (key.rightArrow || input === REVIEW_KEYMAP.nextTab) {
      if (workspaces.length > 1) {
        setSelectedTab((prev) => Math.min(workspaces.length - 1, prev + 1));
        setSelectedFile(0);
        setSelectedHunk(0);
        setFilter("all");
      }
      return;
    }

    if (key.upArrow || input === REVIEW_KEYMAP.prevFile) {
      setSelectedFile((prev) => Math.max(0, prev - 1));
      setSelectedHunk(0);
      return;
    }

    if (key.downArrow || input === REVIEW_KEYMAP.nextFile) {
      setSelectedFile((prev) => Math.min(filteredFiles.length - 1, prev + 1));
      setSelectedHunk(0);
      return;
    }

    if (input === REVIEW_KEYMAP.quit) {
      if (!quitArmed) {
        setQuitArmed(true);
        return;
      }
      const allDecisions: ReviewTuiResult["decisions"] = [];
      for (const ws of workspaces) {
        for (const file of ws.files) {
          const key = `${ws.workspaceId}:${file.path}`;
          allDecisions.push({
            workspaceId: ws.workspaceId,
            path: file.path,
            decision: state[key]?.decision ?? "unreviewed",
            note: state[key]?.note ?? null,
          });
        }
      }
      onDone({ save: false, decisions: allDecisions });
      exit();
      return;
    }

    setQuitArmed(false);

    if (input === REVIEW_KEYMAP.nextHunk) {
      setSelectedHunk((prev) => Math.min(hunks.length - 1, prev + 1));
      return;
    }

    if (input === REVIEW_KEYMAP.prevHunk) {
      setSelectedHunk((prev) => Math.max(0, prev - 1));
      return;
    }

    if (input === REVIEW_KEYMAP.approve && current && workspaceKey) {
      setState((prev) => ({
        ...prev,
        [fileKey]: { ...(prev[fileKey] ?? defaultEntry), decision: "approved" },
      }));
      return;
    }

    if (input === REVIEW_KEYMAP.reject && current && workspaceKey) {
      setState((prev) => ({
        ...prev,
        [fileKey]: { ...(prev[fileKey] ?? defaultEntry), decision: "rejected" },
      }));
      return;
    }

    if (input === REVIEW_KEYMAP.note && current && workspaceKey) {
      setNoteMode(true);
      setNoteInput(state[fileKey]?.note ?? "");
      return;
    }

    if (input === REVIEW_KEYMAP.save) {
      const allDecisions: ReviewTuiResult["decisions"] = [];
      for (const ws of workspaces) {
        for (const file of ws.files) {
          const key = `${ws.workspaceId}:${file.path}`;
          allDecisions.push({
            workspaceId: ws.workspaceId,
            path: file.path,
            decision: state[key]?.decision ?? "unreviewed",
            note: state[key]?.note ?? null,
          });
        }
      }
      onDone({ save: true, decisions: allDecisions });
      exit();
    }
  });

  const renderProgressBar = () => {
    const filled = Math.round((progress / 100) * 20);
    const empty = 20 - filled;
    return "█".repeat(filled) + "░".repeat(empty);
  };

  return (
    <Box flexDirection="column">
      <Box borderStyle="bold" borderColor="cyan" paddingX={1}>
        <Box flexDirection="column" width={12} alignItems="center" justifyContent="center">
          <Text bold color="cyan">⬡</Text>
          <Text color="gray" bold>SNAP</Text>
        </Box>
        <Box flexDirection="column" flexGrow={1} marginLeft={2}>
          <Text bold color="white">SNAPSHOT REVIEW</Text>
          <Text color="gray">{workspaces.length} workspace(s) · {globalStats.total} files</Text>
        </Box>
        <Box flexDirection="column" alignItems="flex-end">
          <Text bold color="cyan">[{renderProgressBar()}] {progress}%</Text>
          <Text color="gray">{globalStats.approved + globalStats.rejected}/{globalStats.total} reviewed</Text>
        </Box>
      </Box>

      {workspaces.length > 1 && (
        <Box borderStyle="round" borderColor="gray" paddingX={1} paddingY={0} marginTop={1}>
          <Text color="gray">TABS: </Text>
          {workspaces.map((ws, idx) => {
            const isSelected = idx === selectedTab;
            const wsApproved = ws.files.filter((f) => state[`${ws.workspaceId}:${f.path}`]?.decision === "approved").length;
            const wsTotal = ws.files.length;
            const wsPct = wsTotal > 0 ? Math.round((wsApproved / wsTotal) * 100) : 0;
            return (
              <Box key={ws.workspaceId} marginRight={1}>
                <Text
                  bold
                  color={isSelected ? "cyan" : "gray"}
                  dimColor={!isSelected}
                >
                  {isSelected ? "▸" : ""} {ws.workspaceLabel.substring(0, 12)} ({wsPct}%)
                </Text>
              </Box>
            );
          })}
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        <Box justifyContent="space-between" alignItems="flex-end">
          <Text bold color="white">FILES ({filterCounts[filter]})</Text>
          <Box>
            {(["all", "approved", "rejected", "unreviewed"] as FilterType[]).map((f) => (
              <Text
                key={f}
                color={filter === f ? "cyan" : "gray"}
                bold={filter === f}
                dimColor={filter !== f}
              >
                {filter === f ? "[" : " "}{f.charAt(0).toUpperCase() + f.slice(1)}({filterCounts[f]}){filter === f ? "] " : "  "}
              </Text>
            ))}
          </Box>
        </Box>

        <Box flexDirection="column" height={10} borderStyle="round" borderColor="gray" marginTop={1}>
          {filteredFiles.length === 0 ? (
            <Box justifyContent="center" alignItems="center" height={10}>
              <Text color="gray">No files match filter</Text>
            </Box>
          ) : (
            filteredFiles.map((file, idx) => {
              const isSelected = idx === selectedFile;
              const key = `${workspaceKey}:${file.path}`;
              const decision = state[key]?.decision ?? "unreviewed";
              const hasNote = state[key]?.note !== null;
              const stats = file.hunks.reduce(
                (acc, h) => ({ additions: acc.additions + parseHunkStats(h).additions, deletions: acc.deletions + parseHunkStats(h).deletions }),
                { additions: 0, deletions: 0 }
              );
              const statusIcon = STATUS_ICONS[file.status] || "?";
              const statusLabel = STATUS_LABELS[file.status] || file.status;

              return (
                <Box
                  key={file.path}
                  paddingX={1}
                >
                  <Text color={isSelected ? "cyan" : decisionColor(decision)} bold>
                    {isSelected ? "▸" : " "} {decisionIcon(decision)}{" "}
                  </Text>
                  <Text color={isSelected ? "white" : "gray"} bold>
                    {file.path.substring(0, 28).padEnd(28)}
                  </Text>
                  <Text color={isSelected ? "white" : fileStatusColor(file.status)}>
                    [{statusLabel}]
                  </Text>
                  <Text color={isSelected ? "white" : "gray"}>
                    {" +" + stats.additions + " -" + stats.deletions}
                  </Text>
                  {hasNote && (
                    <Text color="magenta"> 📝</Text>
                  )}
                </Box>
              );
            })
          )}
        </Box>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Box justifyContent="space-between">
          <Text bold color="white">DIFF VIEW</Text>
          <Text color="gray">
            {current ? current.path : "No file"} · hunk {hunks.length > 0 ? selectedHunk + 1 : 0}/{hunks.length}
          </Text>
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor="gray" marginTop={1}>
          {hunks.length === 0 ? (
            <Box justifyContent="center" alignItems="center" minHeight={6}>
              <Text color="gray">No diff available</Text>
            </Box>
          ) : (
            ["", "", ...diffWindowLines, "", ""].map((line, i) => {
              const kind = classifyDiffLine(line);
              return (
                <Text key={i} color={diffColorFromKind(kind)} wrap="truncate-end">
                  {line}
                </Text>
              );
            })
          )}
        </Box>
      </Box>

      <Box marginTop={1} borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
        <Box justifyContent="space-between">
          <Box gap={3}>
            <Text><Text color="green" bold>[a]</Text>pprove</Text>
            <Text><Text color="red" bold>[r]</Text>eject</Text>
            <Text><Text color="magenta" bold>[m]</Text>note</Text>
            <Text><Text color="cyan" bold>[f]</Text>ilter</Text>
            <Text><Text color="green" bold>[A]</Text>ll approve</Text>
            <Text><Text color="red" bold>[R]</Text>all reject</Text>
          </Box>
          <Box gap={2}>
            <Text color="gray">↑↓ navigate</Text>
            {workspaces.length > 1 && <Text color="cyan">←→ tabs</Text>}
            <Text><Text color="yellow" bold>[s]</Text>ave</Text>
            <Text><Text color="red" bold>[q]</Text>uit</Text>
          </Box>
        </Box>
      </Box>

      <Box marginTop={1} justifyContent="space-between">
        <Box gap={4}>
          <Box>
            <Text color="green" bold>✓ {globalStats.approved}</Text>
            <Text color="gray"> approved</Text>
          </Box>
          <Box>
            <Text color="red" bold>✗ {globalStats.rejected}</Text>
            <Text color="gray"> rejected</Text>
          </Box>
          <Box>
            <Text color="yellow" bold>○ {globalStats.unreviewed}</Text>
            <Text color="gray"> pending</Text>
          </Box>
        </Box>
        <Box>
          <Text color="green">+{workspaceStats.additions}</Text>
          <Text color="gray"> / </Text>
          <Text color="red">-{workspaceStats.deletions}</Text>
          <Text color="gray"> lines</Text>
        </Box>
      </Box>

      {noteMode && (
        <Box marginTop={1} borderStyle="bold" borderColor="magenta" paddingX={1}>
          <Text color="magenta" bold>NOTE: </Text>
          <Text color="white">{noteInput}_</Text>
          <Text color="gray"> (Enter save, Esc cancel)</Text>
        </Box>
      )}

      {!noteMode && current && fileKey && state[fileKey]?.note && (
        <Box marginTop={1} borderStyle="round" borderColor="gray" paddingX={1}>
          <Text color="gray">Note: </Text>
          <Text color="white">{state[fileKey]?.note}</Text>
        </Box>
      )}

      {quitArmed && (
        <Box marginTop={1} borderStyle="bold" borderColor="red" paddingX={1}>
          <Text color="red" bold>⚠ Press q again to QUIT WITHOUT SAVING</Text>
        </Box>
      )}
    </Box>
  );
}
