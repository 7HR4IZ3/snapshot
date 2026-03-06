import React, { useMemo, useState, useEffect } from "react";
import { Box, Text, useApp, useInput } from "ink";
import {
  type TreeVersion,
  type MultiTreeFile,
  type ConflictChunk,
  type ResolutionChoice,
  type Recommendation,
  analyzeFileConflicts,
  suggestBestResolution,
  countUnresolved,
  countResolved,
  getResolutionSummary,
} from "./model.js";

export interface MultiConflictItem {
  path: string;
  baseContent: string;
  workspaces: Array<{
    workspaceId: string;
    label: string;
    content: string;
  }>;
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

interface MultiConflictAppProps {
  items: MultiConflictItem[];
  onDone: (result: MultiConflictResult) => void;
}

type ViewMode = "files" | "conflict" | "edit" | "help";

const TREE_LABELS = ["BASE", "CLONE A", "CLONE B", "CLONE C", "CLONE D"];
const TREE_COLORS: Record<string, "gray" | "cyan" | "green" | "magenta" | "yellow"> = {
  base: "gray",
  "clone a": "cyan",
  "clone b": "green",
  "clone c": "magenta",
  "clone d": "yellow",
};

function getTreeColor(index: number): "gray" | "cyan" | "green" | "magenta" | "yellow" {
  const colors: Array<"gray" | "cyan" | "green" | "magenta" | "yellow"> = [
    "gray",
    "cyan",
    "green",
    "magenta",
    "yellow",
  ];
  return colors[index % colors.length] ?? "gray";
}

function detectConflictRegions(content: string): Array<{ start: number; end: number; ours: string; theirs: string }> {
  const lines = content.split("\n");
  const regions: Array<{ start: number; end: number; ours: string; theirs: string }> = [];
  
  let inConflict = false;
  let currentStart = 0;
  let oursLines: string[] = [];
  let theirsLines: string[] = [];
  let inOurs = true;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    
    if (line.startsWith("<<<<<<")) {
      inConflict = true;
      currentStart = i;
      oursLines = [];
      theirsLines = [];
      inOurs = true;
    } else if (line.startsWith("=======") && inConflict) {
      inOurs = false;
    } else if (line.startsWith(">>>>>>>") && inConflict) {
      regions.push({
        start: currentStart,
        end: i,
        ours: oursLines.join("\n"),
        theirs: theirsLines.join("\n"),
      });
      inConflict = false;
    } else if (inConflict) {
      if (inOurs) {
        oursLines.push(line);
      } else {
        theirsLines.push(line);
      }
    }
  }
  
  return regions;
}

function renderProgressBar(percent: number, width = 20): string {
  const filled = Math.round((percent / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function MultiConflictApp({
  items,
  onDone,
}: MultiConflictAppProps): React.JSX.Element {
  const { exit } = useApp();
  
  const [selectedFile, setSelectedFile] = useState(0);
  const [selectedChunk, setSelectedChunk] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("files");
  const [scrollOffset, setScrollOffset] = useState(0);
  const [editContent, setEditContent] = useState("");
  const [editCursor, setEditCursor] = useState(0);
  const [quitArmed, setQuitArmed] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  
  const [files, setFiles] = useState<MultiTreeFile[]>(() => {
    return items.map((item) => {
      const versions: TreeVersion[] = [
        {
          workspaceId: null,
          label: "base",
          color: "gray",
          content: item.baseContent,
          hasConflict: item.baseContent.includes("<<<<<<"),
        },
        ...item.workspaces.map((ws, idx) => ({
          workspaceId: ws.workspaceId,
          label: ws.label,
          color: getTreeColor(idx + 1),
          content: ws.content,
          hasConflict: ws.content.includes("<<<<<<"),
        })),
      ];
      
      const parsed = analyzeFileConflicts(item.path, item.baseContent, item.workspaces);
      
      return {
        path: item.path,
        versions: parsed.versions,
        chunks: parsed.chunks,
        resolved: {} as Record<number, ResolutionChoice>,
      };
    });
  });
  
  const currentFile = files[selectedFile];
  const currentChunks = currentFile?.chunks || [];
  const safeChunkIndex = Math.min(
    selectedChunk,
    Math.max(0, currentChunks.length - 1),
  );
  const selectedChunkData = currentChunks[safeChunkIndex];
  
  const summary = useMemo(() => getResolutionSummary(files), [files]);
  const progressPercent = summary.total > 0
    ? Math.round((summary.resolved / summary.total) * 100)
    : 100;
  
  const recommendation = useMemo(() => {
    if (!selectedChunkData || !currentFile) return null;
    return suggestBestResolution(selectedChunkData, currentFile.versions);
  }, [selectedChunkData, currentFile]);
  
  const acceptVersion = (versionIndex: number) => {
    if (!currentFile || !selectedChunkData) return;
    
    setFiles((prev) =>
      prev.map((f, idx) => {
        if (idx !== selectedFile) return f;
        return {
          ...f,
          resolved: {
            ...f.resolved,
            [selectedChunkData.index]: {
              type: "accept-version",
              versionIndex,
            },
          },
        };
      })
    );
    
    if (selectedChunk < currentChunks.length - 1) {
      setSelectedChunk((prev) => prev + 1);
      setScrollOffset(0);
    }
  };
  
  const enterEditMode = () => {
    if (!selectedChunkData || !currentFile) return;
    
    const existing = currentFile.resolved[selectedChunkData.index];
    if (existing && existing.type === "manual") {
      setEditContent(existing.content);
    } else {
      const rec = recommendation?.versionIndex != null 
        ? currentFile.versions[recommendation.versionIndex]?.content || ""
        : selectedChunkData.versions["base"] || "";
      setEditContent(rec);
    }
    setEditCursor(0);
    setViewMode("edit");
  };
  
  const saveManualResolution = () => {
    if (!currentFile || !selectedChunkData) return;
    
    setFiles((prev) =>
      prev.map((f, idx) => {
        if (idx !== selectedFile) return f;
        return {
          ...f,
          resolved: {
            ...f.resolved,
            [selectedChunkData.index]: {
              type: "manual",
              content: editContent,
            },
          },
        };
      })
    );
    
    setViewMode("conflict");
    if (selectedChunk < currentChunks.length - 1) {
      setSelectedChunk((prev) => prev + 1);
      setScrollOffset(0);
    }
  };
  
  const openExternalEditor = async () => {
    const editor = process.env.EDITOR || "vim";
    const tmpFile = `/tmp/snapshot_merge_${Date.now()}.txt`;
    
    const initialContent = selectedChunkData
      ? selectedChunkData.versions["base"] || editContent || ""
      : editContent;
    
    const { writeFileSync, readFileSync, unlinkSync } = await import("node:fs");
    writeFileSync(tmpFile, initialContent, "utf-8");
    
    const proc = Bun.spawn([editor, tmpFile]);
    
    await proc.exited;
    
    try {
      const content = readFileSync(tmpFile, "utf-8");
      setEditContent(content);
      setViewMode("edit");
    } catch {
    } finally {
      try {
        unlinkSync(tmpFile);
      } catch {}
    }
  };
  
  const finalize = () => {
    const resolutions: MultiConflictResult["resolutions"] = [];
    
    for (const file of files) {
      const allResolved = file.chunks.every((c) => c.index in file.resolved);
      
      if (allResolved && file.chunks.length > 0) {
        const firstChunk = file.chunks[0];
        if (!firstChunk) continue;
        const firstRes = file.resolved[firstChunk.index];
        
        if (firstRes && firstRes.type === "accept-version" && firstRes.versionIndex !== undefined) {
          const allSame = file.chunks.every(
            (c) => {
              const res = file.resolved[c.index];
              return res && res.type === "accept-version" && res.versionIndex === firstRes.versionIndex;
            }
          );
          
          if (allSame) {
            resolutions.push({
              path: file.path,
              action: "accept",
              versionIndex: firstRes.versionIndex,
            });
            continue;
          }
        }
        
        let mergedContent = "";
        const baseLines = file.versions[0]?.content.split("\n") || [];
        
        for (let i = 0; i < baseLines.length; i++) {
          const chunk = file.chunks.find(
            (c) => i >= c.lineStart && i <= c.lineEnd
          );
          
          if (chunk) {
            const res = file.resolved[chunk.index];
            if (res?.type === "accept-version" && res.versionIndex !== undefined) {
              const version = file.versions[res.versionIndex];
              if (version) {
                mergedContent += chunk.versions[version.workspaceId || "base"] || "";
              }
            } else if (res?.type === "manual") {
              mergedContent += res.content;
            }
          } else {
            mergedContent += baseLines[i] + "\n";
          }
        }
        
        resolutions.push({
          path: file.path,
          action: "manual",
          content: mergedContent,
        });
      } else {
        resolutions.push({
          path: file.path,
          action: "accept",
          versionIndex: 0,
        });
      }
    }
    
    onDone({ finalized: true, resolutions });
    exit();
  };
  
  useInput((input, key) => {
    if (showHelp) {
      if (input === "q" || input === "Escape" || input === "?") {
        setShowHelp(false);
      }
      return;
    }
    
    if (viewMode === "help") {
      setViewMode("files");
      return;
    }
    
    if (viewMode === "edit") {
      if (input === "Escape" || input === "q") {
        setViewMode("conflict");
        return;
      }
      
      if (input === "Enter") {
        saveManualResolution();
        return;
      }
      
      if (input === "e") {
        openExternalEditor();
        return;
      }
      
      if (input === "ArrowUp" || input === "k") {
        setEditCursor((prev) => Math.max(0, prev - 1));
        return;
      }
      
      if (input === "ArrowDown" || input === "j") {
        const lines = editContent.split("\n");
        setEditCursor((prev) => Math.min(lines.length - 1, prev + 1));
        return;
      }
      
      if (input === "i") {
        return;
      }
      
      if (input === "a") {
        setEditContent((prev) => prev + "a");
        return;
      }
      
      return;
    }
    
    if (input === "?") {
      setShowHelp(true);
      return;
    }
    
    if (input === "q") {
      if (!quitArmed) {
        setQuitArmed(true);
        return;
      }
      onDone({ finalized: false, resolutions: [] });
      exit();
      return;
    }
    
    setQuitArmed(false);
    
    if (input === "f") {
      finalize();
      return;
    }
    
    if (input === "s") {
      return;
    }
    
    if (input === "n" || key.downArrow) {
      if (selectedChunk < currentChunks.length - 1) {
        setSelectedChunk((prev) => prev + 1);
        setScrollOffset(0);
      } else if (selectedFile < files.length - 1) {
        setSelectedFile((prev) => prev + 1);
        setSelectedChunk(0);
        setScrollOffset(0);
      }
      return;
    }
    
    if (input === "p" || key.upArrow) {
      if (selectedChunk > 0) {
        setSelectedChunk((prev) => prev - 1);
        setScrollOffset(0);
      } else if (selectedFile > 0) {
        setSelectedFile((prev) => prev - 1);
        setSelectedChunk(0);
        setScrollOffset(0);
      }
      return;
    }
    
    if (input === "j" && key.downArrow) {
      if (selectedFile < files.length - 1) {
        setSelectedFile((prev) => prev + 1);
        setSelectedChunk(0);
        setScrollOffset(0);
      }
      return;
    }
    
    if (input === "k" && key.upArrow) {
      if (selectedFile > 0) {
        setSelectedFile((prev) => prev - 1);
        setSelectedChunk(0);
        setScrollOffset(0);
      }
      return;
    }
    
    if (input === "g") {
      setSelectedChunk(0);
      setScrollOffset(0);
      return;
    }
    
    if (input === "G") {
      setSelectedChunk(currentChunks.length - 1);
      setScrollOffset(0);
      return;
    }
    
    if (input === "e") {
      enterEditMode();
      return;
    }
    
    const num = parseInt(input);
    if (num >= 1 && currentFile && num <= currentFile.versions.length) {
      acceptVersion(num - 1);
      return;
    }
    
    if (input === "a" && recommendation) {
      acceptVersion(recommendation.versionIndex);
      return;
    }
  });

  if (showHelp) {
    return (
      <Box flexDirection="column" padding={1}>
        <Box borderStyle="bold" borderColor="cyan" paddingX={1}>
          <Text bold color="white">
            SNAPSHOT MULTI-TREE CONFLICT RESOLVER - HELP
          </Text>
        </Box>
        
        <Box marginTop={1} flexDirection="column" gap={0}>
          <Text bold color="yellow">NAVIGATION</Text>
          <Text color="gray">  n / ↓     - Next conflict</Text>
          <Text color="gray">  p / ↑     - Previous conflict</Text>
          <Text color="gray">  j         - Next file</Text>
          <Text color="gray">  k         - Previous file</Text>
          <Text color="gray">  g         - First conflict</Text>
          <Text color="gray">  G         - Last conflict</Text>
        </Box>
        
        <Box marginTop={1} flexDirection="column" gap={0}>
          <Text bold color="yellow">RESOLUTION</Text>
          <Text color="gray">  1-{currentFile?.versions.length || 3} - Accept that version</Text>
          <Text color="gray">  a         - Accept recommended</Text>
          <Text color="gray">  e         - Edit manually</Text>
        </Box>
        
        <Box marginTop={1} flexDirection="column" gap={0}>
          <Text bold color="yellow">ACTIONS</Text>
          <Text color="gray">  s         - Save progress</Text>
          <Text color="gray">  f         - Finalize & exit</Text>
          <Text color="gray">  q         - Quit</Text>
        </Box>
        
        <Box marginTop={2} borderStyle="round" borderColor="gray" paddingX={1}>
          <Text color="white">Press any key to return...</Text>
        </Box>
      </Box>
    );
  }
  
  if (viewMode === "edit") {
    const editLines = editContent.split("\n");
    const displayLines = editLines.slice(scrollOffset, scrollOffset + 12);
    
    return (
      <Box flexDirection="column" padding={1}>
        <Box borderStyle="bold" borderColor="yellow" paddingX={1}>
          <Text bold color="white">
            ✏ MANUAL MERGE - {currentFile?.path}
          </Text>
        </Box>
        
        <Box marginTop={1} flexDirection="column">
          <Text color="gray">Use ↑↓ to navigate, type to edit, Enter to accept, Esc to cancel</Text>
          <Text color="cyan">Press [e] to open in ${process.env.EDITOR || "vim"}</Text>
        </Box>
        
        <Box
          marginTop={1}
          borderStyle="round"
          borderColor="yellow"
          flexDirection="column"
          height={14}
        >
          {displayLines.map((line, idx) => {
            const actualLine = scrollOffset + idx;
            const isCursor = actualLine === editCursor;
            return (
              <Box key={idx}>
                <Text color={isCursor ? "yellow" : "white"} bold={isCursor}>
                  {isCursor ? "▸ " : "  "}
                </Text>
                <Text color={isCursor ? "yellow" : "white"} bold={isCursor}>
                  {line || " "}
                </Text>
              </Box>
            );
          })}
        </Box>
        
        <Box
          marginTop={1}
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
        >
          <Text color="gray">Mode: EDIT | Line {editCursor + 1}/{editLines.length}</Text>
        </Box>
        
        <Box marginTop={1} gap={2}>
          <Text>
            <Text color="green" bold>[Enter]</Text>
            <Text color="gray"> use </Text>
          </Text>
          <Text>
            <Text color="cyan" bold>[e]</Text>
            <Text color="gray"> external </Text>
          </Text>
          <Text>
            <Text color="yellow" bold>[Esc]</Text>
            <Text color="gray"> cancel </Text>
          </Text>
        </Box>
      </Box>
    );
  }
  
  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="bold" borderColor="cyan" paddingX={1}>
        <Box flexDirection="column" flexGrow={1}>
          <Text bold color="white">
            SNAPSHOT MULTI-TREE CONFLICT RESOLVER
          </Text>
          <Box gap={1}>
            <Text color="gray">
              {files.length} file(s) · {summary.resolved}/{summary.total} chunks
            </Text>
            <Text color={progressPercent === 100 ? "green" : "cyan"}>
              {renderProgressBar(progressPercent)}
            </Text>
            <Text color={progressPercent === 100 ? "green" : "yellow"}>
              {progressPercent}%
            </Text>
          </Box>
        </Box>
        <Text color={summary.unresolved > 0 ? "yellow" : "green"} bold>
          {summary.unresolved} pending
        </Text>
      </Box>
      
      <Box marginTop={1} borderStyle="round" borderColor="gray" paddingX={1}>
        <Text color="gray">FILES </Text>
        {files.map((file, idx) => {
          const unresolved = countUnresolved(file);
          const resolved = countResolved(file);
          const total = file.chunks.length;
          const pct = total > 0 ? Math.round((resolved / total) * 100) : 100;
          const isSelected = idx === selectedFile;
          
          return (
            <Text key={file.path}>
              <Text color={isSelected ? "cyan" : "gray"} bold={isSelected}>
                {isSelected ? "▸ " : "  "}
              </Text>
              <Text color={isSelected ? "white" : "gray"}>
                {file.path}{" "}
              </Text>
              <Text color={pct === 100 ? "green" : "yellow"}>
                {pct}%{" "}
              </Text>
              <Text color="gray">({resolved}/{total})</Text>
              <Text color="gray"> · </Text>
            </Text>
          );
        })}
      </Box>
      
      <Box marginTop={1} borderStyle="round" borderColor="gray" paddingX={1}>
        <Text color="gray">TREES </Text>
        {currentFile?.versions.map((v, idx) => {
          const unresolved = currentChunks.filter(
            (c) => !(c.index in currentFile.resolved)
          ).length;
          return (
            <Text key={idx}>
              <Text color={v.color} bold>
                [{v.label.toUpperCase()}]
              </Text>
              <Text color="gray"> </Text>
            </Text>
          );
        })}
      </Box>
      
      <Box marginTop={1} flexDirection="column">
        <Box justifyContent="space-between">
          <Text bold color="white">
            📄 {currentFile?.path || "No file"}
          </Text>
          <Text color="gray">
            Conflict {currentChunks.length === 0 ? 0 : safeChunkIndex + 1}/
            {currentChunks.length}
          </Text>
        </Box>
        
        <Box marginTop={1} borderStyle="round" borderColor="gray" flexDirection="column">
          <Box paddingX={1} backgroundColor="gray">
            <Box flexGrow={1}>
              <Text color="white" bold>
                LINE
              </Text>
            </Box>
            {currentFile?.versions.map((v, idx) => (
              <Box flexGrow={1} key={idx} paddingX={1}>
                <Text color={v.color} bold>
                  {v.label.toUpperCase().padEnd(10)}
                </Text>
              </Box>
            ))}
          </Box>
          
          {selectedChunkData ? (
            <>
              <Box backgroundColor="red" paddingX={1}>
                <Text color="white" bold>
                  CONFLICT #{safeChunkIndex + 1}
                </Text>
              </Box>
              {currentFile?.versions.map((v, vIdx) => {
                const versionContent = selectedChunkData.versions[v.workspaceId || "base"] || selectedChunkData.versions[v.label] || "";
                const lines = versionContent.split("\n").slice(0, 8);
                return (
                  <Box key={vIdx} flexDirection="column" paddingX={1} borderStyle="round" borderColor={v.color}>
                    <Text color={v.color} bold>{v.label.toUpperCase()}</Text>
                    {lines.map((line, lIdx) => (
                      <Text key={lIdx} color={v.color}>{line}</Text>
                    ))}
                    {versionContent.split("\n").length > 8 && (
                      <Text color="gray">... ({versionContent.split("\n").length} lines)</Text>
                    )}
                  </Box>
                );
              })}
            </>
          ) : (
            <Box paddingX={1}>
              <Text color="gray">No conflict selected</Text>
            </Box>
          )}
        </Box>
      </Box>
      
      {selectedChunkData && (
        <Box
          marginTop={1}
          borderStyle="round"
          borderColor="yellow"
          flexDirection="column"
          paddingX={1}
        >
          <Text bold color="white">
            CONFLICT #{safeChunkIndex + 1} (lines {selectedChunkData.lineStart}-
            {selectedChunkData.lineEnd})
          </Text>
          
          {recommendation && currentFile && (
            <Box marginTop={1} gap={1}>
              <Text color="green">★ Recommended: </Text>
              <Text color="cyan">
                {currentFile.versions[recommendation.versionIndex]?.label}
              </Text>
              <Text color="gray">- {recommendation.reason}</Text>
              <Text color={recommendation.confidence === "high" ? "green" : "yellow"}>
                ({recommendation.confidence} confidence)
              </Text>
            </Box>
          )}
          
          <Box marginTop={1} gap={2}>
            {currentFile?.versions.map((v, idx) => (
              <Text
                key={idx}
                bold={recommendation?.versionIndex === idx}
                color={
                  recommendation?.versionIndex === idx
                    ? "green"
                    : v.color
                }
              >
                [{idx + 1}] {v.label.toUpperCase()}{" "}
              </Text>
            ))}
            <Text color="yellow" bold>
              [e] EDIT
            </Text>
          </Box>
        </Box>
      )}
      
      <Box
        marginTop={1}
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
        justifyContent="space-between"
      >
        <Box gap={2}>
          <Text>
            <Text color="gray" bold>
              [n]
            </Text>
            <Text color="gray"> next </Text>
          </Text>
          <Text>
            <Text color="gray" bold>
              [p]
            </Text>
            <Text color="gray"> prev </Text>
          </Text>
          <Text>
            <Text color="gray" bold>
              [j/k]
            </Text>
            <Text color="gray"> file </Text>
          </Text>
          <Text>
            <Text color="gray" bold>
              [g/G]
            </Text>
            <Text color="gray"> jump </Text>
          </Text>
        </Box>
        <Box gap={2}>
          {recommendation && (
            <Text>
              <Text color="green" bold>
                [a]
              </Text>
              <Text color="gray"> accept rec </Text>
            </Text>
          )}
          <Text>
            <Text color="green" bold>
              [f]
            </Text>
            <Text color="gray"> finish </Text>
          </Text>
          <Text>
            <Text color="red" bold>
              [q]
            </Text>
            <Text color="gray"> quit </Text>
          </Text>
          <Text>
            <Text color="cyan" bold>
              [?]
            </Text>
            <Text color="gray"> help </Text>
          </Text>
        </Box>
      </Box>
      
      {quitArmed && (
        <Box marginTop={1} borderStyle="bold" borderColor="red" paddingX={1}>
          <Text color="red" bold>
            Press q again to quit without saving
          </Text>
        </Box>
      )}
    </Box>
  );
}
