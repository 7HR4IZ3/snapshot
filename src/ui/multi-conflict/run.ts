import { BoxRenderable, type KeyEvent } from "@opentui/core";
import {
  analyzeFileConflicts,
  countUnresolved,
  renderMergedContent,
  suggestBestResolution,
  type MultiTreeFile,
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

export interface MultiConflictItem {
  path: string;
  baseContent: string;
  workspaces: Array<{ workspaceId: string; label: string; content: string }>;
}

export interface MultiConflictResult {
  finalized: boolean;
  resolutions: Array<{
    path: string;
    action: "accept" | "manual";
    versionIndex?: number;
    content?: string;
  }>;
}

function versionColor(index: number): string {
  return [SNAPSHOT_COLORS.muted, SNAPSHOT_COLORS.accent, SNAPSHOT_COLORS.success, SNAPSHOT_COLORS.purple, SNAPSHOT_COLORS.warning][index % 5] ?? SNAPSHOT_COLORS.text;
}

function renderMulti(
  session: OpenTuiSession,
  files: MultiTreeFile[],
  fileIndex: number,
  chunkIndex: number,
  editMode: boolean,
  editText: string,
  help: boolean,
  message: string | null,
): void {
  clearChildren(session.root);
  const file = files[fileIndex];
  const { body, footer } = addShell(session.renderer, "SNAPSHOT MULTI-CONFLICT", file ? `· ${file.path}` : "· none");
  clearChildren(footer);

  if (help) {
    const panel = addPanel(body, "multi-help", { flexGrow: 1 });
    addText(panel, "MULTI-WORKSPACE SHORTCUTS", { fg: SNAPSHOT_COLORS.accent, attributes: 1 });
    addText(panel, "j/k or ↑/↓     next/previous file", { fg: SNAPSHOT_COLORS.text });
    addText(panel, "n/p             next/previous conflict chunk", { fg: SNAPSHOT_COLORS.text });
    addText(panel, "1-9             accept a version for the selected chunk", { fg: SNAPSHOT_COLORS.text });
    addText(panel, "a               accept the recommended version", { fg: SNAPSHOT_COLORS.text });
    addText(panel, "m               manually edit the selected chunk", { fg: SNAPSHOT_COLORS.text });
    addText(panel, "f               finalize after all chunks are resolved", { fg: SNAPSHOT_COLORS.text });
    addText(panel, "q               leave conflict state untouched", { fg: SNAPSHOT_COLORS.text });
    addText(footer, "? or Esc close help", { fg: SNAPSHOT_COLORS.muted, height: 1 });
    return;
  }

  const total = files.reduce((sum, row) => sum + row.chunks.length, 0);
  const resolved = files.reduce((sum, row) => sum + Object.keys(row.resolved).length, 0);
  const toolbar = addPanel(body, "multi-toolbar", { height: 3, flexDirection: "row", alignItems: "center", gap: 2 });
  addText(toolbar, `${resolved}/${total} RESOLVED`, { fg: resolved === total ? SNAPSHOT_COLORS.success : SNAPSHOT_COLORS.warning, height: 1 });
  addText(toolbar, `${files.length} files`, { fg: SNAPSHOT_COLORS.muted, height: 1 });

  const columns = new BoxRenderable(session.renderer, { id: "multi-columns", width: "100%", flexGrow: 1, flexDirection: "row", gap: 1 });
  body.add(columns);
  const filePanel = addPanel(columns, "multi-files", { width: "30%", flexShrink: 0 });
  const detailPanel = addPanel(columns, "multi-detail", { flexGrow: 1 });
  addText(filePanel, "FILES", { fg: SNAPSHOT_COLORS.accent, attributes: 1 });
  for (const [index, row] of files.entries()) {
    const unresolved = countUnresolved(row);
    addText(filePanel, `${index === fileIndex ? "›" : " "} ${unresolved === 0 ? "✓" : "!"} ${clip(row.path, 42)}`, {
      fg: index === fileIndex ? SNAPSHOT_COLORS.accent : unresolved === 0 ? SNAPSHOT_COLORS.success : SNAPSHOT_COLORS.warning,
    });
  }

  if (!file) {
    addText(detailPanel, "No conflict selected.", { fg: SNAPSHOT_COLORS.muted });
  } else if (editMode) {
    addText(detailPanel, `EDITING CHUNK ${chunkIndex + 1} · Ctrl+S save · Esc cancel`, { fg: SNAPSHOT_COLORS.warning, attributes: 1 });
    for (const line of clipLines(editText, 130, 30)) addText(detailPanel, line, { fg: SNAPSHOT_COLORS.text });
  } else {
    const chunk = file.chunks[chunkIndex];
    const recommendation = chunk ? suggestBestResolution(chunk, file.versions) : null;
    addText(detailPanel, `${file.path}  ·  chunk ${chunk ? chunk.index + 1 : 0}/${file.chunks.length}`, { fg: SNAPSHOT_COLORS.accent, attributes: 1 });
    if (recommendation) {
      addText(detailPanel, `recommended  ${file.versions[recommendation.versionIndex]?.label ?? "version"} · ${recommendation.reason || "best fit"}`, { fg: SNAPSHOT_COLORS.purple });
    }
    if (chunk) {
      for (const [index, version] of file.versions.entries()) {
        const content = chunk.versions[version.workspaceId || "base"] ?? "(empty)";
        const choice = file.resolved[chunk.index];
        const selected = choice?.type === "accept-version" && choice.versionIndex === index;
        addText(detailPanel, `${selected ? "›" : " "} ${index + 1} ${version.label}`, { fg: selected ? SNAPSHOT_COLORS.success : versionColor(index), attributes: selected ? 1 : 0 });
        for (const line of clipLines(content, 120, 5)) addText(detailPanel, `    ${line}`, { fg: selected ? SNAPSHOT_COLORS.text : SNAPSHOT_COLORS.muted });
      }
      addText(detailPanel, "PREVIEW", { fg: SNAPSHOT_COLORS.purple, attributes: 1 });
      for (const line of clipLines(renderMergedContent(file), 130, 7)) addText(detailPanel, line, { fg: SNAPSHOT_COLORS.muted });
    }
  }

  if (message) addText(footer, message, { fg: SNAPSHOT_COLORS.warning, height: 1 });
  else if (editMode) addText(footer, "Type to edit   Ctrl+S save manual resolution   Esc cancel", { fg: SNAPSHOT_COLORS.muted, height: 1 });
  else addText(footer, "1-9 version   a recommended   m manual   n/p chunks   j/k files   f finalize   q quit", { fg: SNAPSHOT_COLORS.muted, height: 1 });
}

export async function runMultiConflictTui(items: MultiConflictItem[]): Promise<MultiConflictResult> {
  const files: MultiTreeFile[] = items.map((item) => ({
    ...analyzeFileConflicts(item.path, item.baseContent, item.workspaces),
    resolved: {},
  }));

  return await withOpenTui<MultiConflictResult>(
    { title: "Snapshot Multi-Conflict", cancelValue: { finalized: false, resolutions: [] } },
    (session) => {
      let fileIndex = 0;
      let chunkIndex = 0;
      let editMode = false;
      let editText = "";
      let help = false;
      let message: string | null = null;
      const currentFile = (): MultiTreeFile | undefined => files[fileIndex];
      const render = (): void => {
        const file = currentFile();
        chunkIndex = Math.min(chunkIndex, Math.max(0, (file?.chunks.length ?? 1) - 1));
        renderMulti(session, files, fileIndex, chunkIndex, editMode, editText, help, message);
        session.renderer.requestRender();
      };
      const finish = (): void => {
        if (files.some((file) => countUnresolved(file) > 0)) {
          message = "Resolve every chunk before finalizing.";
          render();
          return;
        }
        const resolutions: MultiConflictResult["resolutions"] = [];
        for (const file of files) {
          const chunks = file.chunks;
          const first = chunks[0] ? file.resolved[chunks[0].index] : undefined;
          const sameVersion = first?.type === "accept-version" && chunks.every((chunk) => {
            const resolution = file.resolved[chunk.index];
            return resolution?.type === "accept-version" && resolution.versionIndex === first.versionIndex;
          });
          if (sameVersion && first?.type === "accept-version") {
            resolutions.push({ path: file.path, action: "accept", versionIndex: first.versionIndex });
          } else {
            resolutions.push({ path: file.path, action: "manual", content: renderMergedContent(file) });
          }
        }
        session.renderer.keyInput.off("keypress", onKey);
        session.finish({ finalized: true, resolutions });
      };
      const onKey = (key: KeyEvent): void => {
        if (editMode) {
          if (isKey(key, "escape")) {
            editMode = false;
            render();
          } else if (key.ctrl && isKey(key, "s")) {
            const file = currentFile();
            const chunk = file?.chunks[chunkIndex];
            if (file && chunk) file.resolved[chunk.index] = { type: "manual", content: editText };
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
          session.finish({ finalized: false, resolutions: [] });
          return;
        }
        if (isKey(key, "?")) {
          help = true;
          render();
          return;
        }
        if (isKey(key, "f")) {
          finish();
          return;
        }
        if (isKey(key, "a")) {
          const file = currentFile();
          const chunk = file?.chunks[chunkIndex];
          const recommendation = file && chunk ? suggestBestResolution(chunk, file.versions) : null;
          if (file && chunk && recommendation) file.resolved[chunk.index] = { type: "accept-version", versionIndex: recommendation.versionIndex };
          message = recommendation ? null : "No recommendation for this chunk.";
          render();
          return;
        }
        if (key.name && /^[1-9]$/.test(key.name)) {
          const file = currentFile();
          const chunk = file?.chunks[chunkIndex];
          const versionIndex = Number(key.name) - 1;
          if (file && chunk && file.versions[versionIndex]) {
            file.resolved[chunk.index] = { type: "accept-version", versionIndex };
            message = null;
            render();
          }
          return;
        }
        if (isKey(key, "m")) {
          const file = currentFile();
          const chunk = file?.chunks[chunkIndex];
          editText = chunk ? chunk.targetContent : "";
          editMode = true;
          message = null;
          render();
          return;
        }
        if (isKey(key, "down", "ArrowDown", "j")) {
          fileIndex = Math.min(files.length - 1, fileIndex + 1);
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
          const file = currentFile();
          chunkIndex = Math.min((file?.chunks.length ?? 1) - 1, chunkIndex + 1);
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
