import { BoxRenderable, type KeyEvent } from "@opentui/core";
import type { ReviewDecision } from "../../core/domain/review.js";
import {
  addPanel,
  addShell,
  addText,
  clearChildren,
  clip,
  isCancelKey,
  isKey,
  withOpenTui,
  type OpenTuiSession,
} from "../opentui/runtime.js";
import { SNAPSHOT_COLORS } from "../opentui/theme.js";

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

type FilterType = "all" | "approved" | "rejected" | "unreviewed";
type FileDecision = { decision: ReviewDecision; note: string | null };

function decisionColor(decision: ReviewDecision): string {
  if (decision === "approved") return SNAPSHOT_COLORS.success;
  if (decision === "rejected") return SNAPSHOT_COLORS.danger;
  return SNAPSHOT_COLORS.warning;
}

function decisionBadge(decision: ReviewDecision): string {
  if (decision === "approved") return "APPROVED";
  if (decision === "rejected") return "REJECTED";
  return "PENDING";
}

function statusIcon(status: string): string {
  if (status.startsWith("A")) return "+";
  if (status.startsWith("D")) return "-";
  if (status.startsWith("M")) return "~";
  if (status.startsWith("R")) return "→";
  return "·";
}

function fileKey(workspaceId: string, path: string): string {
  return `${workspaceId}:${path}`;
}

function visibleFiles(
  workspace: ReviewTuiWorkspace | undefined,
  decisions: Map<string, FileDecision>,
  filter: FilterType,
): ReviewTuiFile[] {
  if (!workspace) return [];
  return workspace.files.filter((file) => {
    const decision = decisions.get(fileKey(workspace.workspaceId, file.path))?.decision ?? "unreviewed";
    return filter === "all" || decision === filter;
  });
}

function renderReview(
  session: OpenTuiSession,
  workspaces: ReviewTuiWorkspace[],
  workspaceIndex: number,
  fileIndex: number,
  hunkIndex: number,
  filter: FilterType,
  decisions: Map<string, FileDecision>,
  noteMode: boolean,
  noteInput: string,
  help: boolean,
): void {
  clearChildren(session.root);
  const workspace = workspaces[workspaceIndex];
  const { body, footer } = addShell(session.renderer, "SNAPSHOT REVIEW", workspace ? `· ${workspace.workspaceLabel}` : "· no workspace");
  clearChildren(footer);

  if (help) {
    const panel = addPanel(body, "review-help", { flexGrow: 1 });
    addText(panel, "REVIEW SHORTCUTS", { fg: SNAPSHOT_COLORS.accent, attributes: 1 });
    addText(panel, "j/k or ↑/↓     move through files", { fg: SNAPSHOT_COLORS.text });
    addText(panel, "n/p             move through hunks", { fg: SNAPSHOT_COLORS.text });
    addText(panel, "h/l or ←/→     switch workspace", { fg: SNAPSHOT_COLORS.text });
    addText(panel, "a / r           approve or reject selected file", { fg: SNAPSHOT_COLORS.text });
    addText(panel, "A / R           approve or reject every visible file", { fg: SNAPSHOT_COLORS.text });
    addText(panel, "m               add a note", { fg: SNAPSHOT_COLORS.text });
    addText(panel, "f               cycle file filter", { fg: SNAPSHOT_COLORS.text });
    addText(panel, "s               save review   q cancel", { fg: SNAPSHOT_COLORS.text });
    addText(footer, "? or Esc close help", { fg: SNAPSHOT_COLORS.muted, height: 1 });
    return;
  }

  const summary = workspaces.flatMap((row) => row.files).reduce(
    (acc, file) => {
      const decision = decisions.get(fileKey(workspaces.find((row) => row.files.includes(file))?.workspaceId ?? "", file.path))?.decision;
      if (decision === "approved") acc.approved += 1;
      else if (decision === "rejected") acc.rejected += 1;
      else acc.pending += 1;
      return acc;
    },
    { approved: 0, rejected: 0, pending: 0 },
  );
  const toolbar = addPanel(body, "review-toolbar", { height: 3, flexDirection: "row", alignItems: "center", gap: 2 });
  addText(toolbar, `FILTER ${filter.toUpperCase()}`, { fg: SNAPSHOT_COLORS.accent, height: 1 });
  addText(toolbar, `✓ ${summary.approved}`, { fg: SNAPSHOT_COLORS.success, height: 1 });
  addText(toolbar, `✗ ${summary.rejected}`, { fg: SNAPSHOT_COLORS.danger, height: 1 });
  addText(toolbar, `○ ${summary.pending}`, { fg: SNAPSHOT_COLORS.warning, height: 1 });

  const columns = new BoxRenderable(session.renderer, {
    id: "review-columns",
    width: "100%",
    flexGrow: 1,
    flexDirection: "row",
    gap: 1,
  });
  body.add(columns);
  const filePanel = addPanel(columns, "review-files", { width: "36%", flexShrink: 0 });
  const diffPanel = addPanel(columns, "review-diff", { flexGrow: 1 });
  addText(filePanel, `FILES  ${workspace?.files.length ?? 0}`, { fg: SNAPSHOT_COLORS.accent, attributes: 1 });

  const files = visibleFiles(workspace, decisions, filter);
  const currentFile = files[Math.min(fileIndex, Math.max(0, files.length - 1))];
  const fileStart = Math.max(0, Math.min(fileIndex - 8, files.length - 16));
  for (const [offset, file] of files.slice(fileStart, fileStart + 16).entries()) {
    const index = fileStart + offset;
    const decision = decisions.get(fileKey(workspace?.workspaceId ?? "", file.path))?.decision ?? "unreviewed";
    const marker = index === fileIndex ? "›" : " ";
    addText(filePanel, clip(`${marker} ${statusIcon(file.status)} ${file.path}`, 72), {
      fg: index === fileIndex ? SNAPSHOT_COLORS.accent : decisionColor(decision),
    });
    if (index === fileIndex) {
      addText(filePanel, `  ${decisionBadge(decision)}`, { fg: decisionColor(decision), height: 1 });
    }
  }
  if (files.length === 0) addText(filePanel, "No files match this filter.", { fg: SNAPSHOT_COLORS.muted });

  if (!currentFile) {
    addText(diffPanel, "No file selected.", { fg: SNAPSHOT_COLORS.muted });
  } else {
    const decision = decisions.get(fileKey(workspace?.workspaceId ?? "", currentFile.path)) ?? { decision: "unreviewed" as const, note: null };
    addText(diffPanel, `${currentFile.path}  ·  ${decisionBadge(decision.decision)}`, {
      fg: decisionColor(decision.decision),
      attributes: 1,
    });
    const hunk = currentFile.hunks[Math.min(hunkIndex, Math.max(0, currentFile.hunks.length - 1))] ?? "No hunks available.";
    for (const line of hunk.split("\n").slice(0, 28)) {
      const color = line.startsWith("+") && !line.startsWith("+++")
        ? SNAPSHOT_COLORS.success
        : line.startsWith("-") && !line.startsWith("---")
          ? SNAPSHOT_COLORS.danger
          : line.startsWith("@@") ? SNAPSHOT_COLORS.purple : SNAPSHOT_COLORS.text;
      addText(diffPanel, clip(line, 140), { fg: color });
    }
    if (decision.note) {
      addText(diffPanel, `note: ${clip(decision.note, 130)}`, { fg: SNAPSHOT_COLORS.warning });
    }
  }

  if (noteMode) {
    addText(footer, `NOTE  ${noteInput}▌  Enter save · Esc cancel`, { fg: SNAPSHOT_COLORS.warning, height: 1 });
  } else {
    addText(footer, "j/k files   n/p hunks   a approve   r reject   m note   f filter   s save   q cancel", {
      fg: SNAPSHOT_COLORS.muted,
      height: 1,
    });
  }
}

function nextFilter(filter: FilterType): FilterType {
  return filter === "all" ? "approved" : filter === "approved" ? "rejected" : filter === "rejected" ? "unreviewed" : "all";
}

export async function runReviewTui(workspaces: ReviewTuiWorkspace[]): Promise<ReviewTuiResult> {
  const initialDecisions = new Map<string, FileDecision>();
  for (const workspace of workspaces) {
    for (const file of workspace.files) {
      initialDecisions.set(fileKey(workspace.workspaceId, file.path), { decision: "unreviewed", note: null });
    }
  }

  return await withOpenTui<ReviewTuiResult>(
    { title: "Snapshot Review", cancelValue: { save: false, decisions: [] } },
    (session) => {
      let workspaceIndex = 0;
      let fileIndex = 0;
      let hunkIndex = 0;
      let filter: FilterType = "all";
      let decisions = new Map(initialDecisions);
      let noteMode = false;
      let noteInput = "";
      let help = false;

      const currentFiles = (): ReviewTuiFile[] => visibleFiles(workspaces[workspaceIndex], decisions, filter);
      const normalize = (): void => {
        const files = currentFiles();
        fileIndex = Math.min(fileIndex, Math.max(0, files.length - 1));
        const current = files[fileIndex];
        hunkIndex = Math.min(hunkIndex, Math.max(0, (current?.hunks.length ?? 1) - 1));
      };
      const render = (): void => {
        normalize();
        renderReview(session, workspaces, workspaceIndex, fileIndex, hunkIndex, filter, decisions, noteMode, noteInput, help);
        session.renderer.requestRender();
      };
      const finish = (save: boolean): void => {
        const result: ReviewTuiResult = {
          save,
          decisions: [...decisions.entries()].map(([key, value]) => {
            const separator = key.indexOf(":");
            return { workspaceId: key.slice(0, separator), path: key.slice(separator + 1), decision: value.decision, note: value.note };
          }),
        };
        session.renderer.keyInput.off("keypress", onKey);
        session.finish(result);
      };
      const updateDecision = (decision: ReviewDecision): void => {
        const file = currentFiles()[fileIndex];
        const workspace = workspaces[workspaceIndex];
        if (!file || !workspace) return;
        const key = fileKey(workspace.workspaceId, file.path);
        const previous = decisions.get(key) ?? { decision: "unreviewed" as const, note: null };
        decisions = new Map(decisions).set(key, { ...previous, decision });
        render();
      };
      const updateAll = (decision: ReviewDecision): void => {
        const workspace = workspaces[workspaceIndex];
        if (!workspace) return;
        const next = new Map(decisions);
        for (const file of currentFiles()) {
          const key = fileKey(workspace.workspaceId, file.path);
          next.set(key, { ...(next.get(key) ?? { note: null }), decision });
        }
        decisions = next;
        render();
      };
      const onKey = (key: KeyEvent): void => {
        if (noteMode) {
          if (isKey(key, "escape")) {
            noteMode = false;
            noteInput = "";
            render();
          } else if (isKey(key, "return", "enter")) {
            const file = currentFiles()[fileIndex];
            const workspace = workspaces[workspaceIndex];
            if (file && workspace) {
              const id = fileKey(workspace.workspaceId, file.path);
              const previous = decisions.get(id) ?? { decision: "unreviewed" as const, note: null };
              decisions = new Map(decisions).set(id, { ...previous, note: noteInput.trim() || null });
            }
            noteMode = false;
            noteInput = "";
            render();
          } else if (isKey(key, "backspace", "delete")) {
            noteInput = noteInput.slice(0, -1);
            render();
          } else if (!key.ctrl && key.sequence && key.sequence.length === 1) {
            noteInput += key.sequence;
            render();
          }
          return;
        }
        if (help) {
          if (isCancelKey(key) || isKey(key, "?")) {
            help = false;
            render();
          }
          return;
        }
        if (isCancelKey(key)) {
          finish(false);
          return;
        }
        if (isKey(key, "?")) {
          help = true;
          render();
          return;
        }
        if (isKey(key, "q")) {
          finish(false);
          return;
        }
        if (key.ctrl && isKey(key, "s") || isKey(key, "s")) {
          finish(true);
          return;
        }
        if (isKey(key, "a") && key.shift) {
          updateAll("approved");
          return;
        }
        if (isKey(key, "r") && key.shift) {
          updateAll("rejected");
          return;
        }
        if (isKey(key, "a")) {
          updateDecision("approved");
          return;
        }
        if (isKey(key, "r")) {
          updateDecision("rejected");
          return;
        }
        if (isKey(key, "m")) {
          noteMode = true;
          noteInput = "";
          render();
          return;
        }
        if (isKey(key, "f")) {
          filter = nextFilter(filter);
          fileIndex = 0;
          render();
          return;
        }
        if (isKey(key, "right", "ArrowRight", "l", "tab")) {
          workspaceIndex = Math.min(workspaces.length - 1, workspaceIndex + 1);
          fileIndex = 0;
          hunkIndex = 0;
          render();
          return;
        }
        if (isKey(key, "left", "ArrowLeft", "h")) {
          workspaceIndex = Math.max(0, workspaceIndex - 1);
          fileIndex = 0;
          hunkIndex = 0;
          render();
          return;
        }
        if (isKey(key, "down", "ArrowDown", "j")) {
          fileIndex += 1;
          hunkIndex = 0;
          render();
          return;
        }
        if (isKey(key, "up", "ArrowUp", "k")) {
          fileIndex = Math.max(0, fileIndex - 1);
          hunkIndex = 0;
          render();
          return;
        }
        if (isKey(key, "n")) {
          hunkIndex += 1;
          render();
          return;
        }
        if (isKey(key, "p")) {
          hunkIndex = Math.max(0, hunkIndex - 1);
          render();
        }
      };

      session.renderer.keyInput.on("keypress", onKey);
      render();
    },
  );
}
