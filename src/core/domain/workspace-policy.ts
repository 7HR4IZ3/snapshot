import micromatch from "micromatch";

export interface WorkspacePolicy {
  include: string[];
  exclude: string[];
  symlink: string[];
  symlinkMode: "shared-live" | "safety-restricted";
}

export const HARD_EXCLUDED_WORKSPACE_PATHS = [
  ".git",
  ".snapshot",
  ".snapshot-workspace.json",
  ".spawned",
  ".worktrees",
  "worktrees",
];

/**
 * Derived paths that should not be copied into an essential workspace unless
 * the user explicitly includes them. Git's ignore rules are checked alongside
 * this list, so repositories can add their own project-specific generated paths.
 */
export const DEFAULT_ESSENTIAL_EXCLUDED_WORKSPACE_PATHS = [
  "**/node_modules/**",
  "**/.pnpm-store/**",
  "**/.yarn/cache/**",
  "**/.yarn/unplugged/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/.svelte-kit/**",
  "**/.turbo/**",
  "**/.vite/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.cache/**",
  "**/.parcel-cache/**",
  "**/target/**",
  "**/tmp/**",
  "**/temp/**",
];

export function normalizeWorkspacePattern(input: string): string {
  return input.replace(/^\.\//, "").replace(/\/$/, "").trim();
}

export function normalizeWorkspacePolicy(policy: WorkspacePolicy): WorkspacePolicy {
  return {
    include: policy.include.map(normalizeWorkspacePattern).filter(Boolean),
    exclude: [...policy.exclude, ...HARD_EXCLUDED_WORKSPACE_PATHS]
      .map(normalizeWorkspacePattern)
      .filter(Boolean),
    symlink: policy.symlink.map(normalizeWorkspacePattern).filter(Boolean),
    symlinkMode: policy.symlinkMode,
  };
}

function expandPattern(pattern: string): string[] {
  if (/[*?{}()[\]!+@]/.test(pattern)) {
    return [pattern];
  }
  return [pattern, `${pattern}/**`];
}

export function workspacePathMatches(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) =>
    expandPattern(normalizeWorkspacePattern(pattern)).some((expanded) =>
      micromatch.isMatch(path, expanded, { dot: true }),
    ),
  );
}

export function workspacePathMayContainMatch(path: string, patterns: string[]): boolean {
  const normalizedPath = normalizeWorkspacePattern(path);
  if (!normalizedPath) {
    return patterns.length > 0;
  }

  return patterns.some((pattern) => {
    const normalizedPattern = normalizeWorkspacePattern(pattern);
    if (!normalizedPattern) {
      return false;
    }
    if (workspacePathMatches(normalizedPath, [normalizedPattern])) {
      return true;
    }
    if (normalizedPattern.startsWith(`${normalizedPath}/`)) {
      return true;
    }
    return micromatch.isMatch(`${normalizedPath}/.snapshot-probe`, normalizedPattern, { dot: true });
  });
}

function pathParts(path: string): string[] {
  return path.split(" -> ").map((part) => part.trim()).filter(Boolean);
}

export function isWorkspacePathAllowed(path: string, policy: WorkspacePolicy): boolean {
  const paths = pathParts(path);
  if (paths.length === 0) {
    return false;
  }

  const normalized = normalizeWorkspacePolicy(policy);
  return paths.every((candidate) => {
    if (workspacePathMatches(candidate, HARD_EXCLUDED_WORKSPACE_PATHS)) {
      return false;
    }
    if (workspacePathMatches(candidate, normalized.exclude)) {
      return false;
    }
    return normalized.include.length === 0 || workspacePathMatches(candidate, normalized.include);
  });
}
