import React, { useMemo, useState, type JSX } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { ReviewDecision } from "../../core/domain/review.js";
import { REVIEW_KEYMAP } from "./keymap.js";
import { createInitialReviewState } from "./state.js";

export interface ReviewTuiFile {
  path: string;
  status: string;
  hunks: string[];
}

export interface ReviewTuiResult {
  save: boolean;
  decisions: Array<{ path: string; decision: ReviewDecision; note: string | null }>;
}

interface ReviewAppProps {
  files: ReviewTuiFile[];
  onDone: (result: ReviewTuiResult) => void;
}

function decisionBadge(decision: ReviewDecision): string {
  switch (decision) {
    case "approved":
      return "APPROVED";
    case "rejected":
      return "REJECTED";
    default:
      return "UNREVIEWED";
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

function fileStatusColor(status: string): "green" | "red" | "yellow" | "cyan" | "gray" {
  if (status.startsWith("A")) return "green";
  if (status.startsWith("D")) return "red";
  if (status.startsWith("M")) return "yellow";
  if (status.startsWith("R")) return "cyan";
  return "gray";
}

export function ReviewApp({ files, onDone }: ReviewAppProps): React.JSX.Element {
  const { exit } = useApp();
  const [selectedFile, setSelectedFile] = useState(0);
  const [selectedHunk, setSelectedHunk] = useState(0);
  const [focus, setFocus] = useState<"files" | "diff">("files");
  const [noteMode, setNoteMode] = useState(false);
  const [noteInput, setNoteInput] = useState("");
  const [quitArmed, setQuitArmed] = useState(false);
  const [state, setState] = useState<Record<string, { decision: ReviewDecision; note: string | null }>>(() =>
    createInitialReviewState(files.map((file) => file.path)),
  );

  const defaultEntry = { decision: "unreviewed" as ReviewDecision, note: null as string | null };

  const current = files[selectedFile];
  const hunks = current?.hunks ?? [];
  const currentHunk = hunks[selectedHunk] ?? "No hunk selected.";

  const statusLine = useMemo(() => {
    const values: Array<{ decision: ReviewDecision; note: string | null }> = Object.values(state);
    const approved = values.filter((item) => item.decision === "approved").length;
    const rejected = values.filter((item) => item.decision === "rejected").length;
    const unreviewed = values.length - approved - rejected;
    return { approved, rejected, unreviewed, total: values.length };
  }, [state]);

  useInput((input, key) => {
    if (noteMode) {
      if (key.return) {
        if (current) {
          setState((prev) => ({
            ...prev,
            [current.path]: {
              ...(prev[current.path] ?? defaultEntry),
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
        setNoteInput((prev: string) => prev.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setNoteInput((prev: string) => prev + input);
      }
      return;
    }

    if (key.tab) {
      setFocus((prev) => (prev === "files" ? "diff" : "files"));
      return;
    }

    if (input === REVIEW_KEYMAP.quit) {
      if (!quitArmed) {
        setQuitArmed(true);
        return;
      }
      onDone({
        save: false,
        decisions: files.map((file) => ({
          path: file.path,
          decision: state[file.path]?.decision ?? "unreviewed",
          note: state[file.path]?.note ?? null,
        })),
      });
      exit();
      return;
    }

    setQuitArmed(false);

    if (input === REVIEW_KEYMAP.nextFile) {
      setSelectedFile((prev: number) => Math.min(files.length - 1, prev + 1));
      setSelectedHunk(0);
      return;
    }

    if (input === REVIEW_KEYMAP.prevFile) {
      setSelectedFile((prev: number) => Math.max(0, prev - 1));
      setSelectedHunk(0);
      return;
    }

    if (input === REVIEW_KEYMAP.nextHunk) {
      setSelectedHunk((prev: number) => Math.min(hunks.length - 1, prev + 1));
      return;
    }

    if (input === REVIEW_KEYMAP.prevHunk) {
      setSelectedHunk((prev: number) => Math.max(0, prev - 1));
      return;
    }

    if (input === REVIEW_KEYMAP.approve && current) {
      setState((prev) => ({
        ...prev,
        [current.path]: {
          ...(prev[current.path] ?? defaultEntry),
          decision: "approved",
        },
      }));
      return;
    }

    if (input === REVIEW_KEYMAP.reject && current) {
      setState((prev) => ({
        ...prev,
        [current.path]: {
          ...(prev[current.path] ?? defaultEntry),
          decision: "rejected",
        },
      }));
      return;
    }

    if (input === REVIEW_KEYMAP.note) {
      setNoteMode(true);
      setNoteInput(current ? state[current.path]?.note ?? "" : "");
      return;
    }

    if (input === REVIEW_KEYMAP.save) {
      onDone({
        save: true,
        decisions: files.map((file) => ({
          path: file.path,
          decision: state[file.path]?.decision ?? "unreviewed",
          note: state[file.path]?.note ?? null,
        })),
      });
      exit();
    }
  });

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Text bold color="cyanBright">
          Snapshot Review
        </Text>
        <Text color="gray">focus: {focus}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="green">approved {statusLine.approved}</Text>
        <Text color="red">  rejected {statusLine.rejected}</Text>
        <Text color="yellow">  unreviewed {statusLine.unreviewed}</Text>
        <Text color="gray">  total {statusLine.total}</Text>
      </Box>
      <Box marginTop={1}>
        <Box flexDirection="column" width="45%" borderStyle="round" borderColor={focus === "files" ? "cyan" : "gray"}>
          <Text bold color={focus === "files" ? "cyan" : "gray"}>
            Files
          </Text>
          {files.map((file, index): JSX.Element => {
            const selected = index === selectedFile;
            const decision = state[file.path]?.decision ?? "unreviewed";
            return (
              <Box key={file.path}>
                <Text color={selected ? "cyanBright" : "gray"}>{selected ? ">" : " "} </Text>
                <Text color={fileStatusColor(file.status)}>{file.status.padEnd(2, " ")}</Text>
                <Text color={selected ? "white" : "gray"}> {file.path} </Text>
                <Text color={decisionColor(decision)}>[{decisionBadge(decision)}]</Text>
              </Box>
            );
          })}
        </Box>
        <Box flexDirection="column" width="55%" borderStyle="round" borderColor={focus === "diff" ? "cyan" : "gray"}>
          <Text bold color={focus === "diff" ? "cyan" : "gray"}>
            Diff
          </Text>
          <Text color="gray">
            file {selectedFile + 1}/{Math.max(files.length, 1)} hunk {Math.min(selectedHunk + 1, Math.max(hunks.length, 1))}/
            {Math.max(hunks.length, 1)}
          </Text>
          {hunks.length === 0 ? (
            <Text color="yellow">No hunks for this file.</Text>
          ) : (
            <Text wrap="truncate-end">{currentHunk}</Text>
          )}
        </Box>
      </Box>
      {noteMode ? (
        <Text color="yellow">Note: {noteInput || "(empty)"} (enter save, esc cancel)</Text>
      ) : (
        <Text color="gray">Press m to add/edit a note for the selected file.</Text>
      )}
      {quitArmed ? <Text color="red">Press q again to quit without saving.</Text> : null}
      <Text color="gray">j/k file  n/p hunk  tab switch panel  a approve  r reject  m note  s save  q quit</Text>
    </Box>
  );
}
