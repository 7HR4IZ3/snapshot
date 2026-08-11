import { BoxRenderable, type KeyEvent } from "@opentui/core";
import {
  countUnresolved,
  parseConflictText,
  renderMergedPreview,
  type ChunkChoice,
  type ParsedConflictText,
} from "./model.js";
import {
  addPanel,
  addShell,
  addText,
  clearChildren,
  clip,
  clipLines,
  isCancelKey,
  isKey,
  withOpenTui,
  type OpenTuiSession,
} from "../opentui/runtime.js";
import { SNAPSHOT_COLORS } from "../opentui/theme.js";

export interface ConflictItem {
  path: string;
  className: string;
  guidance: string;
  targetText: string;
  workspaceText: string;
  conflictedText: string;
}

export type ConflictDecisionAction = "keep-target" | "keep-workspace" | "manual-merge" | "skip";

export interface ConflictUiDecision {
  path: string;
  action: ConflictDecisionAction;
  mergedText?: string;
}

export interface ConflictUiResult {
  finalized: boolean;
  decisions: ConflictUiDecision[];
}

type ChoiceMap = Record<number, ChunkChoice>;

function mergedWithManual(parsed: ParsedConflictText, choices: ChoiceMap, manual: Record<number, string>): string {
  let output = renderMergedPreview(parsed, choices);
  for (const [rawIndex, value] of Object.entries(manual)) {
    const chunk = parsed.chunks[Number(rawIndex)];
    if (!chunk) continue;
    const marker = `<<<<<<< TARGET\n${chunk.target}=======\n${chunk.workspace}>>>>>>> WORKSPACE\n`;
    output = output.replace(marker, value.endsWith("\n") ? value : `${value}\n`);
  }
  return output;
}

function isFullyResolved(parsed: ParsedConflictText, choices: ChoiceMap, manual: Record<number, string>): boolean {
  return countUnresolved(parsed, choices) - Object.keys(manual).length <= 0;
}

function renderConflict(
  session: OpenTuiSession,
  items: ConflictItem[],
  parsedRows: Array<{ item: ConflictItem; parsed: ParsedConflictText }>,
  fileIndex: number,
  chunkIndex: number,
  choicesByPath: Record<string, ChoiceMap>,
  manualByPath: Record<string, Record<number, string>>,
  editMode: boolean,
  editText: string,
  help: boolean,
  message: string | null,
): void {
  clearChildren(session.root);
  const current = parsedRows[fileIndex];
  const parsed = current?.parsed;
  const item = current?.item;
  const { body, footer } = addShell(session.renderer, "SNAPSHOT CONFLICTS", item ? `· ${item.path}` : "· none");
  clearChildren(footer);

  if (help) {
    const panel = addPanel(body, "conflict-help", { flexGrow: 1 });
    addText(panel, "CONFLICT SHORTCUTS", { fg: SNAPSHOT_COLORS.accent, attributes: 1 });
    addText(panel, "j/k or ↑/↓     next/previous file", { fg: SNAPSHOT_COLORS.text });
    addText(panel, "n/p             next/previous conflict chunk", { fg: SNAPSHOT_COLORS.text });
    addText(panel, "1               keep target for selected chunk", { fg: SNAPSHOT_COLORS.text });
    addText(panel, "2               keep workspace for selected chunk", { fg: SNAPSHOT_COLORS.text });
    addText(panel, "m               manually edit selected chunk", { fg: SNAPSHOT_COLORS.text });
    addText(panel, "f               finalize when every chunk is resolved", { fg: SNAPSHOT_COLORS.text });
    addText(panel, "q               leave conflict state untouched", { fg: SNAPSHOT_COLORS.text });
    addText(footer, "? or Esc close help", { fg: SNAPSHOT_COLORS.muted, height: 1 });
    return;
  }

  const total = parsedRows.reduce((sum, row) => sum + row.parsed.chunks.length, 0);
  const unresolved = parsedRows.reduce((sum, row) => sum + countUnresolved(row.parsed, choicesByPath[row.item.path] ?? {}) - Object.keys(manualByPath[row.item.path] ?? {}).length, 0);
  const progress = total === 0 ? 100 : Math.round(((total - Math.max(0, unresolved)) / total) * 100);
  const toolbar = addPanel(body, "conflict-toolbar", { height: 3, flexDirection: "row", alignItems: "center", gap: 2 });
  addText(toolbar, `${Math.max(0, total - unresolved)}/${total} RESOLVED`, { fg: unresolved === 0 ? SNAPSHOT_COLORS.success : SNAPSHOT_COLORS.warning, height: 1 });
  addText(toolbar, `${progress}%`, { fg: SNAPSHOT_COLORS.accent, height: 1 });
  addText(toolbar, `${items.length} files`, { fg: SNAPSHOT_COLORS.muted, height: 1 });

  const columns = new BoxRenderable(session.renderer, { id: "conflict-columns", width: "100%", flexGrow: 1, flexDirection: "row", gap: 1 });
  body.add(columns);
  const filePanel = addPanel(columns, "conflict-files", { width: "32%", flexShrink: 0 });
  const detailPanel = addPanel(columns, "conflict-detail", { flexGrow: 1 });
  addText(filePanel, "FILES", { fg: SNAPSHOT_COLORS.accent, attributes: 1 });
  for (const [index, row] of parsedRows.entries()) {
    const rowUnresolved = countUnresolved(row.parsed, choicesByPath[row.item.path] ?? {}) - Object.keys(manualByPath[row.item.path] ?? {}).length;
    addText(filePanel, `${index === fileIndex ? "›" : " "} ${rowUnresolved === 0 ? "✓" : "!"} ${clip(row.item.path, 42)}`, {
      fg: index === fileIndex ? SNAPSHOT_COLORS.accent : rowUnresolved === 0 ? SNAPSHOT_COLORS.success : SNAPSHOT_COLORS.warning,
    });
  }

  if (!item || !parsed) {
    addText(detailPanel, "No conflict selected.", { fg: SNAPSHOT_COLORS.muted });
  } else if (editMode) {
    addText(detailPanel, `EDITING CHUNK ${Math.min(chunkIndex + 1, parsed.chunks.length)} · Ctrl+S save · Esc cancel`, {
      fg: SNAPSHOT_COLORS.warning,
      attributes: 1,
    });
    for (const line of clipLines(editText, 130, 28)) addText(detailPanel, line, { fg: SNAPSHOT_COLORS.text });
  } else {
    const choices = choicesByPath[item.path] ?? {};
    const manual = manualByPath[item.path] ?? {};
    const chunk = parsed.chunks[Math.min(chunkIndex, Math.max(0, parsed.chunks.length - 1))];
    addText(detailPanel, `${item.path}  ·  ${item.className}`, { fg: SNAPSHOT_COLORS.accent, attributes: 1 });
    addText(detailPanel, clip(item.guidance, 130), { fg: SNAPSHOT_COLORS.muted });
    addText(detailPanel, `chunk ${chunk ? chunk.index + 1 : 0}/${parsed.chunks.length}  ·  ${manual[chunk?.index ?? -1] !== undefined ? "manual" : choices[chunk?.index ?? -1] ?? "unresolved"}`, {
      fg: manual[chunk?.index ?? -1] !== undefined ? SNAPSHOT_COLORS.purple : choices[chunk?.index ?? -1] === "unresolved" ? SNAPSHOT_COLORS.warning : SNAPSHOT_COLORS.success,
    });
    if (chunk) {
      addText(detailPanel, "TARGET", { fg: SNAPSHOT_COLORS.success, attributes: 1 });
      for (const line of clipLines(chunk.target || "(empty)", 66, 8)) addText(detailPanel, `  ${line}`, { fg: SNAPSHOT_COLORS.text });
      addText(detailPanel, "WORKSPACE", { fg: SNAPSHOT_COLORS.accent, attributes: 1 });
      for (const line of clipLines(chunk.workspace || "(empty)", 66, 8)) addText(detailPanel, `  ${line}`, { fg: SNAPSHOT_COLORS.text });
      addText(detailPanel, "PREVIEW", { fg: SNAPSHOT_COLORS.purple, attributes: 1 });
      const preview = mergedWithManual(parsed, choices, manual);
      for (const line of clipLines(preview, 130, 8)) addText(detailPanel, line, { fg: SNAPSHOT_COLORS.muted });
    }
  }

  if (message) addText(footer, message, { fg: SNAPSHOT_COLORS.warning, height: 1 });
  else if (editMode) addText(footer, "Type to replace/add text   Ctrl+S save manual chunk   Esc cancel", { fg: SNAPSHOT_COLORS.muted, height: 1 });
  else addText(footer, "1 target   2 workspace   m manual   n/p chunks   j/k files   f finalize   q quit", { fg: SNAPSHOT_COLORS.muted, height: 1 });
}

export async function runConflictTui(items: ConflictItem[]): Promise<ConflictUiResult> {
  const parsedRows = items.map((item) => ({ item, parsed: parseConflictText(item.conflictedText) }));
  const choicesByPath: Record<string, ChoiceMap> = {};
  const manualByPath: Record<string, Record<number, string>> = {};
  for (const row of parsedRows) {
    choicesByPath[row.item.path] = Object.fromEntries(row.parsed.chunks.map((chunk) => [chunk.index, "unresolved"]));
    manualByPath[row.item.path] = {};
  }

  return await withOpenTui<ConflictUiResult>(
    { title: "Snapshot Conflicts", cancelValue: { finalized: false, decisions: [] } },
    (session) => {
      let fileIndex = 0;
      let chunkIndex = 0;
      let editMode = false;
      let editText = "";
      let help = false;
      let message: string | null = null;
      const currentRow = (): { item: ConflictItem; parsed: ParsedConflictText } | undefined => parsedRows[fileIndex];
      const currentChunk = (): number | undefined => currentRow()?.parsed.chunks[chunkIndex]?.index;
      const render = (): void => {
        const row = currentRow();
        chunkIndex = Math.min(chunkIndex, Math.max(0, (row?.parsed.chunks.length ?? 1) - 1));
        renderConflict(session, items, parsedRows, fileIndex, chunkIndex, choicesByPath, manualByPath, editMode, editText, help, message);
        session.renderer.requestRender();
      };
      const finalize = (): void => {
        const unresolved = parsedRows.some((row) => !isFullyResolved(row.parsed, choicesByPath[row.item.path] ?? {}, manualByPath[row.item.path] ?? {}));
        if (unresolved) {
          message = "Resolve every chunk before finalizing.";
          render();
          return;
        }
        const decisions: ConflictUiDecision[] = [];
        for (const row of parsedRows) {
          const choices = choicesByPath[row.item.path] ?? {};
          const manual = manualByPath[row.item.path] ?? {};
          const chunkChoices = row.parsed.chunks.map((chunk) => choices[chunk.index]);
          if (chunkChoices.length > 0 && chunkChoices.every((choice) => choice === "target")) {
            decisions.push({ path: row.item.path, action: "keep-target" });
          } else if (chunkChoices.length > 0 && chunkChoices.every((choice) => choice === "workspace")) {
            decisions.push({ path: row.item.path, action: "keep-workspace" });
          } else {
            decisions.push({ path: row.item.path, action: "manual-merge", mergedText: mergedWithManual(row.parsed, choices, manual) });
          }
        }
        session.renderer.keyInput.off("keypress", onKey);
        session.finish({ finalized: true, decisions });
      };
      const onKey = (key: KeyEvent): void => {
        if (editMode) {
          if (isKey(key, "escape")) {
            editMode = false;
            render();
          } else if (key.ctrl && isKey(key, "s")) {
            const row = currentRow();
            const index = currentChunk();
            if (row && index !== undefined) {
              manualByPath[row.item.path] = { ...(manualByPath[row.item.path] ?? {}), [index]: editText };
            }
            editMode = false;
            message = "Manual resolution saved.";
            render();
          } else if (isKey(key, "backspace", "delete")) {
            editText = editText.slice(0, -1);
            render();
          } else if (!key.ctrl && key.sequence) {
            editText += isKey(key, "return", "enter") ? "\n" : key.sequence;
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
        if (isCancelKey(key) || isKey(key, "q")) {
          session.renderer.keyInput.off("keypress", onKey);
          session.finish({ finalized: false, decisions: [] });
          return;
        }
        if (isKey(key, "?")) {
          help = true;
          render();
          return;
        }
        if (isKey(key, "f")) {
          finalize();
          return;
        }
        if (isKey(key, "1", "2")) {
          const row = currentRow();
          const index = currentChunk();
          if (row && index !== undefined) {
            choicesByPath[row.item.path] = { ...(choicesByPath[row.item.path] ?? {}), [index]: isKey(key, "1") ? "target" : "workspace" };
            const manual = manualByPath[row.item.path];
            if (manual) delete manual[index];
            message = null;
            render();
          }
          return;
        }
        if (isKey(key, "m")) {
          const row = currentRow();
          const index = currentChunk();
          const chunk = row?.parsed.chunks.find((candidate) => candidate.index === index);
          editText = (row && index !== undefined ? manualByPath[row.item.path]?.[index] : undefined) ?? chunk?.target ?? "";
          editMode = true;
          message = null;
          render();
          return;
        }
        if (isKey(key, "down", "ArrowDown", "j")) {
          fileIndex = Math.min(items.length - 1, fileIndex + 1);
          chunkIndex = 0;
          message = null;
          render();
          return;
        }
        if (isKey(key, "up", "ArrowUp", "k")) {
          fileIndex = Math.max(0, fileIndex - 1);
          chunkIndex = 0;
          message = null;
          render();
          return;
        }
        if (isKey(key, "n", "right", "ArrowRight")) {
          const row = currentRow();
          chunkIndex = Math.min((row?.parsed.chunks.length ?? 1) - 1, chunkIndex + 1);
          message = null;
          render();
          return;
        }
        if (isKey(key, "p", "left", "ArrowLeft")) {
          chunkIndex = Math.max(0, chunkIndex - 1);
          message = null;
          render();
        }
      };

      session.renderer.keyInput.on("keypress", onKey);
      render();
    },
  );
}
