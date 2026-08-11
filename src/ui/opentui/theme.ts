import { TextAttributes } from "@opentui/core";

export const SNAPSHOT_COLORS = {
  background: "#0b1020",
  panel: "#121a2b",
  panelMuted: "#182238",
  border: "#2d3b5b",
  text: "#e6edf7",
  muted: "#8ea0bd",
  accent: "#63d7ff",
  accentStrong: "#22b8e6",
  success: "#78e08f",
  warning: "#ffd166",
  danger: "#ff7b8a",
  purple: "#b59cff",
} as const;

export const SNAPSHOT_BOLD = TextAttributes.BOLD;

export type SnapshotColor = (typeof SNAPSHOT_COLORS)[keyof typeof SNAPSHOT_COLORS];
