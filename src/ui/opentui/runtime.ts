import {
  BoxRenderable,
  createCliRenderer,
  TextRenderable,
  type CliRenderer,
  type KeyEvent,
  type Renderable,
} from "@opentui/core";
import { SNAPSHOT_COLORS } from "./theme.js";

export interface OpenTuiOptions {
  title: string;
  cancelValue?: unknown;
}

export interface OpenTuiSession {
  renderer: CliRenderer;
  root: Renderable;
  finish: (value: unknown) => void;
}

export function keyName(key: KeyEvent): string {
  return key.name || key.sequence || "";
}

export function isKey(key: KeyEvent, ...names: string[]): boolean {
  const name = keyName(key);
  return names.includes(name) || names.includes(name.toLowerCase());
}

export function isCancelKey(key: KeyEvent): boolean {
  return key.ctrl && isKey(key, "c") || isKey(key, "escape");
}

export function appendLine(lines: string[], label: string, value: string): void {
  lines.push(`${label.padEnd(14)} ${value}`);
}

export function clip(value: string, width: number): string {
  const normalized = value.replace(/\r/g, "");
  if (width <= 0) return "";
  if (normalized.length <= width) return normalized;
  if (width <= 1) return normalized.slice(0, width);
  return `${normalized.slice(0, width - 1)}…`;
}

export function clipLines(value: string, width: number, height: number): string[] {
  const source = value.split("\n");
  const lines = source.slice(0, Math.max(0, height));
  return lines.map((line) => clip(line, width));
}

export function clearChildren(parent: Renderable): void {
  for (const child of [...parent.getChildren()]) {
    parent.remove(child);
    child.destroyRecursively();
  }
}

export function addText(
  parent: Renderable,
  content: string,
  options: ConstructorParameters<typeof TextRenderable>[1] = {},
): TextRenderable {
  const text = new TextRenderable(parent.ctx, {
    width: "100%",
    height: 1,
    content,
    fg: SNAPSHOT_COLORS.text,
    wrapMode: "none",
    truncate: true,
    ...options,
  });
  parent.add(text);
  return text;
}

export function addPanel(
  parent: Renderable,
  id: string,
  options: ConstructorParameters<typeof BoxRenderable>[1] = {},
): BoxRenderable {
  const panel = new BoxRenderable(parent.ctx, {
    id,
    border: true,
    borderStyle: "single",
    borderColor: SNAPSHOT_COLORS.border,
    backgroundColor: SNAPSHOT_COLORS.panel,
    paddingX: 1,
    paddingY: 1,
    flexDirection: "column",
    ...options,
  });
  parent.add(panel);
  return panel;
}

export function addShell(
  renderer: CliRenderer,
  title: string,
  subtitle: string,
): { shell: BoxRenderable; body: BoxRenderable; footer: BoxRenderable } {
  const shell = new BoxRenderable(renderer, {
    id: "snapshot-shell",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    backgroundColor: SNAPSHOT_COLORS.background,
  });
  renderer.root.add(shell);

  const header = new BoxRenderable(renderer, {
    id: "snapshot-header",
    width: "100%",
    height: 3,
    flexDirection: "column",
    paddingX: 1,
    backgroundColor: SNAPSHOT_COLORS.panelMuted,
  });
  shell.add(header);
  addText(header, `${title}  ${subtitle}`, {
    height: 1,
    fg: SNAPSHOT_COLORS.accent,
    attributes: 1,
  });
  addText(header, "OpenTUI · native terminal workspace", {
    height: 1,
    fg: SNAPSHOT_COLORS.muted,
  });

  const body = new BoxRenderable(renderer, {
    id: "snapshot-body",
    width: "100%",
    flexGrow: 1,
    minHeight: 1,
    flexDirection: "column",
    padding: 1,
    gap: 1,
  });
  shell.add(body);

  const footer = new BoxRenderable(renderer, {
    id: "snapshot-footer",
    width: "100%",
    height: 2,
    paddingX: 1,
    backgroundColor: SNAPSHOT_COLORS.panelMuted,
  });
  shell.add(footer);

  return { shell, body, footer };
}

export async function withOpenTui<T>(
  options: OpenTuiOptions,
  onReady: (session: OpenTuiSession) => void,
): Promise<T> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    clearOnShutdown: true,
    screenMode: "alternate-screen",
    backgroundColor: SNAPSHOT_COLORS.background,
    useMouse: false,
    autoFocus: false,
    targetFps: 30,
  });
  renderer.setTerminalTitle(options.title);

  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (value: unknown): void => {
      if (settled) return;
      settled = true;
      renderer.keyInput.off("keypress", handleKeypress);
      try {
        renderer.destroy();
      } catch (error) {
        reject(error);
        return;
      }
      resolve(value as T);
    };

    const handleKeypress = (key: KeyEvent): void => {
      if (key.ctrl && isKey(key, "c")) {
        finish(options.cancelValue);
      }
    };

    renderer.keyInput.on("keypress", handleKeypress);
    try {
      renderer.start();
      onReady({ renderer, root: renderer.root, finish });
      renderer.requestRender();
    } catch (error) {
      renderer.keyInput.off("keypress", handleKeypress);
      try {
        renderer.destroy();
      } catch {
        // Preserve the original setup/render error.
      }
      reject(error);
    }
  });
}
