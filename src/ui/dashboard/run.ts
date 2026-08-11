import { BoxRenderable, type KeyEvent } from "@opentui/core";
import type { BackendInspection } from "../../core/services/backend-service.js";
import type { MergeSessionRecord } from "../../core/domain/merge.js";
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

export interface SnapshotTuiWorkspace {
  workspaceId: string;
  workspacePath: string;
  workspaceBranch: string;
  backend: string;
  status: string;
  createdAt: string;
  agentId: string | null;
  label: string | null;
  changedFiles: number;
}

export interface SnapshotTuiData {
  projectPath: string;
  branch: string;
  inspection: BackendInspection;
  workspaces: SnapshotTuiWorkspace[];
  mergeSessions: MergeSessionRecord[];
}

export type SnapshotTuiLoader = () => SnapshotTuiData | Promise<SnapshotTuiData>;

type DashboardTab = "overview" | "workspaces" | "merges" | "health";

function formatTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function statusColor(status: string): string {
  if (["active", "merged", "available"].includes(status)) return SNAPSHOT_COLORS.success;
  if (["archived", "unavailable", "conflict"].includes(status)) return SNAPSHOT_COLORS.warning;
  if (["failed", "dirty"].includes(status)) return SNAPSHOT_COLORS.danger;
  return SNAPSHOT_COLORS.muted;
}

function renderDashboard(
  session: OpenTuiSession,
  tab: DashboardTab,
  data: SnapshotTuiData | null,
  loading: boolean,
  error: string | null,
  selected: number,
  help: boolean,
): void {
  const { body, footer } = addShell(session.renderer, "SNAPSHOT TUI", data ? `· ${data.branch || "detached"}` : "· loading");
  clearChildren(body);
  clearChildren(footer);

  if (loading && !data) {
    addText(body, "Loading project state…", { fg: SNAPSHOT_COLORS.accent, height: 2 });
    addText(footer, "r refresh   q quit", { fg: SNAPSHOT_COLORS.muted, height: 1 });
    return;
  }

  if (error && !data) {
    const panel = addPanel(body, "dashboard-error", { borderColor: SNAPSHOT_COLORS.danger });
    addText(panel, "Unable to load project state", { fg: SNAPSHOT_COLORS.danger, attributes: 1 });
    addText(panel, error, { fg: SNAPSHOT_COLORS.text });
    addText(footer, "r retry   q quit", { fg: SNAPSHOT_COLORS.muted, height: 1 });
    return;
  }

  if (!data) return;

  if (help) {
    const panel = addPanel(body, "dashboard-help", { flexGrow: 1 });
    addText(panel, "SNAPSHOT TUI NAVIGATION", { fg: SNAPSHOT_COLORS.accent, attributes: 1 });
    addText(panel, "1-4             open Overview, Workspaces, Merges, or Health", { fg: SNAPSHOT_COLORS.text });
    addText(panel, "←/→ or h/l      change tab", { fg: SNAPSHOT_COLORS.text });
    addText(panel, "j/k or ↑/↓      move through the selected list", { fg: SNAPSHOT_COLORS.text });
    addText(panel, "r               refresh project state", { fg: SNAPSHOT_COLORS.text });
    addText(panel, "q               quit", { fg: SNAPSHOT_COLORS.text });
    addText(footer, "? or Esc close help", { fg: SNAPSHOT_COLORS.muted, height: 1 });
    return;
  }

  const nav = addPanel(body, "dashboard-nav", {
    height: 3,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  });
  const tabs: Array<[DashboardTab, string]> = [
    ["overview", "Overview"],
    ["workspaces", "Workspaces"],
    ["merges", "Merges"],
    ["health", "Health"],
  ];
  addText(nav, tabs.map(([key, label]) => key === tab ? `[ ${label} ]` : `  ${label}  `).join("  "), {
    fg: SNAPSHOT_COLORS.accent,
    height: 1,
  });

  if (tab === "overview") {
    renderOverview(body, data);
  } else if (tab === "workspaces") {
    renderWorkspaces(body, data, selected);
  } else if (tab === "merges") {
    renderMerges(body, data, selected);
  } else {
    renderHealth(body, data);
  }

  addText(footer, "←/→ tabs   j/k select   r refresh   ? help   q quit", {
    fg: SNAPSHOT_COLORS.muted,
    height: 1,
  });
}

function renderOverview(body: OpenTuiSession["root"], data: SnapshotTuiData): void {
  const active = data.workspaces.filter((workspace) => workspace.status === "active").length;
  const changed = data.workspaces.reduce((total, workspace) => total + workspace.changedFiles, 0);
  const conflicts = data.mergeSessions.reduce(
    (total, session) => total + session.entries.filter((entry) => entry.result === "conflict").length,
    0,
  );

  const cards = new BoxRenderable(body.ctx, {
    id: "overview-cards",
    width: "100%",
    height: 5,
    flexDirection: "row",
    gap: 1,
  });
  body.add(cards);
  for (const [label, value, color] of [
    ["ACTIVE WORKSPACES", String(active), SNAPSHOT_COLORS.accent],
    ["CHANGED FILES", String(changed), changed > 0 ? SNAPSHOT_COLORS.warning : SNAPSHOT_COLORS.success],
    ["CONFLICT ENTRIES", String(conflicts), conflicts > 0 ? SNAPSHOT_COLORS.danger : SNAPSHOT_COLORS.success],
  ] as const) {
    const card = addPanel(cards, `overview-${label}`, { flexGrow: 1, minWidth: 12 });
    addText(card, label, { fg: SNAPSHOT_COLORS.muted, height: 1 });
    addText(card, value, { fg: color, attributes: 1, height: 1 });
  }

  const detail = addPanel(body, "overview-details", { flexGrow: 1 });
  addText(detail, "PROJECT", { fg: SNAPSHOT_COLORS.accent, attributes: 1 });
  addText(detail, clip(data.projectPath, 120), { fg: SNAPSHOT_COLORS.text });
  addText(detail, `branch       ${data.branch || "detached HEAD"}`, { fg: SNAPSHOT_COLORS.muted });
  addText(detail, `initialized  ${data.inspection.project?.isSnapshotInitialized ? "yes" : "no"}`, { fg: SNAPSHOT_COLORS.muted });
  addText(detail, `default      ${data.inspection.project?.defaultBackend ?? "—"}`, { fg: SNAPSHOT_COLORS.muted });
  addText(detail, "", { height: 1 });
  addText(detail, "RECENT ACTIVITY", { fg: SNAPSHOT_COLORS.accent, attributes: 1 });
  const recent = [...data.mergeSessions].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt)).slice(0, 4);
  if (recent.length === 0) {
    addText(detail, "No merge sessions recorded.", { fg: SNAPSHOT_COLORS.muted });
  } else {
    for (const merge of recent) {
      const outcome = merge.entries.some((entry) => entry.result === "conflict") ? "conflict" : "complete";
      addText(detail, `${formatTime(merge.finishedAt)}  ${merge.mergeSessionId}  ${outcome}`, {
        fg: outcome === "conflict" ? SNAPSHOT_COLORS.warning : SNAPSHOT_COLORS.muted,
      });
    }
  }
}

function renderWorkspaces(body: OpenTuiSession["root"], data: SnapshotTuiData, selected: number): void {
  const panel = addPanel(body, "workspace-list", { flexGrow: 1 });
  addText(panel, "WORKSPACE INVENTORY", { fg: SNAPSHOT_COLORS.accent, attributes: 1 });
  if (data.workspaces.length === 0) {
    addText(panel, "No snapshot workspaces found.", { fg: SNAPSHOT_COLORS.muted });
    return;
  }

  const rows = data.workspaces.slice(Math.max(0, selected - 10), selected + 14);
  for (const workspace of rows) {
    const index = data.workspaces.indexOf(workspace);
    const marker = index === selected ? "›" : " ";
    const name = workspace.label ?? workspace.workspaceId;
    const line = `${marker} ${name.padEnd(22)} ${workspace.backend.padEnd(8)} ${String(workspace.changedFiles).padStart(3)} files  ${workspace.status}`;
    addText(panel, clip(line, 120), { fg: index === selected ? SNAPSHOT_COLORS.accent : statusColor(workspace.status) });
  }
  const chosen = data.workspaces[selected];
  if (chosen) {
    addText(panel, "", { height: 1 });
    addText(panel, `path     ${clip(chosen.workspacePath, 110)}`, { fg: SNAPSHOT_COLORS.muted });
    addText(panel, `branch   ${chosen.workspaceBranch}`, { fg: SNAPSHOT_COLORS.muted });
    addText(panel, `agent    ${chosen.agentId ?? "—"}   created ${formatTime(chosen.createdAt)}`, { fg: SNAPSHOT_COLORS.muted });
  }
}

function renderMerges(body: OpenTuiSession["root"], data: SnapshotTuiData, selected: number): void {
  const panel = addPanel(body, "merge-list", { flexGrow: 1 });
  addText(panel, "MERGE SESSIONS", { fg: SNAPSHOT_COLORS.accent, attributes: 1 });
  const sessions = [...data.mergeSessions].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
  if (sessions.length === 0) {
    addText(panel, "No merge sessions recorded.", { fg: SNAPSHOT_COLORS.muted });
    return;
  }
  for (const [index, merge] of sessions.entries()) {
    const conflicts = merge.entries.filter((entry) => entry.result === "conflict").length;
    const outcome = conflicts > 0 ? `${conflicts} conflict${conflicts === 1 ? "" : "s"}` : "complete";
    const marker = index === selected ? "›" : " ";
    addText(panel, `${marker} ${formatTime(merge.finishedAt)}  ${merge.mergeSessionId}  ${merge.mode.padEnd(6)} ${outcome}`, {
      fg: index === selected ? SNAPSHOT_COLORS.accent : conflicts > 0 ? SNAPSHOT_COLORS.warning : SNAPSHOT_COLORS.success,
    });
  }
}

function renderHealth(body: OpenTuiSession["root"], data: SnapshotTuiData): void {
  const panel = addPanel(body, "health", { flexGrow: 1 });
  addText(panel, "HOST CAPABILITIES", { fg: SNAPSHOT_COLORS.accent, attributes: 1 });
  addText(panel, `platform       ${data.inspection.host.platform}`, { fg: SNAPSHOT_COLORS.text });
  for (const [label, probe] of [
    ["worktree", data.inspection.host.worktree],
    ["apfs-cow", data.inspection.host.apfsCow],
    ["overlay", data.inspection.host.overlay],
  ] as const) {
    addText(panel, `${probe.available ? "✓" : "·"} ${label.padEnd(13)} ${probe.reason}`, {
      fg: probe.available ? SNAPSHOT_COLORS.success : SNAPSHOT_COLORS.muted,
    });
  }
  addText(panel, "", { height: 1 });
  addText(panel, "PROJECT STATE", { fg: SNAPSHOT_COLORS.accent, attributes: 1 });
  addText(panel, `git repository ${data.inspection.project?.isGitRepo ? "ready" : "not found"}`, {
    fg: data.inspection.project?.isGitRepo ? SNAPSHOT_COLORS.success : SNAPSHOT_COLORS.danger,
  });
  addText(panel, `snapshot       ${data.inspection.project?.isSnapshotInitialized ? "initialized" : "not initialized"}`, {
    fg: data.inspection.project?.isSnapshotInitialized ? SNAPSHOT_COLORS.success : SNAPSHOT_COLORS.warning,
  });
}

export async function runSnapshotTui(loader: SnapshotTuiLoader): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("snapshot tui requires an interactive TTY");
  }

  await withOpenTui<void>({ title: "Snapshot TUI" }, (session) => {
    let tab: DashboardTab = "overview";
    let selected = 0;
    let data: SnapshotTuiData | null = null;
    let loading = true;
    let error: string | null = null;
    let help = false;
    let loadGeneration = 0;

    const render = (): void => {
      clearChildren(session.root);
      renderDashboard(session, tab, data, loading, error, selected, help);
      session.renderer.requestRender();
    };

    const load = async (): Promise<void> => {
      const generation = ++loadGeneration;
      loading = true;
      error = null;
      render();
      try {
        const next = await loader();
        if (generation !== loadGeneration) return;
        data = next;
        selected = 0;
        error = null;
      } catch (caught) {
        if (generation !== loadGeneration) return;
        error = caught instanceof Error ? caught.message : String(caught);
      } finally {
        if (generation === loadGeneration) {
          loading = false;
          render();
        }
      }
    };

    const tabs: DashboardTab[] = ["overview", "workspaces", "merges", "health"];
    const onKey = (key: KeyEvent): void => {
      if (help && isKey(key, "escape", "?")) {
        help = false;
        render();
        return;
      }
      if (isCancelKey(key) || isKey(key, "q")) {
        session.renderer.keyInput.off("keypress", onKey);
        session.finish(undefined);
        return;
      }
      if (isKey(key, "r")) {
        void load();
        return;
      }
      if (isKey(key, "?")) {
        help = true;
        render();
        return;
      }
      if (isKey(key, "1", "2", "3", "4")) {
        tab = tabs[Number(key.name || key.sequence) - 1] ?? "overview";
        selected = 0;
        render();
        return;
      }
      if (isKey(key, "right", "ArrowRight", "l")) {
        tab = tabs[(tabs.indexOf(tab) + 1) % tabs.length] ?? "overview";
        selected = 0;
        render();
        return;
      }
      if (isKey(key, "left", "ArrowLeft", "h")) {
        tab = tabs[(tabs.indexOf(tab) - 1 + tabs.length) % tabs.length] ?? "overview";
        selected = 0;
        render();
        return;
      }
      if (isKey(key, "down", "ArrowDown", "j")) {
        const max = tab === "workspaces" ? (data?.workspaces.length ?? 1) - 1 : tab === "merges" ? (data?.mergeSessions.length ?? 1) - 1 : 0;
        selected = Math.min(max, selected + 1);
        render();
        return;
      }
      if (isKey(key, "up", "ArrowUp", "k")) {
        selected = Math.max(0, selected - 1);
        render();
      }
    };

    session.renderer.keyInput.on("keypress", onKey);
    render();
    void load();
  });
}
