import { parseConflictText as parseOriginalConflict, type ChunkChoice } from "../conflicts/model.js";

export type { ChunkChoice };

export interface TreeVersion {
  workspaceId: string | null;
  label: string;
  color: "gray" | "cyan" | "green" | "magenta" | "yellow";
  content: string;
  hasConflict: boolean;
}

export interface ConflictChunk {
  index: number;
  lineStart: number;
  lineEnd: number;
  targetContent: string;
  versions: Record<string, string>;
}

export interface MultiTreeFile {
  path: string;
  versions: TreeVersion[];
  chunks: ConflictChunk[];
  resolved: Record<number, ResolutionChoice>;
}

export type ResolutionChoice = {
  type: "accept-version";
  versionIndex: number;
} | {
  type: "manual";
  content: string;
};

export interface ResolutionResult {
  path: string;
  action: "accept" | "manual";
  versionIndex?: number;
  content?: string;
}

export interface Recommendation {
  versionIndex: number;
  reason: string;
  confidence: "high" | "medium" | "low";
}

const TREE_COLORS: TreeVersion["color"][] = ["gray", "cyan", "green", "magenta", "yellow"];

export interface ParsedFile {
  path: string;
  versions: TreeVersion[];
  chunks: ConflictChunk[];
}

export function analyzeFileConflicts(
  path: string,
  baseContent: string,
  workspaceContents: Array<{ workspaceId: string; label: string; content: string }>
): ParsedFile {
  const versions: TreeVersion[] = [
    {
      workspaceId: null,
      label: "base",
      color: "gray",
      content: baseContent,
      hasConflict: baseContent.includes("<<<<<<"),
    },
    ...workspaceContents.map((ws, idx) => ({
      workspaceId: ws.workspaceId,
      label: ws.label,
      color: TREE_COLORS[(idx + 1) % TREE_COLORS.length] ?? "gray",
      content: ws.content,
      hasConflict: ws.content.includes("<<<<<<"),
    })),
  ];

  const parsed = parseOriginalConflict(baseContent);
  const chunks: ConflictChunk[] = parsed.chunks.map((chunk) => {
    const chunkVersionContents: Record<string, string> = {
      base: chunk.target,
    };

    for (let i = 1; i < versions.length; i++) {
      const version = versions[i];
      if (!version) continue;
      
      const wsParsed = parseOriginalConflict(version.content);
      const wsChunk = wsParsed.chunks[chunk.index];
      
      if (wsChunk) {
        chunkVersionContents[version.workspaceId || version.label] = wsChunk.workspace;
      } else {
        chunkVersionContents[version.workspaceId || version.label] = chunk.workspace;
      }
    }

    return {
      index: chunk.index,
      lineStart: chunk.index * 10,
      lineEnd: chunk.index * 10 + 5,
      targetContent: chunk.target,
      versions: chunkVersionContents,
    };
  });

  return { path, versions, chunks };
}

export function compareVersions(
  v1: string,
  v2: string
): { identical: boolean; added: number; removed: number } {
  const lines1 = v1.split("\n").filter((l) => l.trim());
  const lines2 = v2.split("\n").filter((l) => l.trim());
  
  const set1 = new Set(lines1);
  const set2 = new Set(lines2);
  
  let added = 0;
  let removed = 0;
  
  for (const line of lines2) {
    if (!set1.has(line)) added++;
  }
  
  for (const line of lines1) {
    if (!set2.has(line)) removed++;
  }
  
  return {
    identical: added === 0 && removed === 0,
    added,
    removed,
  };
}

export function suggestBestResolution(
  chunk: ConflictChunk,
  versions: TreeVersion[]
): Recommendation | null {
  const entries = Object.entries(chunk.versions);
  
  if (entries.length < 2) return null;
  
  const baseContent = chunk.targetContent;
  const suggestions: Array<{ index: number; score: number; reasons: string[] }> = [];
  
  for (let i = 0; i < versions.length; i++) {
    const version = versions[i];
    if (!version) continue;
    const content = chunk.versions[version.workspaceId || "base"];
    
    if (!content) continue;
    
    let score = 0;
    const reasons: string[] = [];
    
    const comparison = compareVersions(baseContent, content);
    
    if (comparison.identical) {
      continue;
    }
    
    if (content.includes("await") || content.includes("Promise")) {
      score += 3;
      reasons.push("adds async handling");
    }
    
    if (content.includes("try") && content.includes("catch")) {
      score += 2;
      reasons.push("adds error handling");
    }
    
    if (content.length > baseContent.length * 1.5) {
      score += 1;
      reasons.push("adds more functionality");
    }
    
    const hasComment = content.includes("//") || content.includes("/*");
    if (hasComment) {
      score += 1;
      reasons.push("includes documentation");
    }
    
    suggestions.push({ index: i, score, reasons });
  }
  
  if (suggestions.length === 0) return null;
  
  suggestions.sort((a, b) => b.score - a.score);
  const best = suggestions[0];
  if (!best) return null;
  
  const confidence: Recommendation["confidence"] =
    best.score >= 4 ? "high" : best.score >= 2 ? "medium" : "low";
  
  return {
    versionIndex: best.index,
    reason: best.reasons.join(", "),
    confidence,
  };
}

export function renderMergedContent(
  file: MultiTreeFile
): string {
  const baseVersion = file.versions[0];
  if (!baseVersion) return "";
  
  const baseLines = baseVersion.content.split("\n");
  const resolved: string[] = [];
  
  for (let i = 0; i < baseLines.length; i++) {
    const line = baseLines[i];
    
    const chunk = file.chunks.find(
      (c) => i >= c.lineStart && i <= c.lineEnd
    );
    
    if (chunk) {
      const resolution = file.resolved[chunk.index];
      if (resolution) {
        if (resolution.type === "accept-version") {
          const version = file.versions[resolution.versionIndex];
          if (!version) {
            resolved.push("<<<<<< CONFLICT UNRESOLVED >>>>>>");
          } else {
            const versionContent = chunk.versions[version.workspaceId || "base"];
            if (versionContent) {
              resolved.push(versionContent);
            } else {
              resolved.push("<<<<<< CONFLICT UNRESOLVED >>>>>>");
            }
          }
        } else if (resolution.type === "manual") {
          resolved.push(resolution.content);
        }
      } else {
        resolved.push("<<<<<< CONFLICT UNRESOLVED >>>>>>");
      }
    } else {
      resolved.push(line ?? "");
    }
  }
  
  return resolved.join("\n");
}

export function countUnresolved(file: MultiTreeFile): number {
  return file.chunks.filter((c) => !(c.index in file.resolved)).length;
}

export function countResolved(file: MultiTreeFile): number {
  return Object.keys(file.resolved).length;
}

export function getResolutionSummary(
  files: MultiTreeFile[]
): { total: number; resolved: number; unresolved: number } {
  let total = 0;
  let resolved = 0;
  
  for (const file of files) {
    total += file.chunks.length;
    resolved += Object.keys(file.resolved).length;
  }
  
  return {
    total,
    resolved,
    unresolved: total - resolved,
  };
}
